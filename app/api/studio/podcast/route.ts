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

export const runtime = "nodejs";
// 300s — the last value confirmed to actually deploy on this account (a
// prior attempt at 800, reasoning it should match Vercel's documented Fluid
// Compute ceiling, was itself unverified and broke real deploys — Vercel
// validates a route's `maxDuration` against the account's real plan
// entitlement AFTER a successful build, so a mismatch fails deployment, not
// compilation). AUDIO_MAX_TOKENS below keeps real generation time well
// under half of this, real margin instead of running flush against it.
export const maxDuration = 300;

const PODCAST_BUCKET = "studio-podcasts";
// RAISED 10,000 -> 15,000 alongside the script's own target length moving
// from ~700-900 words (~5-6 min) to ~1300-1500 words (~9-10 min) — product
// feedback that the 5-6 min cut felt too short/recap-only for real studying.
// Recalibrated against the SAME measured numbers that caused the original
// 22,000 -> 10,000 cut (see git history), not a fresh guess: a real ~15 min
// target previously measured 285s+ for the full script+narration+encode+
// upload pipeline and never finished — at this model's calibrated ~20 audio
// tokens/second output and ~3.7x-faster-than-real-time generation speed,
// that's ≈900s playback / 3.7 ≈ 243s of narration generation alone, against
// a 270s per-call timeout and a 300s route-wide platform ceiling — almost no
// margin left for anything else sharing that budget. A ~10 min target needs
// only ≈600s / 3.7 ≈ 162s of narration generation, leaving ~100s+ of real
// margin for the script call, mp3 encode, and upload. 15,000 tokens covers
// up to ~750s (12.5 min) of narration with room to spare above the ~10,800-
// 12,000 tokens a 9-10 min episode actually needs, without reapproaching the
// ~15 min failure point. NOT yet re-verified with a fresh live timing test at
// this exact length (the 5-6 min config's own real-world reliability is the
// only live confirmation this recalibration leans on) — watch production
// logs for "flux terminé sans résultat" after this ships, the same signal
// that caught the original incident.
const AUDIO_MAX_TOKENS = 15_000;

// Folded into studio_podcast_cache's content_hash below — content_hash is a
// PLAIN hash of the source text alone, with no dimension for "which script
// length/rules generated this episode". Without this, every course that
// already had a podcast generated under the old ~5-6 min script would keep
// serving that stale, cached mp3 forever (content_hash never changes just
// because the PROMPT changed), and the length/quality fix below would only
// ever reach brand-new courses. Bumping this string is the one line to touch
// whenever a future prompt/length change should invalidate every existing
// cached episode — cheap and migration-free (no schema change: it just makes
// old rows permanently unreachable by a fresh hash, not deleted).
const PODCAST_PROMPT_VERSION = "v3-longer-fallback";

interface CourseRow {
  id: number;
  title: string;
  explication: string | null;
  raw_text: string | null;
}

/**
 * Persists the generated podcast URL onto the student's OWN studio_courses
 * row, so it reloads deterministically regardless of which dialect was
 * generated or what the cross-student cache holds — the real fix for the
 * "podcast disappears on refresh" bug (see this column's own comment in
 * supabase/schema.sql). Best-effort: a write failure is logged, never thrown.
 */
async function persistAudioUrl(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  courseId: number,
  userId: string,
  audioUrl: string
): Promise<void> {
  const { error } = await supabase
    .from("studio_courses")
    .update({ audio_url: audioUrl })
    .eq("id", courseId)
    .eq("user_id", userId);
  if (error) {
    console.error("[studio/podcast] Persistance audio_url échouée (non bloquant):", error.message);
  }
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
 *
 * `timeoutMs: 60_000` — RAISED from an original 30_000 after a real
 * production incident (2026-09-28): students were reliably getting the
 * ~3-minute FALLBACK script (not the intended ~9-10 minute episode), which
 * traced back to this timeout being tighter than this app's OWN documented
 * OpenRouter behavior. lib/ai/openrouter.ts's OPENROUTER_CONNECT_TIMEOUT_MS
 * grants every OpenRouter call up to 60 SECONDS just for a slow-but-healthy
 * TCP/TLS connect phase (a real, previously-confirmed failure mode on this
 * exact API, see that constant's own comment) — a 30s abort here could fire
 * before the model ever received the request, let alone started writing,
 * on a day with nothing actually wrong. Sibling CHEAP_MODEL call sites with
 * comparable output size give it far more room relative to their own route
 * budget (e.g. app/api/flashcards/generate: maxTokens 8000, timeoutMs
 * 50_000 inside a 60s route; app/api/study/remediation-plan/generate:
 * maxTokens 8000, timeoutMs 110_000 inside a 120s route) — 30s for 6000
 * tokens was an outlier low, not a considered budget.
 *
 * 60s was NOT picked to fill the same fraction of this route's 300s budget
 * those single-call routes use (this route also has to run the narration
 * call after this one) — it was picked to comfortably clear the 60s
 * connect-phase allowance plus real generation time for ~6000 tokens, while
 * still leaving a deliberately reduced-but-ample ceiling for narration (see
 * this route's own narration call below, timeoutMs lowered 270_000 ->
 * 225_000 to keep the two calls' worst-case sum comfortably under this
 * route's 300s maxDuration, with real margin left for mp3 encode + upload +
 * bucket check — the previous 30_000 + 270_000 = 300_000 summed to EXACTLY
 * the platform ceiling with zero margin for anything after narration).
 * 225_000 still sits well above the ~162s of real narration generation time
 * the 9-10 min target needs (see AUDIO_MAX_TOKENS's own comment) — this is
 * not the real bottleneck, the script call's own timeout was.
 *
 * Deliberately still a SINGLE attempt, no app-level retry: a retry would
 * double this call's own worst case (now up to 120s instead of 60s),
 * eating directly into the same narration budget this comment just spent a
 * paragraph protecting — this codebase's own git history (see PODCAST route
 * header comment and this repo's platform-timeout incidents) is full of
 * exactly this class of "assumed cheap operation quietly outgrows its
 * budget" bug. If the fallback script is ever actually served, it's now
 * lengthened to independently clear the product's 7-minute floor on its own
 * (see FALLBACK_PODCAST_SCRIPT_BY_DIALECT's own comment) — the retry's
 * marginal reliability gain isn't worth reintroducing that risk.
 */
async function planPodcastScript(courseTitle: string, explicationExcerpt: string, dialect: PodcastDialect): Promise<string> {
  try {
    const script = await callOpenRouter(
      [
        { role: "system", content: buildPodcastScriptSystemPrompt(dialect) },
        { role: "user", content: buildPodcastScriptUserMessage(courseTitle, explicationExcerpt) },
      ],
      // 4000 -> 6000: the script's own target moved from ~700-900 to
      // ~1300-1500 words (see lib/ai/podcast-prompts.ts) — real headroom
      // above the ~2,500-3,200 tokens that length needs (mixed
      // français/darija tokenizes worse than plain prose).
      { model: CHEAP_MODEL, maxTokens: 6000, bypassMock: true, timeoutMs: 60_000 } // NOT raised: script (60s) + narration (225s) must stay inside this route's 300s maxDuration — see the budget notes above
    );
    if (script.trim().length > 100) return script.trim();
    // Distinctly tagged (not just the generic catch below) so this is
    // greppable in production logs on its own — this branch produced NO log
    // line at all before, which is exactly how the fallback going out far
    // more often than expected went unnoticed until a student reported it.
    console.error(
      `[studio/podcast][FALLBACK_SCRIPT_USED] Réponse trop courte (${script.trim().length} caractères) — repli sur le script par défaut.`
    );
    return getFallbackPodcastScript(dialect);
  } catch (error) {
    console.error(
      `[studio/podcast][FALLBACK_SCRIPT_USED] Échec écriture du script (${errorMessage(error)}) — repli sur le script par défaut.`
    );
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
 * RESPONSE SHAPE past the cache-hit/quota-gate checks — a STREAMED,
 * newline-delimited JSON body (Content-Type: application/x-ndjson), always
 * HTTP 200, NOT a single JSON object. See app/api/studio/generate/
 * explication-part/route.ts's own header comment for the full,
 * three-architecture history behind this design (held-open request ->
 * heartbeat stream -> background-job/poll -> back to heartbeat stream) —
 * this route went through the exact same history and the exact same
 * conclusion: a live diagnostic proved a real OpenRouter call run via
 * `waitUntil` can hang for 450+ seconds and never resolve, while the same
 * call directly awaited in the foreground (this design) completes reliably.
 * A `{"type":"heartbeat"}\n` line every 15 seconds keeps real bytes flowing
 * over the connection for the ~90-250+ seconds the script+narration+encode+
 * upload chain can legitimately take, defeating a mobile carrier's idle-NAT
 * drop without needing the connection to ever go quiet. The final line is
 * always `{"type":"result", success, ...}` — `success:false` carries a
 * `status` field with the LOGICAL status this failure would have had as a
 * plain response, since the transport status is stuck at 200. The cache-hit
 * and quota-gate-denied paths above return in milliseconds and stay
 * ordinary, non-streamed `NextResponse.json(...)` responses with real HTTP
 * status codes.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-podcast:${user.id}`, RATE_LIMITS.ai);
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

  // PODCAST_PROMPT_VERSION folded into the hash — see its own comment: bumping
  // it deliberately misses the cache for content already cached under an
  // older script length/rules, without a schema migration to add a real
  // version column.
  const contentHash = sha256(`${normalizeText(sourceText)}|${PODCAST_PROMPT_VERSION}`);

  if (isDefaultVariant) {
    const cachedUrl = await lookupStudioPodcastCache(contentHash);
    if (cachedUrl) {
      await recordStudioPodcastCacheHit(contentHash);
      // Persist even on a cache hit — this student's row may not yet point at
      // it, and the reload path now reads audio_url directly.
      await persistAudioUrl(supabase, courseId, user.id, cachedUrl);
      return NextResponse.json({ success: true, audioUrl: cachedUrl, cached: true });
    }
  }

  const quotaGate = await reserveGeneration(user);
  if (!quotaGate.allowed) {
    return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // See this route's own header comment for why this exists: keeps
      // real bytes flowing over the connection for the ~90-250+ seconds
      // the script+narration+encode+upload chain can legitimately take, so
      // a mobile carrier's NAT never sees this connection as idle long
      // enough to drop it.
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "heartbeat" })}\n`));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15_000);

      (async () => {
        const excerpt = sourceText.slice(0, MAX_EXPLICATION_CHARS_FOR_PODCAST);
        const script = await planPodcastScript(course.title, excerpt, dialect);

        // timeoutMs LOWERED 270_000 -> 225_000 alongside planPodcastScript's
        // own timeout being raised 30_000 -> 60_000 — see that function's own
        // comment for the full budget math. Still comfortably above the
        // ~162s of real narration generation time the 9-10 min script target
        // needs (see AUDIO_MAX_TOKENS's own comment above), just no longer
        // summing with the script call's worst case to exactly this route's
        // 300s maxDuration with zero margin left for mp3 encode/upload.
        const { pcm16 } = await generateOpenRouterAudio(
          [
            { role: "system", content: buildPodcastNarrationSystemPrompt(dialect) },
            { role: "user", content: buildPodcastNarrationUserMessage(script) },
          ],
          { maxTokens: AUDIO_MAX_TOKENS, timeoutMs: 225_000 }
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

        // Persist onto this student's own course row — the deterministic,
        // per-course, every-variant source of truth the reload path reads.
        await persistAudioUrl(supabase, courseId, user.id, audioUrl);

        return { audioUrl };
      })()
        .then(({ audioUrl }) => {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "result", success: true, audioUrl, cached: false })}\n`));
        })
        .catch(async (error) => {
          await refundGeneration(user.id);
          const status = error instanceof OpenRouterError ? error.status : 502;
          const message = error instanceof OpenRouterError ? error.message : errorMessage(error);
          if (!(error instanceof OpenRouterError)) {
            console.error("[studio/podcast] Échec génération/upload:", error);
          }
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "result", success: false, error: message, status })}\n`));
        })
        .finally(() => {
          clearInterval(heartbeatInterval);
          controller.close();
        });
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
