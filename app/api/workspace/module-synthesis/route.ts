import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { runModuleSynthesis, type ModuleSynthesisType } from "@/lib/module-synthesis";

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_TYPES: ModuleSynthesisType[] = ["global_summary", "keywords_table"];
function isValidType(value: unknown): value is ModuleSynthesisType {
  return typeof value === "string" && (VALID_TYPES as string[]).includes(value);
}

/**
 * Thin wrapper — the real MODULAR CHUNK PIPELINE (Fetch All -> Isolate
 * Missing -> Generate Missing -> Save Missing -> Stitch All -> Cross-Course
 * Synthesis) now lives in lib/module-synthesis.ts, shared with
 * app/api/modules/[id]/global-summary's own POST handler (the simpler
 * "Résumé global" quick modal) so both entry points benefit from the same
 * per-course, cross-student cache. Body: { moduleId: number, courseIds:
 * number[], type: ModuleSynthesisType }.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`workspace-module-synthesis:${user.id}`, RATE_LIMITS.ai);
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

  const { moduleId, courseIds, type } = (body ?? {}) as { moduleId?: unknown; courseIds?: unknown; type?: unknown };

  if (typeof moduleId !== "number" || !Number.isFinite(moduleId)) {
    return NextResponse.json({ success: false, error: "'moduleId' est requis et doit être un nombre." }, { status: 400 });
  }
  if (!Array.isArray(courseIds) || courseIds.length === 0 || !courseIds.every((id) => typeof id === "number")) {
    return NextResponse.json({ success: false, error: "'courseIds' est requis (tableau d'identifiants non vide)." }, { status: 400 });
  }
  if (!isValidType(type)) {
    return NextResponse.json({ success: false, error: `'type' invalide. Valeurs acceptées : ${VALID_TYPES.join(", ")}.` }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const outcome = await runModuleSynthesis(user, moduleId, courseIds, type);
  if (!outcome.ok) {
    return NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status });
  }

  return NextResponse.json({ success: true, ...outcome.result });
}
