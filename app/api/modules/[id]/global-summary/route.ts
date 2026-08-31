import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { runModuleSynthesis, MIN_COURSES_REQUIRED } from "@/lib/module-synthesis";

export const runtime = "nodejs";
export const maxDuration = 300;

interface StoredGlobalSummary {
  text: string;
  generatedAt: string;
  courseIds: number[];
}

interface ProfileGlobalSummaryRow {
  module_global_summaries: Record<string, StoredGlobalSummary> | null;
}

function parseModuleId(rawId: string): number | null {
  const id = Number(rawId);
  return Number.isFinite(id) ? id : null;
}

/**
 * "Résumé global du module" — synthesizes physiopathology/clinical
 * connections ACROSS every course the student picks in one module, not a
 * per-course summary. Persisted on `profiles.module_global_summaries`, a
 * jsonb map keyed by module id (as a string, since JSON object keys always
 * are) — same "extend `profiles` with a new column" pattern this app has
 * used all along for per-user, per-module state (flashcard/weakness toggles,
 * remediation plan), rather than a new table PostgREST won't reliably see.
 *
 * GET  -> cached read, never calls the AI (mirrors
 *         app/api/study/remediation-plan/route.ts's own contract).
 * POST -> the real generation — body { courseIds: number[] } — now delegates
 *         to lib/module-synthesis.ts's shared pipeline (the SAME per-course,
 *         cross-student cache app/api/workspace/module-synthesis uses)
 *         instead of its own bespoke, always-fresh, full-raw-text call. Two
 *         students selecting the same courses now share the cost through
 *         EITHER entry point. The request/response CONTRACT with the
 *         frontend (GlobalSummaryModal.tsx) is unchanged — only what
 *         happens behind POST changed.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const moduleId = parseModuleId(params.id);
  if (moduleId === null) {
    return NextResponse.json({ success: false, error: "Identifiant de module invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profiles")
    .select("module_global_summaries")
    .eq("id", user.id)
    .maybeSingle<ProfileGlobalSummaryRow>();

  if (error) {
    console.error("[modules/global-summary:get] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  const summary = data?.module_global_summaries?.[String(moduleId)] ?? null;
  return NextResponse.json({ success: true, summary });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`modules-global-summary:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const moduleId = parseModuleId(params.id);
  if (moduleId === null) {
    return NextResponse.json({ success: false, error: "Identifiant de module invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { courseIds } = (body ?? {}) as { courseIds?: unknown };
  if (!Array.isArray(courseIds) || courseIds.length === 0 || !courseIds.every((id) => typeof id === "number")) {
    return NextResponse.json({ success: false, error: "'courseIds' est requis (tableau d'identifiants non vide)." }, { status: 400 });
  }
  if (courseIds.length < MIN_COURSES_REQUIRED) {
    return NextResponse.json(
      { success: false, error: `Sélectionne au moins ${MIN_COURSES_REQUIRED} cours pour générer le résumé global (actuellement ${courseIds.length}).` },
      { status: 400 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const outcome = await runModuleSynthesis(user, moduleId, courseIds, "global_summary");
  if (!outcome.ok) {
    return NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status });
  }

  const generatedAt = new Date().toISOString();
  const result: StoredGlobalSummary = {
    text: outcome.result.content,
    generatedAt,
    courseIds,
  };

  const supabase = getSupabaseAdmin();
  // Read-modify-write: this is a jsonb MAP keyed by module id, so a plain
  // column-level `update` would clobber every OTHER module's already-saved
  // summary if we didn't merge it in first.
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("module_global_summaries")
    .eq("id", user.id)
    .maybeSingle<ProfileGlobalSummaryRow>();
  const existingMap = profileRow?.module_global_summaries ?? {};
  const updatedMap = { ...existingMap, [String(moduleId)]: result };

  const { error: saveError } = await supabase.from("profiles").update({ module_global_summaries: updatedMap }).eq("id", user.id);
  if (saveError) {
    console.error("[modules/global-summary:post] Échec sauvegarde (fail-open):", saveError);
    // Fail-open on persistence: the summary was generated successfully —
    // still return it even if it won't survive a reload.
  }

  return NextResponse.json({ success: true, summary: result });
}
