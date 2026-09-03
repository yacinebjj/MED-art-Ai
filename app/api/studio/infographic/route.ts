import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { generateOpenRouterImage, OpenRouterError } from "@/lib/ai/openrouter";
import {
  DEFAULT_INFOGRAPHIC_LANGUAGE,
  DEFAULT_INFOGRAPHIC_MODEL_KEY,
  INFOGRAPHIC_MODEL_OPTIONS,
  MAX_EXPLICATION_CHARS_FOR_INFOGRAPHIC,
  buildInfographicSystemPrompt,
  buildInfographicUserMessage,
  resolveInfographicLanguage,
  resolveInfographicModelKey,
} from "@/lib/ai/infographic-prompts";
import {
  lookupStudioInfographicCache,
  recordStudioInfographicCacheHit,
  storeStudioInfographicCache,
} from "@/lib/studio-infographic-cache";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";

export const runtime = "nodejs";
// Real test generation took ~10.4s — 300s (same class as /api/studio/generate)
// is generous headroom, never the expected duration.
export const maxDuration = 300;

const INFOGRAPHIC_BUCKET = "studio-infographics";

interface CourseRow {
  id: number;
  title: string;
  explication: string | null;
}

/** Mirrors app/api/upload/route.ts's ensureSourceFilesBucket exactly — a concurrent request can win the race to create the bucket between the listBuckets check and this call, which is not a real failure. */
async function ensureInfographicBucket(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((bucket: { name: string }) => bucket.name === INFOGRAPHIC_BUCKET)) return;

  const { error } = await supabase.storage.createBucket(INFOGRAPHIC_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
}

/** `data:image/png;base64,AAAA...` -> { buffer, contentType }. Throws if the shape doesn't match — a malformed data URL here means the model response parsing (lib/ai/openrouter.ts) already found something wrong. */
function decodeImageDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } {
  const match = /^data:(image\/\w+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Format d'image inattendu renvoyé par le modèle.");
  }
  return { buffer: Buffer.from(match[2], "base64"), contentType: match[1] };
}

/**
 * "Infographie / Mindmap" tab — cache-then-generate, mirroring
 * app/api/flashcards/generate/route.ts's own Pass 1/Pass 2 shape:
 *  1. Hash this course's Explication text, check studio_infographic_cache —
 *     a hit is served instantly, $0, regardless of which student asks.
 *  2. A miss reserves quota, calls google/gemini-3.1-flash-image-preview
 *     (lib/ai/openrouter.ts's generateOpenRouterImage), uploads the result to
 *     Supabase Storage, and stores the URL in the cache BEFORE returning —
 *     so the very next student (of up to 4 000) to open this same course
 *     gets it for free.
 *
 * Deliberately its OWN route, not folded into the generic
 * /api/studio/generate pipeline: that pipeline's whole contract (Zod schema
 * validation, a studio_courses JSON/text column to save into) doesn't apply
 * to an image response — see lib/demo-content.ts's JsonSectionId comment for
 * why "infographic" is excluded from every one of those mappings.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-infographic:${user.id}`, RATE_LIMITS.ai);
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

  const { courseId, language: languageRaw, model: modelKeyRaw } = (body ?? {}) as {
    courseId?: unknown;
    language?: unknown;
    model?: unknown;
  };
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis." }, { status: 400 });
  }
  const language = resolveInfographicLanguage(languageRaw);
  const modelKey = resolveInfographicModelKey(modelKeyRaw);
  // Only the ORIGINAL default (French, nano-banana-2) is cross-student
  // cached — studio_infographic_cache is keyed on content_hash alone, with
  // no language/model dimension. Same bypass-rather-than-migrate pattern as
  // /api/studio/podcast — see that route's own comment.
  const isDefaultVariant = language === DEFAULT_INFOGRAPHIC_LANGUAGE && modelKey === DEFAULT_INFOGRAPHIC_MODEL_KEY;

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
      { success: false, error: "Génère d'abord l'Explication Ultra-Détaillée de ce cours — l'infographie s'appuie dessus." },
      { status: 400 }
    );
  }

  const contentHash = sha256(normalizeText(course.explication));

  try {
    if (isDefaultVariant) {
      const cachedUrl = await lookupStudioInfographicCache(contentHash);
      if (cachedUrl) {
        await recordStudioInfographicCacheHit(contentHash);
        return NextResponse.json({ success: true, imageUrl: cachedUrl, cached: true });
      }
    }

    const quotaGate = await reserveGeneration(user);
    if (!quotaGate.allowed) {
      return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
    }

    try {
      const excerpt = course.explication.slice(0, MAX_EXPLICATION_CHARS_FOR_INFOGRAPHIC);
      const { imageDataUrl } = await generateOpenRouterImage(
        [
          { role: "system", content: buildInfographicSystemPrompt(language) },
          { role: "user", content: buildInfographicUserMessage(course.title, excerpt) },
        ],
        { model: INFOGRAPHIC_MODEL_OPTIONS[modelKey].id }
      );

      const { buffer, contentType } = decodeImageDataUrl(imageDataUrl);

      await ensureInfographicBucket(supabase);
      const extension = contentType.split("/")[1] ?? "png";
      // Non-default variants get their own path (language+model suffix) —
      // never overwrite the shared default-variant file, never collide with
      // each other across variants of the same course.
      const path = isDefaultVariant ? `${contentHash}.${extension}` : `${contentHash}-${language}-${modelKey}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from(INFOGRAPHIC_BUCKET)
        .upload(path, buffer, { contentType, upsert: true });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from(INFOGRAPHIC_BUCKET).getPublicUrl(path);
      const imageUrl = publicUrlData.publicUrl;

      // Store BEFORE returning — the next student to hit this content_hash
      // benefits immediately. Fail-open: storeStudioInfographicCache logs
      // its own errors and never throws, so a caching hiccup can't block
      // this student's own successful generation. Only the default variant
      // is ever written to the shared cross-student cache — see this
      // route's own comment on `isDefaultVariant` above.
      if (isDefaultVariant) {
        await storeStudioInfographicCache(contentHash, imageUrl);
      }

      return NextResponse.json({ success: true, imageUrl, cached: false });
    } catch (error) {
      await refundGeneration(user.id);
      if (error instanceof OpenRouterError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      }
      console.error("[studio/infographic] Échec génération/upload:", error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }
  } catch (error) {
    console.error("[studio/infographic] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
