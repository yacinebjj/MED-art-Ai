import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError, CHEAP_MODEL } from "@/lib/ai/openrouter";
import { buildDefinitiveFlashcardSetPrompt } from "@/lib/ai/flashcard-prompts";
import { FlashcardGenerationSchema } from "@/lib/ai/flashcard-schemas";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { lookupFlashcardsCache, storeFlashcardsCache, recordFlashcardsCacheHit, type FlashcardQA } from "@/lib/flashcards-content-cache";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { errorMessage, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Same definitive-set bounds as app/api/flashcards/generate/route.ts — both routes share ONE cross-student cache entry per explication, so they must ask the model for exactly the same thing. */
const MIN_DEFINITIVE_CARDS = 20;
const MAX_DEFINITIVE_CARDS = 30;

/** Same bound as app/api/flashcards/generate/route.ts's MAX_EXPLICATION_CHARS_FOR_FLASHCARDS. */
const MAX_EXPLICATION_CHARS_FOR_FLASHCARDS = 24_000;

const EXPLICATION_REQUIRED_MESSAGE =
  "Génère d'abord l'Explication Ultra-Détaillée de ce cours : les flashcards en sont extraites.";

interface StudioCourseRow {
  id: number;
  explication: string | null;
}

/** A cached row is written by this route OR app/api/flashcards/generate — never trust its shape blindly (an older app version could have stored something slightly different). Drops malformed entries instead of failing the whole deck. */
function sanitizeCachedCards(cards: FlashcardQA[]): FlashcardQA[] {
  return cards.filter(
    (card): card is FlashcardQA =>
      !!card &&
      typeof card === "object" &&
      typeof card.question === "string" &&
      typeof card.answer === "string" &&
      card.question.trim().length > 0 &&
      card.answer.trim().length > 0
  );
}

/**
 * Course-scoped flashcards for the workspace "Lab" (see
 * components/course/workspace/lab/FlashcardsLab.tsx). Unlike
 * app/api/flashcards/generate — which paginates a cross-course Study-page
 * deck through `studio_courses.flashcard_queue` — this returns the WHOLE
 * definitive set for ONE course in a single response; spaced-repetition
 * state lives client-side, so nothing here is written to `studio_courses`.
 *
 * Shares the exact same cross-student cache (flashcards_content_cache,
 * keyed by sha256(normalizeText(explication))) and the exact same
 * prompt/schema/model, so a set generated from either surface is reused,
 * for free, by the other.
 *
 * Body: `{ courseId: number }`.
 * Responses:
 * - 200 `{ success: true, cards: { question, answer }[], cached: boolean }`
 * - 409 `{ success: false, code: "explication_required", error }` — no Explication yet
 * - 400 / 401 / 403 (quota) / 404 / 429 (+ Retry-After) / 5xx `{ success: false, error }`
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-flashcards:${user.id}`, RATE_LIMITS.ai);
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
  if (typeof courseId !== "number" || !Number.isInteger(courseId) || courseId <= 0) {
    return NextResponse.json({ success: false, error: "'courseId' est requis (entier positif)." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: courseRow, error: courseError } = await supabase
    .from("studio_courses")
    .select("id, explication")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (courseError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${courseError.message}` }, { status: 500 });
  }
  if (!courseRow) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  const course = courseRow as StudioCourseRow;
  // A whitespace-only explication would hash to the same key as every
  // other empty one — treat it exactly like a missing one.
  if (!course.explication || course.explication.trim().length === 0) {
    return NextResponse.json(
      { success: false, code: "explication_required", error: EXPLICATION_REQUIRED_MESSAGE },
      { status: 409 }
    );
  }

  const explication = course.explication;
  const contentHash = sha256(normalizeText(explication));
  // Tracks whether a courseCap unit is currently held, so the outer catch
  // can refund it if anything unexpected throws after reservation.
  let reserved = false;

  try {
    // Cache hit: zero API cost, zero quota — same rule as every other cache in this app.
    const cached = await lookupFlashcardsCache(contentHash);
    if (cached) {
      const cards = sanitizeCachedCards(cached);
      if (cards.length > 0) {
        await recordFlashcardsCacheHit(contentHash);
        return NextResponse.json({ success: true, cards, cached: true });
      }
      // An empty/corrupt cached set falls through to a real generation,
      // whose upsert below then repairs the cache entry for everyone.
    }

    // One real generation EVENT = one courseCap unit, exactly like
    // app/api/flashcards/generate's Pass 2 — see reserveGeneration's comment.
    const quotaGate = await reserveGeneration(user);
    if (!quotaGate.allowed) {
      return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
    }
    reserved = true;

    let raw: string;
    try {
      const boundedExplication = explication.slice(0, MAX_EXPLICATION_CHARS_FOR_FLASHCARDS);
      const prompt = buildDefinitiveFlashcardSetPrompt(boundedExplication, MIN_DEFINITIVE_CARDS, MAX_DEFINITIVE_CARDS);
      raw = await callOpenRouter(
        [
          { role: "system", content: prompt },
          { role: "user", content: "Génère l'ensemble définitif de flashcards demandé." },
        ],
        // Identical model/limits to app/api/flashcards/generate — see the
        // CHEAP_MODEL rationale there. timeoutMs stays under maxDuration so
        // this fails cleanly (and refunds) before the platform kills it.
        { model: CHEAP_MODEL, maxTokens: 8000, bypassMock: true, timeoutMs: 50_000 }
      );
    } catch (error) {
      reserved = false;
      await refundGeneration(user.id);
      if (error instanceof OpenRouterError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      }
      console.error("[studio/flashcards] Échec appel IA (ensemble définitif):", error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }

    let definitiveSet: FlashcardQA[];
    try {
      const parsed = parseJsonResponse(raw);
      const result = FlashcardGenerationSchema.safeParse(parsed);
      if (!result.success) {
        console.error("[studio/flashcards] Validation zod échouée :", result.error.flatten());
        throw new Error("La réponse de l'IA ne respecte pas le schéma attendu.");
      }
      definitiveSet = result.data.flashcards.map((fc) => ({
        question: sanitizeForPostgres(fc.question),
        answer: sanitizeForPostgres(fc.answer),
      }));
    } catch (error) {
      reserved = false;
      await refundGeneration(user.id);
      console.error("[studio/flashcards] Parsing/validation échoué :", error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }

    // Fail-open by contract (see storeFlashcardsCache) — a caching hiccup
    // never blocks this student's own successful generation.
    await storeFlashcardsCache(contentHash, definitiveSet);

    return NextResponse.json({ success: true, cards: definitiveSet, cached: false });
  } catch (error) {
    // The cache helpers are fail-open and every expected post-reservation
    // failure above refunds and returns on its own, so this is a genuinely
    // unexpected throw — still never let it cost the student a quota unit.
    if (reserved) await refundGeneration(user.id);
    console.error("[studio/flashcards] Erreur non gérée:", error);
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }
}
