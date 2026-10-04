import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { prepareModuleSynthesisBatch, type ModuleSynthesisType } from "@/lib/module-synthesis";
import { verifySynthesisRunToken } from "@/lib/synthesis-run-token";

export const runtime = "nodejs";
// One micro-batch = one AI call over 3-4 courses (~1-3 min worst case).
export const maxDuration = 300;

const VALID_TYPES: ModuleSynthesisType[] = ["global_summary", "keywords_table", "medical_dictionary"];
const MAX_BATCH_COURSES = 5;

/**
 * Step 2 of a client-driven Module Synthesis run: generates and caches the
 * per-course chunks of a micro-batch (≤ 5 courses). Requires the run token
 * from the plan step (which reserved the quota) — never reserves itself.
 * Idempotent: already-cached courses are skipped, so a retried batch is free.
 * Body: { moduleId, courseIds, type, runToken } → { success, generated, fromCache }.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });

    const { moduleId, courseIds, type, runToken } = ((await request.json().catch(() => null)) ?? {}) as { moduleId?: unknown; courseIds?: unknown; type?: unknown; runToken?: unknown };
    if (typeof moduleId !== "number" || !Array.isArray(courseIds) || courseIds.length === 0 || courseIds.length > MAX_BATCH_COURSES || !courseIds.every((id) => typeof id === "number")) {
      return NextResponse.json({ success: false, error: `'courseIds' doit contenir 1 à ${MAX_BATCH_COURSES} cours.` }, { status: 400 });
    }
    if (typeof type !== "string" || !(VALID_TYPES as string[]).includes(type)) {
      return NextResponse.json({ success: false, error: "'type' invalide." }, { status: 400 });
    }
    if (!verifySynthesisRunToken(runToken, user.id, moduleId, type)) {
      return NextResponse.json({ success: false, error: "Session de génération expirée — relance la synthèse." }, { status: 403 });
    }
    if (!isSupabaseConfigured()) return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });

    const outcome = await prepareModuleSynthesisBatch(user, moduleId, courseIds as number[], type as ModuleSynthesisType);
    if (!outcome.ok) return NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ success: true, generated: outcome.generated, fromCache: outcome.fromCache });
  } catch (error) {
    console.error("[workspace/module-synthesis/batch] Exception:", error);
    return NextResponse.json({ success: false, error: "Une erreur inattendue est survenue. Réessaie." }, { status: 500 });
  }
}
