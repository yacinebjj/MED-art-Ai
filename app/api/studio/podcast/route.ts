import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { callOpenRouter, generateOpenRouterAudio, CHEAP_MODEL, OpenRouterError } from "@/lib/ai/openrouter";
import {
  DEFAULT_PODCAST_DIALECT,
  MAX_EXPLICATION_CHARS_FOR_PODCAST,
  buildPodcastNarrationSystemPrompt,
  buildPodcastNarrationUserMessage,
  buildPodcastScriptSystemPrompt,
  buildPodcastScriptUserMessage,
  getFallbackPodcastScript,
  resolvePodcastDialect,
  type PodcastDialect,
} from "@/lib/ai/podcast-prompts";
import { encodePcm16ToMp3 } from "@/lib/audio/mp3-encoder";
import { lookupStudioPodcastCache, recordStudioPodcastCacheHit, storeStudioPodcastCache } from "@/lib/studio-podcast-cache";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { claimJob, completeJob, failJob } from "@/lib/studio-job-store";

export const runtime = "nodejs";
// REVERTED 800 -> 300: raising this to 800 (reasoning it should match
// Vercel's documented Fluid Compute ceiling) was itself UNVERIFIED — flagged
// as such in that same commit's own comment — and it broke real production
// deploys: the build itself completed cleanly (confirmed from the actual
// Vercel build log — "Compiled successfully", "Generating static pages",
// "Build Completed") but the deploy step failed every time, consistent with
// Vercel validating a route's `maxDuration` against the account's real plan
// entitlement AFTER a successful build, not during it — a mismatch there
// fails deployment, not compilation. 300 is the last value CONFIRMED to
// actually deploy across many prior commits this session.
//
// This does NOT fully re-open the original timeout bug: a real PC test
// showed the script+narration+encode+upload chain needing at least ~285s
// (19 heartbeats over that span, still not done at the old 300s cutoff),
// so a genuinely long episode can still exceed this ceiling. But the
// job/poll architecture below means that's now a WORSE-CASE degradation
// (the client's own retry loop starts a fresh attempt once
// lib/studio-job-store.ts's staleness window elapses), not a hard, opaque
// "échec de génération" — an acceptable trade-off against a completely
// blocked deployment. Revisit by empirically bisecting this account's real
// maxDuration ceiling (the same zero-cost sleep-based diagnostic-route
// technique already used once this session) before raising it again.
//
// Real calibration test: ~20 audio tokens/second, generated ~3.7x faster
// than real-time playback. A full 15 min (900s) episode is ~18,000 audio
// tokens, which at that same ratio suggests ~150-250s of wall-clock
// generation, PLUS the script-writing call, mp3 encoding, and Storage
// upload on top — the actual total that hit this ceiling in the real test.
export const maxDuration = 300;

const PODCAST_BUCKET = "studio-podcasts";
// Generous ceiling for a ~15 min episode at the calibrated ~20 audio
// tokens/second (900s x 20 = 18,000), plus headroom for the model's own
// hidden text pass alongside the audio (see the calibration test's usage
// breakdown — completion_tokens included both).
const AUDIO_MAX_TOKENS = 22_000;

interface CourseRow {
  id: number;
  title: string;
  explication: string | null;
  raw_text: string | null;
}

/** Mirrors app/api/studio/infographic/route.ts's ensureInfographicBucket exactly — a concurrent request can win the race to create the bucket, which is not a real failure. */
async function ensurePodcastBucket(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((bucket: { name: string }) => bucket.name === PODCAST_BUCKET)) return;

  const { error } = await supabase.storage.createBucket(PODCAST_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
}

/**
 * Plans the episode's script from the course's own Explication — a cheap
 * TEXT call, NOT the audio call. Falls back to FALLBACK_PODCAST_SCRIPT on
 * ANY failure (empty response, the call itself erroring) — a degraded-but-
 * real episode beats failing the whole "Podcast Audio" tab over a text
 * hiccup on what is fundamentally an audio-generation feature. Mirrors
 * app/api/studio/slides/route.ts's planSlideOutline exactly, minus the
 * JSON-schema step — the script IS the raw text, no parsing needed.
 */
async function planPodcastScript(courseTitle: string, explicationExcerpt: string, dialect: PodcastDialect): Promise<string> {
  try {
    const script = await callOpenRouter(
      [
        { role: "system", content: buildPodcastScriptSystemPrompt(dialect) },
        { role: "user", content: buildPodcastScriptUserMessage(courseTitle, explicationExcerpt) },
      ],
      { model: CHEAP_MODEL, maxTokens: 4000, bypassMock: true }
    );
    return script.trim().length > 100 ? script.trim() : getFallbackPodcastScript(dialect);
  } catch (error) {
    console.error("[studio/podcast] Échec écriture du script, repli sur le script par défaut:", errorMessage(error));
    return getFallbackPodcastScript(dialect);
  }
}

/**
 * "Podcast Audio" tab — cache-then-generate, mirroring
 * app/api/studio/slides/route.ts exactly, with one extra step:
 *  1. Hash this course's Explication, check studio_podcast_cache — a hit is
 *     served instantly, $0, regardless of which student asks.
 *  2. A miss reserves ONE quota unit for the whole episode, writes the
 *     spoken script with a cheap text call, narrates it in ONE streamed
 *     audio call (generateOpenRouterAudio), encodes the raw pcm16 to mp3
 *     (lib/audio/mp3-encoder.ts — pure JS, no ffmpeg binary needed), uploads
 *     it, and caches the URL BEFORE returning.
 *
 * RESPONSE SHAPE past the cache-hit/quota-gate checks — a background job,
 * not a synchronous result: `{success:true, status:"pending"}`,
 * `{success:true, status:"done", audioUrl, cached:false}`, or
 * `{success:true, status:"error", error, errorStatus}`, answered almost
 * instantly every time. See lib/studio-job-store.ts's own header comment
 * for the full mechanism and why this replaced (in order) a single held-open
 * request, then a heartbeat-streamed one: this step alone (script +
 * narration + mp3 encode + upload) legitimately takes 150-250+ seconds, and
 * this was one of only two Studio features (alongside Explication) ever
 * reported failing with "échec de génération" specifically on mobile — a
 * real, confirmed incident showed the earlier heartbeat-streamed attempt at
 * fixing this ITSELF failed unreliably on mobile (two separate Explication
 * attempts died within 2-23 seconds having received zero heartbeats, far too
 * early for an idle-connection theory). The real work now runs via
 * `waitUntil` while this response returns immediately; the client
 * (app/dashboard/module/[id]/page.tsx's "audio" branch, via
 * lib/poll-fetch.ts's startAndPoll) calls this SAME endpoint repeatedly
 * every few seconds — each individual poll is fast and independently
 * retryable, so a single flaky mobile request costs nothing. The cache-hit
 * and quota-gate-denied paths above return in milliseconds and stay
 * ordinary, non-streamed `NextResponse.json(...)` responses with real HTTP
 * status codes.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  // RATE_LIMITS.poll, not .ai — this endpoint is now polled every ~3s while
  // a background job runs (see lib/rate-limit.ts's own comment on `poll`);
  // the tighter .ai limit is checked separately, only on the branch that
  // actually kicks off a new (real, billed) generation, below.
  const rl = rateLimit(`studio-podcast:${user.id}`, RATE_LIMITS.poll);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { courseId, dialect: dialectRaw } = (body ?? {}) as { courseId?: unknown; dialect?: unknown };
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis." }, { status: 400 });
  }
  const dialect = resolvePodcastDialect(dialectRaw);
  // Only the ORIGINAL default (fr-darija) is cross-student cached —
  // studio_podcast_cache is keyed on content_hash alone, with no
  // language/dialect dimension. Extending that key would need a schema
  // migration this codebase has no confirmed-live tooling for (see this
  // project's own history of unconfirmed manual migrations); bypassing the
  // cache for the 3 new variants is the same safe pattern already
  // established for /api/studio/regenerate (a personalized request that
  // deliberately skips the shared cache).
  const isDefaultVariant = dialect === DEFAULT_PODCAST_DIALECT;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: course, error: courseError } = await supabase
    .from("studio_courses")
    .select("id, title, explication, raw_text")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle<CourseRow>();

  if (courseError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${courseError.message}` }, { status: 500 });
  }
  if (!course) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }
  // Prefers the polished Explication (better-structured input for a script)
  // when it exists, but no longer REQUIRES it — Studio sections are
  // independently generatable now (product reversal: a student can generate
  // Podcast Audio, or any other section, without ever touching Explication
  // first), matching the same explication ?? raw_text fallback already
  // established elsewhere (exam/generate, module-synthesis, search, chat).
  const sourceText = course.explication && course.explication.trim().length >= 50 ? course.explication : course.raw_text;
  if (!sourceText || sourceText.trim().length < 50) {
    return NextResponse.json({ success: false, error: "Ce cours n'a pas assez de contenu source pour générer un podcast." }, { status: 400 });
  }

  const contentHash = sha256(normalizeText(sourceText));

  try {
    if (isDefaultVariant) {
      const cachedUrl = await lookupStudioPodcastCache(contentHash);
      if (cachedUrl) {
        await recordStudioPodcastCacheHit(contentHash);
        return NextResponse.json({ success: true, audioUrl: cachedUrl, cached: true });
      }
    }

    // Job path deliberately keyed by courseId+dialect only (no per-attempt
    // nonce, unlike Explication's — see lib/studio-job-store.ts's own
    // comment on this route's job): Podcast has no "Régénérer" action, so a
    // "done" job here has the exact same lifetime/validity semantics as
    // studio_podcast_cache's own permanent cache entry above — reusing the
    // most recent completed result for this exact course+dialect is
    // correct, not stale.
    const jobPath = `podcast/${courseId}/${dialect}.json`;
    const claim = await claimJob<{ audioUrl: string }>(supabase, jobPath);

    if (!claim.claimed) {
      const existing = claim.existing;
      if (existing.status === "done") {
        return NextResponse.json({ success: true, status: "done", audioUrl: existing.result?.audioUrl, cached: false });
      }
      if (existing.status === "error") {
        return NextResponse.json({ success: true, status: "error", error: existing.error, errorStatus: existing.errorStatus });
      }
      return NextResponse.json({ success: true, status: "pending" });
    }

    // We won the claim — about to kick off a genuinely NEW, real, billed AI
    // call, so this is where the tighter RATE_LIMITS.ai gate belongs (see
    // this route's top-of-function rl check for why the general request
    // volume is gated separately, more loosely, via RATE_LIMITS.poll).
    const aiRl = rateLimit(`studio-podcast-ai:${user.id}`, RATE_LIMITS.ai);
    if (!aiRl.allowed) {
      const reason = "Trop de requêtes — réessaie dans quelques minutes.";
      await failJob(supabase, jobPath, reason, 429);
      return NextResponse.json({ success: true, status: "error", error: reason, errorStatus: 429 });
    }

    // Reserve quota NOW, exactly once (claimJob's own atomicity guarantees
    // this branch runs for only one caller per job).
    const quotaGate = await reserveGeneration(user);
    if (!quotaGate.allowed) {
      await failJob(supabase, jobPath, quotaGate.reason, 403);
      return NextResponse.json({ success: true, status: "error", error: quotaGate.reason, errorStatus: 403 });
    }

    // Kick off the real (slow, billed) generation in the background and
    // answer immediately — see lib/studio-job-store.ts's own header comment
    // for why: `waitUntil` keeps this invocation alive (bound by this
    // route's own `maxDuration`) to let the promise finish, but the CLIENT
    // never needs its own connection to survive that long — it just polls
    // this same endpoint again in a few seconds.
    waitUntil(
      (async () => {
        const excerpt = sourceText.slice(0, MAX_EXPLICATION_CHARS_FOR_PODCAST);
        const script = await planPodcastScript(course.title, excerpt, dialect);

        const { pcm16 } = await generateOpenRouterAudio(
          [
            { role: "system", content: buildPodcastNarrationSystemPrompt(dialect) },
            { role: "user", content: buildPodcastNarrationUserMessage(script) },
          ],
          { maxTokens: AUDIO_MAX_TOKENS, timeoutMs: 270_000 }
        );

        const mp3Buffer = await encodePcm16ToMp3(pcm16, 24_000, 1);

        await ensurePodcastBucket(supabase);
        // Non-default variants get their own path (dialect suffix) — never
        // overwrite the shared default-variant file at `${contentHash}.mp3`,
        // and never collide with each other (a student generating "en" then
        // "en-darija" for the same course must get 2 distinct files).
        const path = isDefaultVariant ? `${contentHash}.mp3` : `${contentHash}-${dialect}.mp3`;
        const { error: uploadError } = await supabase.storage
          .from(PODCAST_BUCKET)
          .upload(path, mp3Buffer, { contentType: "audio/mpeg", upsert: true });
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage.from(PODCAST_BUCKET).getPublicUrl(path);
        const audioUrl = publicUrlData.publicUrl;

        // Store BEFORE returning — the next student to hit this content_hash
        // benefits immediately. Fail-open: storeStudioPodcastCache logs its
        // own errors and never throws, so a caching hiccup can't block this
        // student's own successful generation. Only the default variant is
        // ever written to the shared cross-student cache — see this route's
        // own comment on `isDefaultVariant` above.
        if (isDefaultVariant) {
          await storeStudioPodcastCache(contentHash, audioUrl);
        }

        return { audioUrl };
      })()
        .then(({ audioUrl }) => completeJob(supabase, jobPath, { audioUrl }))
        .catch(async (error) => {
          await refundGeneration(user.id);
          const status = error instanceof OpenRouterError ? error.status : 502;
          const message = error instanceof OpenRouterError ? error.message : errorMessage(error);
          if (!(error instanceof OpenRouterError)) {
            console.error("[studio/podcast] Échec génération/upload:", error);
          }
          await failJob(supabase, jobPath, message, status);
        })
    );

    return NextResponse.json({ success: true, status: "pending" });
  } catch (error) {
    console.error("[studio/podcast] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
