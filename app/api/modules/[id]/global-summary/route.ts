import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import { STUDIO_MODEL } from "@/lib/ai/studio-prompts";
import { buildGlobalSummaryPrompt } from "@/lib/ai/global-summary-prompts";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const maxDuration = 300;

// Per-course cap so N selected courses can't blow past the model's context
// window between them — generous enough that a single course's full text
// almost never actually hits it (studio_courses.raw_text itself has no hard
// cap, but real uploads are rarely this long).
const MAX_SOURCE_CHARS_PER_COURSE = 15_000;

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
 * POST -> the real, billed generation — body { courseIds: number[] }.
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

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  // Scoped to THIS user AND THIS module — a courseId the student doesn't own,
  // or one that belongs to a different module, is silently excluded rather
  // than trusted from the request body.
  const { data: courses, error: coursesError } = await supabase
    .from("studio_courses")
    .select("id, title, raw_text")
    .eq("user_id", user.id)
    .eq("curriculum_module_id", moduleId)
    .in("id", courseIds);

  if (coursesError) {
    console.error("[modules/global-summary:post] Échec lecture Supabase:", coursesError);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${coursesError.message}` }, { status: 500 });
  }

  const eligibleCourses = (courses ?? []) as { id: number; title: string; raw_text: string }[];
  if (eligibleCourses.length === 0) {
    return NextResponse.json({ success: false, error: "Aucun cours sélectionné trouvé dans ce module." }, { status: 400 });
  }

  try {
    const prompt = buildGlobalSummaryPrompt(
      eligibleCourses.map((course) => ({ title: course.title, rawText: course.raw_text.slice(0, MAX_SOURCE_CHARS_PER_COURSE) }))
    );

    const raw = await callOpenRouter(
      [
        { role: "system", content: prompt },
        { role: "user", content: "Génère le résumé global demandé." },
      ],
      { model: STUDIO_MODEL, maxTokens: 8000, bypassMock: true }
    );

    const parsed = parseJsonResponse(raw);
    const summaryText = typeof parsed.summary === "string" ? parsed.summary : "";
    if (!summaryText.trim() || summaryText.trim().length < 50) {
      throw new Error("La réponse de l'IA ne contient pas de résumé exploitable.");
    }

    const generatedAt = new Date().toISOString();
    const result: StoredGlobalSummary = {
      text: sanitizeForPostgres(summaryText),
      generatedAt,
      courseIds: eligibleCourses.map((course) => course.id),
    };

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
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[modules/global-summary:post] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }
}
