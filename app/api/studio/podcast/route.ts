import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { callOpenRouter, generateOpenRouterAudio, CHEAP_MODEL, OpenRouterError } from "@/lib/ai/openrouter";
import {
  FALLBACK_PODCAST_SCRIPT,
  MAX_EXPLICATION_CHARS_FOR_PODCAST,
  PODCAST_NARRATION_SYSTEM_PROMPT,
  PODCAST_SCRIPT_SYSTEM_PROMPT,
  buildPodcastNarrationUserMessage,
  buildPodcastScriptUserMessage,
} from "@/lib/ai/podcast-prompts";
import { encodePcm16ToMp3 } from "@/lib/audio/mp3-encoder";
import { lookupStudioPodcastCache, recordStudioPodcastCacheHit, storeStudioPodcastCache } from "@/lib/studio-podcast-cache";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";

export const runtime = "nodejs";
// Real calibration test: ~20 audio tokens/second, generated ~3.7x faster
// than real-time playback. A full 15 min (900s) episode is ~18,000 audio
// tokens, which at that same ratio suggests ~150-250s of wall-clock
// generation — same 300s ceiling as every other Studio generation route, but
// with less headroom than usual; the first thing to revisit if this route
// times out in practice is raising this further or trimming the script's
// target word count.
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
async function planPodcastScript(courseTitle: string, explicationExcerpt: string): Promise<string> {
  try {
    const script = await callOpenRouter(
      [
        { role: "system", content: PODCAST_SCRIPT_SYSTEM_PROMPT },
        { role: "user", content: buildPodcastScriptUserMessage(courseTitle, explicationExcerpt) },
      ],
      { model: CHEAP_MODEL, maxTokens: 4000, bypassMock: true }
    );
    return script.trim().length > 100 ? script.trim() : FALLBACK_PODCAST_SCRIPT;
  } catch (error) {
    console.error("[studio/podcast] Échec écriture du script, repli sur le script par défaut:", errorMessage(error));
    return FALLBACK_PODCAST_SCRIPT;
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

  const { courseId } = (body ?? {}) as { courseId?: unknown };
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: course, error: courseError } = await supabase
    .from("studio_courses")
    .select("id, title, explication")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle<CourseRow>();

  if (courseError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${courseError.message}` }, { status: 500 });
  }
  if (!course) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }
  if (!course.explication || course.explication.trim().length < 50) {
    return NextResponse.json(
      { success: false, error: "Génère d'abord l'Explication Ultra-Détaillée de ce cours — le podcast s'appuie dessus." },
      { status: 400 }
    );
  }

  const contentHash = sha256(normalizeText(course.explication));

  try {
    const cachedUrl = await lookupStudioPodcastCache(contentHash);
    if (cachedUrl) {
      await recordStudioPodcastCacheHit(contentHash);
      return NextResponse.json({ success: true, audioUrl: cachedUrl, cached: true });
    }

    const quotaGate = await reserveGeneration(user);
    if (!quotaGate.allowed) {
      return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
    }

    try {
      const excerpt = course.explication.slice(0, MAX_EXPLICATION_CHARS_FOR_PODCAST);
      const script = await planPodcastScript(course.title, excerpt);

      const { pcm16 } = await generateOpenRouterAudio(
        [
          { role: "system", content: PODCAST_NARRATION_SYSTEM_PROMPT },
          { role: "user", content: buildPodcastNarrationUserMessage(script) },
        ],
        { maxTokens: AUDIO_MAX_TOKENS, timeoutMs: 280_000 }
      );

      const mp3Buffer = await encodePcm16ToMp3(pcm16, 24_000, 1);

      await ensurePodcastBucket(supabase);
      const path = `${contentHash}.mp3`;
      const { error: uploadError } = await supabase.storage
        .from(PODCAST_BUCKET)
        .upload(path, mp3Buffer, { contentType: "audio/mpeg", upsert: true });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from(PODCAST_BUCKET).getPublicUrl(path);
      const audioUrl = publicUrlData.publicUrl;

      // Store BEFORE returning — the next student to hit this content_hash
      // benefits immediately. Fail-open: storeStudioPodcastCache logs its
      // own errors and never throws, so a caching hiccup can't block this
      // student's own successful generation.
      await storeStudioPodcastCache(contentHash, audioUrl);

      return NextResponse.json({ success: true, audioUrl, cached: false });
    } catch (error) {
      await refundGeneration(user.id);
      if (error instanceof OpenRouterError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      }
      console.error("[studio/podcast] Échec génération/upload:", error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }
  } catch (error) {
    console.error("[studio/podcast] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
