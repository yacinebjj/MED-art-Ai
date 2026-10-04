import { buildLanguageDirective, parseContentLanguage } from "@/lib/ai/language-directive";
import { NextRequest, NextResponse } from "next/server";
import { callOpenRouter, OpenRouterError, ECONOMY_MODEL } from "@/lib/ai/openrouter";
import { STUDIO_BYPASS_MOCK, STUDIO_PROMPT_CONFIG, STUDIO_SECTION_KEYS, buildStudioSystemMessage } from "@/lib/ai/studio-prompts";
import { parseAndValidateStudioSection } from "@/lib/ai/studio-section-validation";
import { errorMessage, MAX_SOURCE_CHARS } from "@/lib/course-generation-shared";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { reservePlatformCapacity } from "@/lib/platform-spend-guard";

export const runtime = "nodejs";
// Same budget as /api/studio/generate — a regeneration is a full QCM generation.
export const maxDuration = 300;

/**
 * Per-course, per-student ceiling on "Régénérer" for the Examen QCM tile —
 * product direction: up to 5 times. Enforced atomically in Postgres by
 * reserve_qcm_regenerate (supabase/schema.sql), which increments
 * studio_courses.qcm_regenerate_count only while it's below this cap.
 */
const QCM_REGENERATE_CAP = 5;

/** Same retry policy as /api/studio/generate's generic path: the corrective re-prompt usually fixes a dropped schema field on the next attempt. */
const MAX_ATTEMPTS = 3;

/** How many existing question stems are quoted back to the model to avoid — all 15 fit comfortably; capped anyway so an unusually long set can't bloat the prompt. */
const MAX_AVOID_QUESTIONS = 20;
const MAX_AVOID_QUESTION_CHARS = 240;

interface QcmCourseRow {
  raw_text: string | null;
  qcms: { qcms?: { question?: unknown }[] } | null;
}

function existingQuestionStems(qcms: QcmCourseRow["qcms"]): string[] {
  const items = Array.isArray(qcms?.qcms) ? qcms.qcms : [];
  return items
    .map((item) => (typeof item?.question === "string" ? item.question.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_AVOID_QUESTIONS)
    .map((q) => (q.length > MAX_AVOID_QUESTION_CHARS ? `${q.slice(0, MAX_AVOID_QUESTION_CHARS)}…` : q));
}

/**
 * "Régénérer" for the Studio's Examen QCM tile — QCM ONLY (every other
 * section is rejected; regeneration was removed for the rest by product
 * decision, see commit 47df5a5).
 *
 * Generates a genuinely NEW set of questions from the course's own source
 * text — the same prompt, model, schema validation and corrective-retry loop
 * as the first QCM generation (/api/studio/generate) — with the current
 * questions quoted back as "do not repeat". (The earlier regenerate route
 * rewrote only the previous QCM JSON without the source, which could only
 * ever reshuffle the same material.)
 *
 * Quota: the per-course cap above is reserved first, then the student's
 * normal generation quota; both are refunded if anything downstream fails,
 * so a failed attempt never costs a regeneration.
 *
 * Response: `{ success, section: "qcm", data, remaining }` — `data` is the
 * validated QCM object already saved on the course; `remaining` is how many
 * regenerations this course has left.
 */
async function handlePost(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-regenerate:${user.id}`, RATE_LIMITS.ai);
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

  const { courseId, section, language: languageRaw } = (body ?? {}) as { courseId?: unknown; section?: unknown; language?: unknown };
  // Global AI-content language (store/useLanguageStore.ts) — the new QCM set follows it.
  const language = parseContentLanguage(languageRaw);
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis et doit être un nombre." }, { status: 400 });
  }
  // Real enforcement of "QCM only" — the UI only shows the menu item on the
  // QCM tile, but a client is never trusted to police its own request.
  if (section !== "qcm") {
    return NextResponse.json({ success: false, error: "La régénération n'est disponible que pour l'Examen QCM." }, { status: 403 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const userId = user.id;
  const column = STUDIO_SECTION_KEYS.qcm; // "qcms" — also the key inside the model's JSON

  const { data: course, error: readError } = await supabase
    .from("studio_courses")
    .select("raw_text, qcms")
    .eq("id", courseId)
    .eq("user_id", userId)
    .maybeSingle<QcmCourseRow>();

  if (readError) {
    console.error("[studio/regenerate:qcm] Échec lecture Supabase:", readError.message);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${readError.message}` }, { status: 500 });
  }
  if (!course) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }
  if (!course.qcms) {
    return NextResponse.json({ success: false, error: "Rien à régénérer — génère d'abord l'Examen QCM une première fois." }, { status: 400 });
  }
  const sourceText = course.raw_text?.trim() ?? "";
  if (sourceText.length < 50) {
    return NextResponse.json({ success: false, error: "Ce cours n'a pas assez de contenu source pour régénérer des QCM." }, { status: 400 });
  }

  // 1. Per-course cap (atomic check-and-increment). Returns the new count, or
  //    null once the cap is already reached.
  const { data: newCount, error: capError } = await supabase.rpc("reserve_qcm_regenerate", {
    p_course_id: courseId,
    p_user_id: userId,
    p_cap: QCM_REGENERATE_CAP,
  });
  if (capError) {
    console.error("[studio/regenerate:qcm] Échec reserve_qcm_regenerate:", capError.message);
    return NextResponse.json({ success: false, error: `Vérification du plafond échouée : ${capError.message}` }, { status: 500 });
  }
  if (newCount === null || newCount === undefined) {
    return NextResponse.json(
      { success: false, error: `Tu as atteint la limite de ${QCM_REGENERATE_CAP} régénérations pour l'Examen QCM de ce cours.`, remaining: 0 },
      { status: 403 }
    );
  }
  const remaining = Math.max(0, QCM_REGENERATE_CAP - Number(newCount));

  async function refundCap() {
    const { error } = await supabase.rpc("refund_qcm_regenerate", { p_course_id: courseId, p_user_id: userId });
    if (error) console.warn("[studio/regenerate:qcm] Échec refund_qcm_regenerate:", error.message);
  }

  // 2. The student's normal generation quota + the platform spend guard —
  //    identical gates to a first generation.
  const quotaGate = await reserveGeneration(user);
  if (!quotaGate.allowed) {
    await refundCap();
    return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
  }
  const platformCapacity = await reservePlatformCapacity();
  if (!platformCapacity.allowed) {
    await refundGeneration(userId);
    await refundCap();
    return NextResponse.json({ success: false, error: platformCapacity.reason }, { status: 503 });
  }

  async function refundAll() {
    await refundGeneration(userId);
    await refundCap();
  }

  // 3. Generate: the normal QCM prompt + the course text, plus the questions
  //    the student already has, so the new set is actually new.
  const avoid = existingQuestionStems(course.qcms);
  const regenerateInstruction = [
    "",
    "---",
    "RÉGÉNÉRATION : l'étudiant a déjà travaillé la série de QCM ci-dessous sur ce même cours et en demande une NOUVELLE.",
    "Génère des questions ENTIÈREMENT NOUVELLES, toujours tirées du cours fourni : autres notions, autres angles cliniques, autres pièges et distracteurs.",
    "Ne reprends aucune de ces questions, ni reformulée, ni légèrement modifiée :",
    ...avoid.map((q, i) => `${i + 1}. ${q}`),
  ].join("\n");
  const systemContent = buildStudioSystemMessage(
    "qcm",
    sourceText.slice(0, MAX_SOURCE_CHARS),
    `${STUDIO_PROMPT_CONFIG.qcm.systemPrompt}\n${regenerateInstruction}${buildLanguageDirective(language)}`
  );

  let finalData: unknown = null;
  let correctiveNote: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const userPrompt = correctiveNote
      ? `Ta réponse précédente a été REJETÉE par la validation : ${correctiveNote} Régénère un JSON COMPLET et VALIDE respectant strictement TOUTES les clés du schéma ci-dessus, sans en omettre aucune.`
      : "Génère la nouvelle série de QCM demandée.";

    let raw: string;
    try {
      raw = await callOpenRouter(
        [
          { role: "system", content: systemContent },
          { role: "user", content: userPrompt },
        ],
        // Same model + reasoning cap as the first QCM generation — see
        // /api/studio/generate's MODEL POLICY and reasoningOption comments
        // (Gemini Flash always reasons; `effort: "low"` keeps that thinking
        // from eating the JSON's token budget).
        { model: ECONOMY_MODEL, maxTokens: STUDIO_PROMPT_CONFIG.qcm.maxTokens, bypassMock: STUDIO_BYPASS_MOCK, reasoning: { effort: "low" }, providerSort: "throughput" }
      );
    } catch (error) {
      await refundAll();
      if (error instanceof OpenRouterError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      }
      console.error(`[studio/regenerate:qcm] Échec appel IA (tentative ${attempt}):`, error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }

    const outcome = parseAndValidateStudioSection(raw, "qcm", column, null);
    if (outcome.success) {
      finalData = outcome.data;
      break;
    }
    console.error(`[studio/regenerate:qcm] Validation échouée (tentative ${attempt}/${MAX_ATTEMPTS}):`, outcome.correctiveNote);
    correctiveNote = outcome.correctiveNote;
  }

  if (finalData === null) {
    await refundAll();
    return NextResponse.json(
      { success: false, error: `La nouvelle série de QCM ne respecte pas le format attendu, même après ${MAX_ATTEMPTS - 1} nouvelles tentatives. Réessaie.` },
      { status: 502 }
    );
  }

  // 4. Persist before answering, so a refresh right after always shows the
  //    new set (same atomic generate-then-save contract as /api/studio/generate).
  const { error: saveError, count } = await supabase
    .from("studio_courses")
    .update({ [column]: finalData, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", courseId)
    .eq("user_id", userId);

  if (saveError) {
    await refundAll();
    console.error("[studio/regenerate:qcm] Échec sauvegarde Supabase:", saveError.message);
    return NextResponse.json({ success: false, error: `Sauvegarde échouée : ${saveError.message}` }, { status: 500 });
  }
  if (count === 0) {
    await refundAll();
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true, section: "qcm", data: finalData, remaining });
}

/**
 * Defensive top-level backstop — same rationale as
 * app/api/studio/generate/route.ts's own copy of this comment.
 */
// Product decision: a Studio/Lab result is generated once and then only read
// (it is also shared platform-wide through the content caches) — with ONE
// exception: the Examen QCM, which can be regenerated up to
// QCM_REGENERATE_CAP times per course (atomic server-side counter,
// studio_courses.qcm_regenerate_count). The route already rejects every
// other section. Set to false to refuse even that.
const REGENERATION_ENABLED = true as boolean;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!REGENERATION_ENABLED) {
    return NextResponse.json(
      { success: false, error: "La régénération est désactivée : le contenu déjà généré est conservé et partagé." },
      { status: 410 }
    );
  }
  try {
    return await handlePost(request);
  } catch (error) {
    console.error("[studio/regenerate] Exception non interceptée:", error);
    return NextResponse.json({ success: false, error: "Une erreur inattendue est survenue. Réessaie." }, { status: 500 });
  }
}
