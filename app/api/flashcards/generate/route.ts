import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import { STUDIO_MODEL } from "@/lib/ai/studio-prompts";
import { buildFlashcardGenerationPrompt } from "@/lib/ai/flashcard-prompts";
import { FlashcardGenerationSchema } from "@/lib/ai/flashcard-schemas";
import { pickRandomExcerpt } from "@/lib/flashcard-excerpt";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveFlashcards, refundFlashcards } from "@/lib/subscription";
import { errorMessage, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import type { FlashcardPoolItem } from "@/types/flashcard";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One batch size for both the very first load and every background top-up — see this route's header comment. 60 / 20 = 3 calls fill an entire session. */
const BATCH_SIZE = 20;

/** Hard ceiling on flashcards generated in one study session — protects API token spend and keeps the deck instantaneous. Mirrors ActiveFlashcardsDeck's own SESSION_CAP and /api/flashcards/pool's MAX_POOL_SIZE. */
const SESSION_CAP = 60;

interface StudioCourseRow {
  id: number;
  title: string;
  curriculum_module_id: number;
  explication: string | null;
  flashcard_queue: { id: string; question: string; answer: string }[] | null;
}

/**
 * Generates one fresh batch of Anki-style Q&A flashcards from a random
 * excerpt of ONE of the student's active-module courses (picked as whichever
 * eligible course currently has the fewest queued cards, so coverage
 * balances out across all activated modules over repeated calls), appends
 * them to that course's `studio_courses.flashcard_queue`, and returns just
 * the new items — the frontend (ActiveFlashcardsDeck) appends them to its
 * in-memory deck directly rather than re-fetching the whole pool, which is
 * what keeps this feeling instant/background rather than a full reload.
 *
 * Body: `{ sessionCount?: number }` — how many cards the caller's current
 * session deck already holds. Enforces SESSION_CAP server-side (not just
 * trusting the frontend to stop asking): once `sessionCount` is already at
 * or past the cap, or would only partially fit, the batch is clamped or
 * skipped entirely — this is the real token-spend guardrail, the frontend's
 * own check is just the fast path that avoids the round-trip.
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
  const requestedBatchSize = Math.min(BATCH_SIZE, SESSION_CAP - sessionCount);

  // Plan quota RESERVATION — atomically reserves up to requestedBatchSize
  // against the monthly card cap and returns how many were actually granted
  // (see reserveFlashcards's own comment — closes a TOCTOU race the old
  // read-then-clamp split had: two concurrent requests could both read "8
  // remaining" and both generate 8, landing 8 over cap). Clamped rather than
  // blocked outright — a student with 8 cards left should still get 8, same
  // spirit as the SESSION_CAP clamp above. Only a fully exhausted quota (0
  // granted) returns an error. If generation below produces fewer cards
  // than reserved, or fails outright, refundFlashcards() gives back the
  // difference/full amount.
  let batchSize = await reserveFlashcards(user, requestedBatchSize);
  if (batchSize <= 0) {
    return NextResponse.json(
      { success: false, error: "Tu as atteint la limite de flashcards de ta formule ce mois-ci. Passe à une formule supérieure pour continuer." },
      { status: 403 }
    );
  }

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

  // Load-balance across all eligible courses: whichever has the fewest
  // queued cards right now gets the next batch, so coverage spreads across
  // every activated module over repeated calls instead of piling onto one.
  const course = eligibleCourses.reduce((fewest, candidate) =>
    (candidate.flashcard_queue?.length ?? 0) < (fewest.flashcard_queue?.length ?? 0) ? candidate : fewest
  );

  try {
    const excerpt = pickRandomExcerpt(course.explication!);
    const prompt = buildFlashcardGenerationPrompt(excerpt, batchSize);

    const raw = await callOpenRouter(
      [
        { role: "system", content: prompt },
        { role: "user", content: "Génère les flashcards demandées." },
      ],
      { model: STUDIO_MODEL, maxTokens: 6000, bypassMock: true }
    );

    const parsed = parseJsonResponse(raw);
    const result = FlashcardGenerationSchema.safeParse(parsed);
    if (!result.success) {
      console.error("[flashcards/generate] Validation zod échouée :", result.error.flatten());
      throw new Error("La réponse de l'IA ne respecte pas le schéma attendu.");
    }

    const newItems = result.data.flashcards.map((fc) => ({
      id: randomUUID(),
      question: sanitizeForPostgres(fc.question),
      answer: sanitizeForPostgres(fc.answer),
    }));

    const updatedQueue = [...(course.flashcard_queue ?? []), ...newItems];
    const { error: updateError } = await supabase
      .from("studio_courses")
      .update({ flashcard_queue: updatedQueue })
      .eq("id", course.id);

    if (updateError) {
      console.error("[flashcards/generate] Échec sauvegarde flashcard_queue:", updateError);
      // Fail-open on persistence: the batch was generated successfully —
      // still hand it to the frontend even if it won't survive a reload.
    }

    // The model can return fewer cards than requested even on a schema-
    // valid response — refund the unused portion of the reservation rather
    // than silently overcharge the student's monthly allowance for cards
    // they never actually received.
    if (newItems.length < batchSize) {
      await refundFlashcards(user.id, batchSize - newItems.length);
    }

    const items: FlashcardPoolItem[] = newItems.map((item) => ({
      ...item,
      courseTitle: course.title,
      moduleId: course.curriculum_module_id,
    }));

    return NextResponse.json({ success: true, items });
  } catch (error) {
    // Full reservation refunded — nothing was generated at all.
    await refundFlashcards(user.id, batchSize);
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[flashcards/generate] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }
}
