import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage, parseJsonResponse } from "@/lib/course-generation-shared";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { callOpenRouter, generateOpenRouterImage, CHEAP_MODEL, OpenRouterError } from "@/lib/ai/openrouter";
import {
  FALLBACK_SLIDE_OUTLINE,
  MAX_EXPLICATION_CHARS_FOR_SLIDES,
  SLIDE_OUTLINE_SYSTEM_PROMPT,
  SLIDE_STYLE_SYSTEM_PROMPT,
  SlideOutlineSchema,
  buildSlideImageUserMessage,
  buildSlideOutlineUserMessage,
  type SlideOutlineItem,
} from "@/lib/ai/slides-prompts";
import { lookupStudioSlidesCache, recordStudioSlidesCacheHit, storeStudioSlidesCache } from "@/lib/studio-slides-cache";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";

export const runtime = "nodejs";
// Real test: 4 parallel image calls took ~20s wall-clock; a 6-slide deck
// plus the planning call comfortably fits well under this, same class of
// headroom as /api/studio/generate.
export const maxDuration = 300;

const SLIDES_BUCKET = "studio-slides";

interface CourseRow {
  id: number;
  title: string;
  explication: string | null;
}

/** Mirrors app/api/studio/infographic/route.ts's ensureInfographicBucket exactly — a concurrent request can win the race to create the bucket, which is not a real failure. */
async function ensureSlidesBucket(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((bucket: { name: string }) => bucket.name === SLIDES_BUCKET)) return;

  const { error } = await supabase.storage.createBucket(SLIDES_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
}

/** `data:image/png;base64,AAAA...` -> { buffer, contentType }. Mirrors app/api/studio/infographic/route.ts's decodeImageDataUrl exactly. */
function decodeImageDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } {
  const match = /^data:(image\/\w+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Format d'image inattendu renvoyé par le modèle.");
  }
  return { buffer: Buffer.from(match[2], "base64"), contentType: match[1] };
}

/**
 * Plans the deck's slides from the course's own Explication — a cheap TEXT
 * call, NOT an image call. Falls back to FALLBACK_SLIDE_OUTLINE (a fixed,
 * generic-but-reasonable structure) on ANY failure (bad JSON, schema
 * mismatch, the call itself erroring) — a degraded-but-still-real deck beats
 * failing the whole "Slides" tab over a text-planning hiccup on what is
 * fundamentally an image-generation feature.
 */
async function planSlideOutline(courseTitle: string, explicationExcerpt: string): Promise<SlideOutlineItem[]> {
  try {
    const raw = await callOpenRouter(
      [
        { role: "system", content: SLIDE_OUTLINE_SYSTEM_PROMPT },
        { role: "user", content: buildSlideOutlineUserMessage(courseTitle, explicationExcerpt) },
      ],
      { model: CHEAP_MODEL, maxTokens: 3000, bypassMock: true }
    );
    const parsed = parseJsonResponse(raw);
    const result = SlideOutlineSchema.safeParse(parsed);
    if (!result.success) {
      console.error("[studio/slides] Plan de diapositives hors-schéma, repli sur le plan par défaut:", result.error.flatten());
      return FALLBACK_SLIDE_OUTLINE;
    }
    return result.data.slides;
  } catch (error) {
    console.error("[studio/slides] Échec planification, repli sur le plan par défaut:", errorMessage(error));
    return FALLBACK_SLIDE_OUTLINE;
  }
}

/**
 * "Slides" tab — cache-then-generate, mirroring
 * app/api/studio/infographic/route.ts exactly, with one extra step:
 *  1. Hash this course's Explication, check studio_slides_cache — a hit is
 *     served instantly, $0, regardless of which student asks.
 *  2. A miss reserves ONE quota unit for the whole deck (not one per slide —
 *     same "one generation event" convention as every other cache-backed
 *     Studio feature), plans SLIDE_COUNT_TARGET slide briefs with a cheap
 *     text call, then generates every slide's IMAGE in parallel
 *     (Promise.all) using the exact same style prompt so independently-
 *     generated slides still look like one coherent deck. ALL slides must
 *     succeed before anything is cached or returned — a partially-generated
 *     deck cached forever would be a real, permanent bug affecting every
 *     future student who opens this course.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-slides:${user.id}`, RATE_LIMITS.ai);
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
      { success: false, error: "Génère d'abord l'Explication Ultra-Détaillée de ce cours — les diapositives s'appuient dessus." },
      { status: 400 }
    );
  }

  const contentHash = sha256(normalizeText(course.explication));

  try {
    const cachedUrls = await lookupStudioSlidesCache(contentHash);
    if (cachedUrls) {
      await recordStudioSlidesCacheHit(contentHash);
      return NextResponse.json({ success: true, slideUrls: cachedUrls, cached: true });
    }

    const quotaGate = await reserveGeneration(user);
    if (!quotaGate.allowed) {
      return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
    }

    try {
      const excerpt = course.explication.slice(0, MAX_EXPLICATION_CHARS_FOR_SLIDES);
      const outline = await planSlideOutline(course.title, excerpt);
      const total = outline.length;

      const generated = await Promise.all(
        outline.map(async (slide, i) => {
          const { imageDataUrl } = await generateOpenRouterImage([
            { role: "system", content: SLIDE_STYLE_SYSTEM_PROMPT },
            { role: "user", content: buildSlideImageUserMessage(i + 1, total, course.title, slide) },
          ]);
          return decodeImageDataUrl(imageDataUrl);
        })
      );

      await ensureSlidesBucket(supabase);
      const slideUrls = await Promise.all(
        generated.map(async ({ buffer, contentType }, i) => {
          const extension = contentType.split("/")[1] ?? "png";
          const path = `${contentHash}/slide-${i}.${extension}`;
          const { error: uploadError } = await supabase.storage.from(SLIDES_BUCKET).upload(path, buffer, { contentType, upsert: true });
          if (uploadError) throw uploadError;
          const { data: publicUrlData } = supabase.storage.from(SLIDES_BUCKET).getPublicUrl(path);
          return publicUrlData.publicUrl;
        })
      );

      // Store BEFORE returning — the next student to hit this content_hash
      // benefits immediately. Fail-open: storeStudioSlidesCache logs its own
      // errors and never throws, so a caching hiccup can't block this
      // student's own successful generation.
      await storeStudioSlidesCache(contentHash, slideUrls);

      return NextResponse.json({ success: true, slideUrls, cached: false });
    } catch (error) {
      await refundGeneration(user.id);
      if (error instanceof OpenRouterError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      }
      console.error("[studio/slides] Échec génération/upload:", error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }
  } catch (error) {
    console.error("[studio/slides] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
