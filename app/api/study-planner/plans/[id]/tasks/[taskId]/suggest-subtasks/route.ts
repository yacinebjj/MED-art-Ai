import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError, HAIKU_MODEL } from "@/lib/ai/openrouter";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveHighlightMessage, refundHighlightMessage } from "@/lib/subscription";
import { errorMessage, parseJsonResponse } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const maxDuration = 30;

const SuggestionsSchema = z
  .object({
    suggestions: z.array(z.string().min(1).max(200)).min(1).max(6),
  })
  .strict();

function buildPrompt(title: string): string {
  return [
    "Tu es un coach de révision médicale pour des étudiants en Algérie.",
    "Pour la tâche de planning suivante, propose 2 à 4 sous-étapes ou rappels courts (une phrase chacun, en français) pour l'aborder efficacement.",
    "Réponds UNIQUEMENT avec un JSON valide de la forme exacte {\"suggestions\": [\"...\", \"...\"]} — pas de texte autour, pas de markdown.",
    `Tâche : "${title}"`,
  ].join("\n");
}

/**
 * POST — on-demand, per-task AI sub-step suggestions for the To-Do "God-
 * Tier" redesign's sparkle button. Purely additive: nothing here is
 * persisted (no new column on study_plan_tasks), the response is held only
 * in the client's own local state and vanishes on dismiss/unmount. Reuses
 * highlightMessageCap (Ask MedArt on a selection) rather than inventing a
 * new quota bucket/RPC pair for this — both are the same shape of
 * lightweight, per-click, single-item AI assist.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string; taskId: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`study-planner-suggest-subtasks:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const planId = Number(params.id);
  const taskId = Number(params.taskId);
  if (!Number.isFinite(planId) || !Number.isFinite(taskId)) {
    return NextResponse.json({ success: false, error: "Identifiant invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { title } = (body ?? {}) as { title?: unknown };
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ success: false, error: "'title' est requis." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  // Ownership check — confirms this taskId genuinely belongs to this user's
  // plan before spending a real OpenRouter call on it (mirrors the sibling
  // PATCH/DELETE route's exact ownership filters).
  const { data: taskRow, error: taskError } = await supabase
    .from("study_plan_tasks")
    .select("id")
    .eq("id", taskId)
    .eq("plan_id", planId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (taskError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${taskError.message}` }, { status: 500 });
  }
  if (!taskRow) {
    return NextResponse.json({ success: false, error: "Tâche introuvable." }, { status: 404 });
  }

  let reserved = false;
  try {
    const quotaGate = await reserveHighlightMessage(user);
    if (!quotaGate.allowed) {
      return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
    }
    reserved = true;

    const raw = await callOpenRouter(
      [{ role: "system", content: buildPrompt(title.trim()) }],
      // HAIKU_MODEL — small, fast, cheap: a 2-4 item suggestion list for one
      // task title doesn't need a heavier tier.
      { model: HAIKU_MODEL, maxTokens: 500, bypassMock: true, timeoutMs: 25_000 }
    );

    const parsed = parseJsonResponse(raw);
    const result = SuggestionsSchema.safeParse(parsed);
    if (!result.success) {
      console.error(
        "[study-planner/suggest-subtasks] JSON valide mais hors-schéma — détail zod:",
        JSON.stringify(result.error.flatten(), null, 2)
      );
      throw new Error("La réponse de l'IA ne respecte pas le schéma attendu.");
    }

    return NextResponse.json({ success: true, suggestions: result.data.suggestions.slice(0, 4) });
  } catch (error) {
    if (reserved) await refundHighlightMessage(user.id);
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[study-planner/suggest-subtasks] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }
}
