import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import { STUDIO_MODEL } from "@/lib/ai/studio-prompts";
import { buildStudyPlanGenerationPrompt, buildStudyPlanRefinementPrompt, type StudyPlanCourseInput } from "@/lib/ai/study-planner-prompts";
import { StudyPlanGenerationSchema, StudyPlanRefinementSchema } from "@/lib/ai/study-planner-schemas";
import { errorMessage, parseJsonResponse } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import type { GeneratedPlanDay, StudyPlanChatMessage } from "@/types/study-planner";

export const runtime = "nodejs";
export const maxDuration = 300; // same class of work as /api/studio/generate — a full multi-week schedule generation.

const MAX_ATTEMPTS = 2; // 1 retry on a malformed/invalid AI response, same convention as exam/generate.
const GENERATION_MAX_TOKENS = 8_192;

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
          { model: STUDIO_MODEL, maxTokens: GENERATION_MAX_TOKENS, bypassMock: true }
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
        { model: STUDIO_MODEL, maxTokens: GENERATION_MAX_TOKENS, bypassMock: true }
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

async function generateWithRetry<T>(call: () => Promise<string>, schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await call();
      const parsed = parseJsonResponse(raw);
      const result = schema.safeParse(parsed);
      if (!result.success) {
        console.error(`[study-planner/generate] Réponse invalide (tentative ${attempt}/${MAX_ATTEMPTS}):`, result.error);
        throw new Error("L'IA n'a pas produit un planning valide. Réessaie.");
      }
      return result.data as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("La génération du planning a échoué après plusieurs tentatives.");
}
