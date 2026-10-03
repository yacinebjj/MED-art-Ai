import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { CHEAP_MODEL } from "@/lib/ai/openrouter";
import { callOpenRouterResilient } from "@/lib/ai/call-resilient";
import { buildDefinitiveFlashcardSetPrompt, buildFlashcardExtensionPrompt } from "@/lib/ai/flashcard-prompts";
import { FlashcardGenerationSchema } from "@/lib/ai/flashcard-schemas";
import { buildLanguageDirective, parseContentLanguage, type ContentLanguage } from "@/lib/ai/language-directive";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import {
  appendFlashcardsCache,
  lookupFlashcardsCacheBatch,
  recordFlashcardsCacheHit,
  storeFlashcardsCache,
  type FlashcardQA,
} from "@/lib/flashcards-content-cache";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { errorMessage, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import type { FlashcardPoolItem } from "@/types/flashcard";

export const runtime = "nodejs";
// At most ONE model call per request (90s timeout) + a few Supabase round trips.
export const maxDuration = 120;

/** One study batch. The deck asks for the next one when the student nears the end of the current one. */
const BATCH_SIZE = 25;

/** First ("definitive") set of a course — see buildDefinitiveFlashcardSetPrompt. */
const MIN_DEFINITIVE_CARDS = 20;
const MAX_DEFINITIVE_CARDS = 30;

/** Cards added to a course's set each time a student has seen all of it. */
const EXTENSION_SIZE = 25;

/** Same bound as before on the explication text sent to the model. */
const MAX_EXPLICATION_CHARS_FOR_FLASHCARDS = 24_000;

/** Existing questions quoted to the model on an extension — enough to steer it away from repeats without blowing the prompt up. */
const MAX_EXISTING_QUESTIONS_IN_PROMPT = 160;

/** One card in a student's per-course history (studio_courses.flashcard_queue). `lang` is absent on cards served before languages existed — those were French. */
interface QueueCard {
  id: string;
  question: string;
  answer: string;
  lang?: ContentLanguage;
}

interface StudioCourseRow {
  id: number;
  title: string;
  curriculum_module_id: number;
  explication: string | null;
  flashcard_queue: QueueCard[] | null;
}

interface CandidateCard extends FlashcardQA {
  course: StudioCourseRow;
}

/** Fisher-Yates — uniform, unlike `.sort(() => Math.random() - 0.5)`. */
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function questionKey(question: string): string {
  return normalizeText(question);
}

/**
 * Cross-student cache key of one course's set IN ONE LANGUAGE. French keeps
 * the historical key (sha256 of the normalized explication) so every set
 * already cached stays valid; English gets a distinct ":en" row.
 */
function cacheKeyFor(explication: string, language: ContentLanguage): string {
  const base = sha256(normalizeText(explication));
  return language === "en" ? `${base}:en` : base;
}

/** Cards of `cached` this student has not been served yet in this language (matched by normalized question, so order and later extensions don't matter). */
function unseenCards(course: StudioCourseRow, cached: FlashcardQA[], language: ContentLanguage): FlashcardQA[] {
  const served = new Set(
    (course.flashcard_queue ?? []).filter((card) => (card.lang ?? "fr") === language).map((card) => questionKey(card.question))
  );
  const result: FlashcardQA[] = [];
  for (const card of cached) {
    const key = questionKey(card.question);
    if (served.has(key)) continue;
    served.add(key); // also dedupes repeats inside the cached set itself
    result.push(card);
  }
  return result;
}

function parseGeneratedCards(raw: string): FlashcardQA[] {
  const parsed = parseJsonResponse(raw);
  const result = FlashcardGenerationSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[flashcards/generate] Validation zod échouée :", result.error.flatten());
    throw new Error("La réponse de l'IA ne respecte pas le schéma attendu.");
  }
  return result.data.flashcards.map((fc) => ({
    question: sanitizeForPostgres(fc.question.trim()),
    answer: sanitizeForPostgres(fc.answer.trim()),
  }));
}

/**
 * POST /api/flashcards/generate — body `{ language?: "fr" | "en" }`.
 *
 * Returns the NEXT batch of up to 25 cards the student has not seen yet,
 * MIXED across every course of the current selection (the courses ticked in
 * the picker, or every course of the activated modules when none is ticked):
 *  1. All unseen cards of all selected courses are pooled and shuffled
 *     (Fisher-Yates) BEFORE the batch is cut — a batch is never "all of
 *     course A, then course B".
 *  2. If fewer than 25 unseen cards remain, ONE generation happens first:
 *     a course with no set yet gets its first set; otherwise the course with
 *     the fewest unseen cards gets an EXTENSION (new cards that don't repeat
 *     its existing ones), appended to the cross-student cache. Either costs
 *     one plan generation (refunded on failure). This is what makes the
 *     study flow endless.
 *  3. Served cards are appended to each course's flashcard_queue (with their
 *     language), which is both the student's history and what "unseen"
 *     is computed against.
 * At most one model call per request bounds latency and spend; the deck
 * only asks again once the student is close to the end of a batch.
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
    // An empty body is fine — defaults apply.
  }
  const language = parseContentLanguage((body as { language?: unknown })?.language);

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("flashcard_active_module_ids, flashcard_active_course_ids")
    .eq("id", user.id)
    .maybeSingle<{ flashcard_active_module_ids: number[] | null; flashcard_active_course_ids: number[] | null }>();

  if (profileError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${profileError.message}` }, { status: 500 });
  }

  const activeModuleIds = profile?.flashcard_active_module_ids ?? [];
  const activeCourseIds = profile?.flashcard_active_course_ids ?? [];
  if (activeModuleIds.length === 0) {
    return NextResponse.json({ success: false, error: "Aucun module actif." }, { status: 400 });
  }

  // STRICT course selection: ticked courses only (still inside the active
  // modules, always the student's own rows); nothing ticked = whole modules.
  let coursesQuery = supabase
    .from("studio_courses")
    .select("id, title, curriculum_module_id, explication, flashcard_queue")
    .eq("user_id", user.id)
    .in("curriculum_module_id", activeModuleIds)
    .not("explication", "is", null);
  if (activeCourseIds.length > 0) coursesQuery = coursesQuery.in("id", activeCourseIds);
  const { data: courses, error: coursesError } = await coursesQuery;

  if (coursesError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${coursesError.message}` }, { status: 500 });
  }

  const eligibleCourses = ((courses ?? []) as StudioCourseRow[]).filter((course) => course.explication && course.explication.trim());
  if (eligibleCourses.length === 0) {
    return NextResponse.json(
      { success: false, error: "Aucun cours avec une Explication générée dans ta sélection." },
      { status: 400 }
    );
  }

  const cacheKeys = new Map(eligibleCourses.map((course) => [course.id, cacheKeyFor(course.explication!, language)]));
  const cachedByKey = await lookupFlashcardsCacheBatch(Array.from(cacheKeys.values()));
  const cachedSetFor = (course: StudioCourseRow) => cachedByKey.get(cacheKeys.get(course.id)!) ?? null;

  const unseenByCourse = new Map<number, FlashcardQA[]>();
  for (const course of eligibleCourses) {
    const cached = cachedSetFor(course);
    unseenByCourse.set(course.id, cached ? unseenCards(course, cached, language) : []);
  }
  const totalUnseen = () => Array.from(unseenByCourse.values()).reduce((sum, cards) => sum + cards.length, 0);

  let generated: "definitive" | "extension" | null = null;
  let quotaReached = false;

  // ---- 2. ONE generation when needed: a selected course that has no set yet
  // (so every ticked course really ends up in the mix), or — once all have
  // one — an extension when fewer than a batch of unseen cards remain.
  const withoutSet = eligibleCourses.filter((course) => !cachedSetFor(course));
  if (withoutSet.length > 0 || totalUnseen() < BATCH_SIZE) {
    const target =
      withoutSet.length > 0
        ? withoutSet[Math.floor(Math.random() * withoutSet.length)]
        : [...eligibleCourses].sort((a, b) => (unseenByCourse.get(a.id)?.length ?? 0) - (unseenByCourse.get(b.id)?.length ?? 0))[0];
    const mode: "definitive" | "extension" = withoutSet.length > 0 ? "definitive" : "extension";
    const key = cacheKeys.get(target.id)!;
    const existingSet = cachedSetFor(target) ?? [];

    const gate = await reserveGeneration(user);
    if (!gate.allowed) {
      quotaReached = true;
      if (totalUnseen() === 0) {
        return NextResponse.json({ success: false, error: gate.reason, code: "quota" }, { status: 403 });
      }
    } else {
      try {
        const explication = target.explication!.slice(0, MAX_EXPLICATION_CHARS_FOR_FLASHCARDS);
        const systemPrompt =
          (mode === "definitive"
            ? buildDefinitiveFlashcardSetPrompt(explication, MIN_DEFINITIVE_CARDS, MAX_DEFINITIVE_CARDS)
            : buildFlashcardExtensionPrompt(
                explication,
                existingSet.slice(-MAX_EXISTING_QUESTIONS_IN_PROMPT).map((card) => card.question),
                EXTENSION_SIZE
              )) + buildLanguageDirective(language);
        const raw = await callOpenRouterResilient(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: mode === "definitive" ? "Génère l'ensemble définitif de flashcards demandé." : "Génère les nouvelles flashcards demandées." },
          ],
          { model: CHEAP_MODEL, maxTokens: 8000, bypassMock: true, timeoutMs: 90_000 }
        );
        const cards = parseGeneratedCards(raw);

        if (mode === "definitive") {
          await storeFlashcardsCache(key, cards);
          cachedByKey.set(key, cards);
        } else {
          // Only genuinely new questions are kept — a model that repeats itself must not grow the set with duplicates.
          const existingKeys = new Set(existingSet.map((card) => questionKey(card.question)));
          const fresh = cards.filter((card) => {
            const k = questionKey(card.question);
            if (existingKeys.has(k)) return false;
            existingKeys.add(k);
            return true;
          });
          if (fresh.length === 0) throw new Error("L'IA n'a produit aucune flashcard réellement nouvelle. Réessaie.");
          await appendFlashcardsCache(key, fresh);
          cachedByKey.set(key, [...existingSet, ...fresh]);
        }
        unseenByCourse.set(target.id, unseenCards(target, cachedByKey.get(key)!, language));
        generated = mode;
      } catch (error) {
        await refundGeneration(user.id);
        console.error(`[flashcards/generate] Échec génération (${mode}, cours ${target.id}):`, error);
        // Still serve whatever unseen cards exist; only fail when there are none at all.
        if (totalUnseen() === 0) {
          return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
        }
      }
    }
  }

  // ---- 1. Pool every unseen card of every selected course, shuffle, cut one batch.
  const pool: CandidateCard[] = [];
  for (const course of eligibleCourses) {
    for (const card of unseenByCourse.get(course.id) ?? []) pool.push({ ...card, course });
  }
  const batch = shuffle(pool).slice(0, BATCH_SIZE);

  if (batch.length === 0) {
    return NextResponse.json({ success: true, items: [] satisfies FlashcardPoolItem[], generated, quotaReached, remainingUnseen: 0 });
  }

  // ---- 3. Record what was served, per course, in this language.
  const servedByCourse = new Map<number, QueueCard[]>();
  const items: FlashcardPoolItem[] = batch.map((card) => {
    const id = randomUUID();
    const list = servedByCourse.get(card.course.id) ?? [];
    list.push({ id, question: card.question, answer: card.answer, lang: language });
    servedByCourse.set(card.course.id, list);
    return { id, question: card.question, answer: card.answer, courseTitle: card.course.title, moduleId: card.course.curriculum_module_id };
  });

  await Promise.all(
    Array.from(servedByCourse.entries()).map(async ([courseId, served]) => {
      const course = eligibleCourses.find((c) => c.id === courseId)!;
      const { error } = await supabase
        .from("studio_courses")
        .update({ flashcard_queue: [...(course.flashcard_queue ?? []), ...served] })
        .eq("id", courseId)
        .eq("user_id", user.id);
      if (error) console.error(`[flashcards/generate] Échec sauvegarde flashcard_queue (cours ${courseId}):`, error.message);
      void recordFlashcardsCacheHit(cacheKeys.get(courseId)!);
    })
  );

  return NextResponse.json({
    success: true,
    items,
    generated,
    quotaReached,
    remainingUnseen: Math.max(0, pool.length - batch.length),
  });
}
