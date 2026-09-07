import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError, CHEAP_MODEL } from "@/lib/ai/openrouter";
import { buildStudyPlanGenerationPrompt, buildStudyPlanRefinementPrompt, countDaysExclusive, type StudyPlanCourseInput } from "@/lib/ai/study-planner-prompts";
import { PlanDaySchema, StudyPlanGenerationSchema, StudyPlanRefinementSchema } from "@/lib/ai/study-planner-schemas";
import { errorMessage, parseJsonResponse } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import type { GeneratedPlanDay, StudyPlanChatMessage } from "@/types/study-planner";

export const runtime = "nodejs";
export const maxDuration = 300; // same class of work as /api/studio/generate — a full multi-week schedule generation.

const MAX_ATTEMPTS = 2; // 1 retry on a malformed/invalid AI response, same convention as exam/generate.

// A real production failure on a mere 30-day plan surfaced the exact error
// string thrown below ("L'IA n'a pas produit un planning valide. Réessaie.")
// — NOT a token-truncation/timeout, a schema rejection: StudyPlanGenerationSchema's
// nested day/item objects were `.strict()`, so a SINGLE day anywhere in a long
// plan carrying one stray extra field (CHEAP_MODEL/deepseek does this
// occasionally) failed the ENTIRE response, every attempt, deterministically —
// and the failure rate only gets worse as the plan gets longer (more days =
// more chances for one to be malformed). Fixed at the schema level (dropped
// `.strict()` — see lib/ai/study-planner-schemas.ts's comment) and with the
// lenient per-day recovery in generateWithRetry below, which now salvages a
// plan even if a handful of individual days really are unparseable instead of
// discarding the whole thing.
//
// Separately, the requested plan length was capped at a fixed 16,384-token
// output ceiling regardless of how many days were requested — nowhere near
// enough headroom for a 3-month (~90-day) plan, and uncomfortably tight even
// for 30. Now scaled to the actual requested day count instead: a generous
// per-day allowance plus a fixed base for the surrounding JSON/coachMessage,
// capped safely under deepseek-v3.2's own real 65,536-token completion
// ceiling (confirmed live against GET https://openrouter.ai/api/v1/models —
// re-verify if CHEAP_MODEL ever changes). parseJsonResponse's own truncation
// repair (lib/course-generation-shared.ts) remains a second line of defense
// on top of this for whatever edge case still runs over budget.
const GENERATION_MAX_TOKENS_BASE = 4_000;
const GENERATION_MAX_TOKENS_PER_DAY = 950;
const GENERATION_MAX_TOKENS_CEILING = 60_000;

function computeGenerationMaxTokens(totalDayCount: number): number {
  return Math.min(GENERATION_MAX_TOKENS_CEILING, GENERATION_MAX_TOKENS_BASE + totalDayCount * GENERATION_MAX_TOKENS_PER_DAY);
}

interface StudyPlanConfigRow {
  id: number;
  module_ids: number[];
  hours_per_day: number;
  rest_days: number;
  exam_date: string;
  generated_plan: GeneratedPlanDay[] | null;
  refinement_chat: StudyPlanChatMessage[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** POST body — { planId, manualCourseTitles?, programText? } for a first generation, or { planId, message } to refine an existing one. */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`study-planner-generate:${user.id}`, RATE_LIMITS.ai);
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

  const { planId, manualCourseTitles, programText, message } = (body ?? {}) as {
    planId?: unknown;
    manualCourseTitles?: unknown;
    programText?: unknown;
    message?: unknown;
  };

  if (typeof planId !== "number" || !Number.isFinite(planId)) {
    return NextResponse.json({ success: false, error: "'planId' est requis." }, { status: 400 });
  }
  const isRefinement = typeof message === "string" && message.trim().length > 0;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: planRow, error: planError } = await supabase
    .from("study_plans")
    .select("id, module_ids, hours_per_day, rest_days, exam_date, generated_plan, refinement_chat")
    .eq("id", planId)
    .eq("user_id", user.id)
    .maybeSingle<StudyPlanConfigRow>();

  if (planError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${planError.message}` }, { status: 500 });
  }
  if (!planRow) {
    return NextResponse.json({ success: false, error: "Plan introuvable." }, { status: 404 });
  }

  if (isRefinement && !planRow.generated_plan) {
    return NextResponse.json({ success: false, error: "Ce plan n'a pas encore de planning à affiner — génère-le d'abord." }, { status: 400 });
  }

  // Module ids belong to this user's chosen curriculum modules — resolved to
  // their real titles so the AI works from readable names, never bare ids.
  const { data: moduleRows, error: moduleError } = await supabase
    .from("curriculum_modules")
    .select("id, title")
    .in("id", planRow.module_ids);

  if (moduleError) {
    return NextResponse.json({ success: false, error: `Lecture des modules échouée : ${moduleError.message}` }, { status: 500 });
  }

  const courses: StudyPlanCourseInput[] = [
    ...((moduleRows ?? []) as { id: number; title: string }[]).map((m) => ({ moduleId: m.id, title: m.title })),
    ...(Array.isArray(manualCourseTitles)
      ? manualCourseTitles.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((title) => ({ moduleId: null, title: title.trim() }))
      : []),
  ];

  if (courses.length === 0) {
    return NextResponse.json({ success: false, error: "Aucun cours à planifier — sélectionne au moins un module." }, { status: 400 });
  }

  const config = {
    courses,
    hoursPerDay: planRow.hours_per_day,
    restDays: planRow.rest_days,
    examDate: planRow.exam_date,
    today: todayIso(),
    programText: typeof programText === "string" ? programText : undefined,
  };

  const quotaGate = await reserveGeneration(user);
  if (!quotaGate.allowed) {
    return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
  }

  const totalDayCount = countDaysExclusive(config.today, config.examDate);
  const generationMaxTokens = computeGenerationMaxTokens(totalDayCount);

  try {
    if (isRefinement) {
      const history = [...(planRow.refinement_chat ?? []), { role: "user" as const, content: message.trim() }];
      const result = await generateWithRetry(() => {
        const prompt = buildStudyPlanRefinementPrompt(config, planRow.generated_plan, history);
        return callOpenRouter(
          [
            { role: "system", content: prompt },
            { role: "user", content: message.trim() },
          ],
          // CHEAP_MODEL — see its own extensive comment in lib/ai/openrouter.ts.
          // NOT independently tested (only the initial-generation call
          // below was) — same prompt family and schema shape, applied here
          // for consistency, under the same knowingly-accepted tradeoff.
          { model: CHEAP_MODEL, maxTokens: generationMaxTokens, bypassMock: true }
        );
      }, StudyPlanRefinementSchema);

      return NextResponse.json({
        success: true,
        assistantReply: result.assistantReply,
        days: result.days,
        refinementChat: [...history, { role: "assistant" as const, content: result.assistantReply }],
      });
    }

    const result = await generateWithRetry(() => {
      const prompt = buildStudyPlanGenerationPrompt(config);
      return callOpenRouter(
        [
          { role: "system", content: prompt },
          { role: "user", content: "Génère le planning de révision demandé." },
        ],
        // CHEAP_MODEL — see its own extensive comment in lib/ai/openrouter.ts.
        // Personalized, per-student, UNCACHED. Tested with one real call
        // AFTER hardening buildStudyPlanGenerationPrompt's date-range
        // instruction (a real defect found here first: the plan silently
        // stopped short of the exam date) — confirmed fixed, exact date
        // coverage, clean schema — a knowingly-accepted tradeoff on a small
        // sample, per the product owner's own explicit "runway over
        // accuracy margin" decision.
        { model: CHEAP_MODEL, maxTokens: generationMaxTokens, bypassMock: true }
      );
    }, StudyPlanGenerationSchema);

    return NextResponse.json({ success: true, coachMessage: result.coachMessage, days: result.days });
  } catch (error) {
    await refundGeneration(user.id);
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[study-planner/generate] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }
}

/**
 * Same retry loop as before, but each of the three genuinely different
 * failure modes is now logged (and, where safe, surfaced to the client)
 * distinctly instead of collapsing into one generic "réponse invalide" —
 * found necessary after a report of persistent failures that survived a
 * max_tokens bump, which only rules out ONE of these three categories:
 *
 *  1. The OpenRouter call itself fails (bad/missing OPENROUTER_API_KEY,
 *     invalid model id, OpenRouter down, rate-limited) — never reaches JSON
 *     parsing at all. Logged with the real status/detail from
 *     OpenRouterError, and NOT retried for a config-shaped error (401/400 —
 *     retrying with the same bad key/model just wastes another attempt),
 *     retried as before for a transient one (429/5xx).
 *  2. JSON.parse fails on the raw text (truncation, stray prose before/after
 *     the JSON) — parseJsonResponse already logs the raw response's first
 *     1000 chars and attempts a truncation repair internally.
 *  3. JSON.parse SUCCEEDS but zod rejects the shape — this one was
 *     previously logged as just `result.error` (the raw ZodError object, not
 *     always legible from console output) with NO visibility into what the
 *     model actually returned. Now logs the full flattened zod error AND the
 *     parsed object itself, so a real schema drift (the model adding a field
 *     the schema doesn't expect, e.g.) is immediately diagnosable from
 *     server logs instead of indistinguishable from a truncation. Before
 *     giving up on this attempt, also tries recoverPartialPlan() below — a
 *     real production failure confirmed this exact case: one malformed day
 *     out of 30 failed the WHOLE plan, every attempt, deterministically.
 */
async function generateWithRetry<T>(
  call: () => Promise<string>,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { flatten: () => unknown } } }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      raw = await call();
    } catch (error) {
      lastError = error;
      if (error instanceof OpenRouterError) {
        console.error(
          `[study-planner/generate] Échec de l'appel OpenRouter (tentative ${attempt}/${MAX_ATTEMPTS}, status ${error.status}):`,
          error.message
        );
        // 401 (bad/missing API key) and 400 (bad model id/request) fail
        // identically on every retry — no point burning a second attempt.
        if (error.status === 401 || error.status === 400) throw error;
        continue;
      }
      console.error(`[study-planner/generate] Échec inattendu de l'appel IA (tentative ${attempt}/${MAX_ATTEMPTS}):`, error);
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = parseJsonResponse(raw);
    } catch (error) {
      // parseJsonResponse already logged the raw text + its own repair
      // attempt — nothing more to add here.
      lastError = error;
      continue;
    }

    const result = schema.safeParse(parsed);
    if (result.success) return result.data as T;

    const recovered = recoverPartialPlan(parsed, schema);
    if (recovered) return recovered;

    lastError = new Error("L'IA n'a pas produit un planning valide. Réessaie.");
    console.error(
      `[study-planner/generate] JSON valide mais hors-schéma, et non récupérable même partiellement (tentative ${attempt}/${MAX_ATTEMPTS}) — détail zod:`,
      JSON.stringify(result.error?.flatten(), null, 2),
      "\nObjet reçu du modèle (2000 premiers caractères):",
      JSON.stringify(parsed).slice(0, 2000)
    );
  }
  throw lastError instanceof Error ? lastError : new Error("La génération du planning a échoué après plusieurs tentatives.");
}

/**
 * Salvages a plan when the FULL response fails schema validation only
 * because one or more individual days are malformed — the real failure that
 * prompted this: `.strict()`'s all-or-nothing behavior meant a single day
 * anywhere in a 30-day plan carrying one stray field failed the entire
 * response, every attempt, deterministically (the model tends to repeat the
 * same habit on retry). Validates each day in `parsed.days` on its own
 * against PlanDaySchema, drops whichever ones don't parse, then re-validates
 * the reconstructed object against the full schema — so a genuinely broken
 * `coachMessage`/`assistantReply` (i.e. NOT a days-only problem) still fails
 * here and falls through to the caller's normal retry/error path. Returns
 * `null` (never fabricates a day) if nothing at all survives.
 */
function recoverPartialPlan<T>(
  parsed: Record<string, unknown>,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }
): T | null {
  if (!Array.isArray(parsed.days)) return null;

  const validDays: unknown[] = [];
  for (const day of parsed.days) {
    const dayResult = PlanDaySchema.safeParse(day);
    if (dayResult.success) validDays.push(dayResult.data);
  }
  if (validDays.length === 0) return null;

  const retried = schema.safeParse({ ...parsed, days: validDays });
  if (!retried.success) return null;

  const dropped = parsed.days.length - validDays.length;
  if (dropped > 0) {
    console.warn(
      `[study-planner/generate] Récupération partielle : ${dropped} jour(s) hors-schéma ignoré(s) sur ${parsed.days.length} — ${validDays.length} jour(s) conservé(s) et retournés à l'étudiant.`
    );
  }
  return retried.data as T;
}
