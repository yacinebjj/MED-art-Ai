import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import { STUDIO_MODEL } from "@/lib/ai/studio-prompts";
import { buildDefinitiveFlashcardSetPrompt } from "@/lib/ai/flashcard-prompts";
import { FlashcardGenerationSchema } from "@/lib/ai/flashcard-schemas";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { lookupFlashcardsCache, storeFlashcardsCache, recordFlashcardsCacheHit, type FlashcardQA } from "@/lib/flashcards-content-cache";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { errorMessage, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import type { FlashcardPoolItem } from "@/types/flashcard";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One batch size for both the very first load and every background top-up — see this route's header comment. 60 / 20 = 3 calls fill an entire session. */
const BATCH_SIZE = 20;

/** Hard ceiling on flashcards generated in one study session — protects API token spend and keeps the deck instantaneous. Mirrors ActiveFlashcardsDeck's own SESSION_CAP and /api/flashcards/pool's MAX_POOL_SIZE. */
const SESSION_CAP = 60;

/** Definitive-set size range — see buildDefinitiveFlashcardSetPrompt. Generous enough for real exam-relevant coverage of a full course, bounded so one course can't produce an unbounded deck. */
const MIN_DEFINITIVE_CARDS = 20;
const MAX_DEFINITIVE_CARDS = 30;

/** Explication text bounded before being sent to the model — same discipline as every other user/course-derived input this session (MAX_SOURCE_CHARS, MAX_HIGHLIGHT_CHARS, MAX_MESSAGE_CHARS). A real explication rarely approaches this. */
const MAX_EXPLICATION_CHARS_FOR_FLASHCARDS = 24_000;

interface StudioCourseRow {
  id: number;
  title: string;
  curriculum_module_id: number;
  explication: string | null;
  flashcard_queue: { id: string; question: string; answer: string }[] | null;
}

/**
 * DEFINITIVE-SET ARCHITECTURE (replaces per-call random-excerpt sampling):
 * every course's explication has exactly ONE canonical, cross-student
 * flashcard set (see lib/flashcards-content-cache.ts), generated once ever
 * platform-wide and reused by every student who studies that course. This
 * route's job on each call is to serve the next unseen SLICE of that
 * course's definitive set to THIS student — "unseen" tracked by how many
 * cards this student's own `studio_courses.flashcard_queue` already holds
 * for that course (not `sessionCount`, which blends multiple courses in one
 * session and can't be used as a per-course offset).
 *
 * Body: `{ sessionCount?: number }` — how many cards the caller's current
 * session deck already holds, across ALL courses. Only used for the
 * session-wide SESSION_CAP guardrail; per-course pagination uses the
 * persisted queue length instead (see above).
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`flashcards-generate:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // No body / empty body is fine — sessionCount just defaults to 0 below.
  }
  const rawSessionCount = (body as { sessionCount?: unknown })?.sessionCount;
  const sessionCount = typeof rawSessionCount === "number" && Number.isFinite(rawSessionCount) ? Math.max(0, rawSessionCount) : 0;

  if (sessionCount >= SESSION_CAP) {
    // The caller's deck already hit the session ceiling — nothing more to
    // generate. Not an error: this is the expected, quiet end of a session.
    return NextResponse.json({ success: true, items: [] });
  }
  const batchSize = Math.min(BATCH_SIZE, SESSION_CAP - sessionCount);

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("flashcard_active_module_ids")
    .eq("id", user.id)
    .maybeSingle<{ flashcard_active_module_ids: number[] | null }>();

  if (profileError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${profileError.message}` }, { status: 500 });
  }

  const activeModuleIds = profile?.flashcard_active_module_ids ?? [];
  if (activeModuleIds.length === 0) {
    return NextResponse.json({ success: false, error: "Aucun module actif." }, { status: 400 });
  }

  const { data: courses, error: coursesError } = await supabase
    .from("studio_courses")
    .select("id, title, curriculum_module_id, explication, flashcard_queue")
    .eq("user_id", user.id)
    .in("curriculum_module_id", activeModuleIds)
    .not("explication", "is", null);

  if (coursesError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${coursesError.message}` }, { status: 500 });
  }

  const eligibleCourses = (courses ?? []) as StudioCourseRow[];
  if (eligibleCourses.length === 0) {
    return NextResponse.json(
      { success: false, error: "Aucun cours avec une Explication générée dans tes modules actifs." },
      { status: 400 }
    );
  }

  // Load-balance across all eligible courses, same tie-break as before
  // (fewest queued first) — but now iterated in order rather than picking
  // just the top one, since the top pick might already be fully exhausted
  // (every card in its definitive set already served to this student) and
  // the route needs to fall through to the next course instead of returning
  // nothing when other courses still have unseen content.
  const orderedCourses = [...eligibleCourses].sort(
    (a, b) => (a.flashcard_queue?.length ?? 0) - (b.flashcard_queue?.length ?? 0)
  );

  async function serveFromCache(course: StudioCourseRow, cachedCards: FlashcardQA[], contentHash: string) {
    const alreadyServed = course.flashcard_queue?.length ?? 0;
    const slice = cachedCards.slice(alreadyServed, alreadyServed + batchSize);
    if (slice.length === 0) return null; // exhausted for this student — caller tries the next course

    await recordFlashcardsCacheHit(contentHash);

    const newItems = slice.map((fc) => ({ id: randomUUID(), question: fc.question, answer: fc.answer }));
    const updatedQueue = [...(course.flashcard_queue ?? []), ...newItems];
    const { error: updateError } = await supabase.from("studio_courses").update({ flashcard_queue: updatedQueue }).eq("id", course.id);
    if (updateError) {
      console.error("[flashcards/generate] Échec sauvegarde flashcard_queue (cache hit):", updateError);
    }

    const items: FlashcardPoolItem[] = newItems.map((item) => ({ ...item, courseTitle: course.title, moduleId: course.curriculum_module_id }));
    return items;
  }

  try {
    // Pass 1: serve from an already-cached, not-yet-exhausted course — zero
    // API cost, zero quota reservation (cache hits never consume quota,
    // same rule as every other cache in this app).
    for (const course of orderedCourses) {
      const contentHash = sha256(normalizeText(course.explication!));
      const cached = await lookupFlashcardsCache(contentHash);
      if (!cached) continue; // no definitive set yet for this course — candidate for Pass 2

      const items = await serveFromCache(course, cached, contentHash);
      if (items) return NextResponse.json({ success: true, items });
      // else: this course's set is exhausted for this student — try the next one
    }

    // Pass 2: no eligible course had unseen cached content — the first
    // course with NO definitive set at all gets one generated now. Plan
    // quota RESERVATION here (not per-card): this is now a single
    // generation EVENT per course, ever, platform-wide, so it shares
    // courseCap's "one real generation = one unit" semantics rather than
    // the old per-card counting — see reserveGeneration's own comment.
    const targetCourse = orderedCourses.find((course) => !course.flashcard_queue || course.flashcard_queue.length === 0)
      ?? orderedCourses[0];
    // ^ Prefer a course with zero queue (genuinely new to this student) as
    // the generation target when multiple lack a cached set — arbitrary but
    // deterministic tie-break, matching the old "fewest queued" spirit.

    if (!targetCourse) {
      return NextResponse.json({ success: true, items: [] }); // everything exhausted everywhere
    }

    const contentHash = sha256(normalizeText(targetCourse.explication!));

    const quotaGate = await reserveGeneration(user);
    if (!quotaGate.allowed) {
      return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
    }

    let raw: string;
    try {
      const boundedExplication = targetCourse.explication!.slice(0, MAX_EXPLICATION_CHARS_FOR_FLASHCARDS);
      const prompt = buildDefinitiveFlashcardSetPrompt(boundedExplication, MIN_DEFINITIVE_CARDS, MAX_DEFINITIVE_CARDS);
      raw = await callOpenRouter(
        [
          { role: "system", content: prompt },
          { role: "user", content: "Génère l'ensemble définitif de flashcards demandé." },
        ],
        { model: STUDIO_MODEL, maxTokens: 8000, bypassMock: true, timeoutMs: 50_000 } // route's own maxDuration is 60s — fail cleanly before the platform kills it
      );
    } catch (error) {
      await refundGeneration(user.id);
      if (error instanceof OpenRouterError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      }
      console.error("[flashcards/generate] Échec appel IA (ensemble définitif):", error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }

    let definitiveSet: FlashcardQA[];
    try {
      const parsed = parseJsonResponse(raw);
      const result = FlashcardGenerationSchema.safeParse(parsed);
      if (!result.success) {
        console.error("[flashcards/generate] Validation zod échouée :", result.error.flatten());
        throw new Error("La réponse de l'IA ne respecte pas le schéma attendu.");
      }
      definitiveSet = result.data.flashcards.map((fc) => ({
        question: sanitizeForPostgres(fc.question),
        answer: sanitizeForPostgres(fc.answer),
      }));
    } catch (error) {
      await refundGeneration(user.id);
      console.error("[flashcards/generate] Parsing/validation échoué :", error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }

    // Store BEFORE serving — the next student (or this one, next call) to
    // hit this content_hash benefits immediately. Fail-open: a caching
    // hiccup can't block this student's own successful generation.
    await storeFlashcardsCache(contentHash, definitiveSet);

    const items = await serveFromCache(targetCourse, definitiveSet, contentHash);
    // ^ Reuses the exact same slicing/persistence/response-shaping logic as
    // a genuine cache hit — this student's own first slice of what they
    // just paid to generate. Cannot be null: a brand-new set always has at
    // least MIN_DEFINITIVE_CARDS, and alreadyServed was 0 or would have hit
    // Pass 1 instead.

    return NextResponse.json({ success: true, items: items ?? [] });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[flashcards/generate] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }
}
