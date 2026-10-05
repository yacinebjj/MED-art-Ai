import { NextRequest, NextResponse } from "next/server";
import { requirePaidPlan } from "@/lib/subscription";
import { quotaBlockedResponse } from "@/lib/quota-response";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { planModuleSynthesis, type ModuleSynthesisType } from "@/lib/module-synthesis";
import { createSynthesisRunToken } from "@/lib/synthesis-run-token";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_TYPES: ModuleSynthesisType[] = ["global_summary", "keywords_table", "medical_dictionary"];

/**
 * Step 1 of a client-driven Module Synthesis run (10-50 courses): returns
 * which selected courses still need generating, reserves ONE generation unit
 * when there is work, and hands back a signed run token for the batch and
 * assemble steps. DB-only and fast — no AI call here.
 * Body: { moduleId, courseIds, type } → { success, missingCourseIds, total, runToken }.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
    const paidGate = await requirePaidPlan(user.id);
    if (!paidGate.allowed) return quotaBlockedResponse(paidGate);

    const rl = rateLimit(`workspace-module-synthesis:${user.id}`, RATE_LIMITS.ai);
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: "Trop de requêtes — réessaie dans quelques minutes." }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } });
    }

    const { moduleId, courseIds, type } = ((await request.json().catch(() => null)) ?? {}) as { moduleId?: unknown; courseIds?: unknown; type?: unknown };
    if (typeof moduleId !== "number" || !Array.isArray(courseIds) || courseIds.length === 0 || !courseIds.every((id) => typeof id === "number")) {
      return NextResponse.json({ success: false, error: "'moduleId' et 'courseIds' sont requis." }, { status: 400 });
    }
    if (typeof type !== "string" || !(VALID_TYPES as string[]).includes(type)) {
      return NextResponse.json({ success: false, error: "'type' invalide." }, { status: 400 });
    }
    if (!isSupabaseConfigured()) return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });

    const synthesisType = type as ModuleSynthesisType;
    const outcome = await planModuleSynthesis(user, moduleId, courseIds as number[], synthesisType);
    if (!outcome.ok) return ("paywall" in outcome && outcome.paywall ? quotaBlockedResponse({ reason: outcome.error, paywall: outcome.paywall }, outcome.status) : NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status }));

    const runToken = outcome.reserved ? createSynthesisRunToken(user.id, moduleId, synthesisType) : null;
    return NextResponse.json({ success: true, missingCourseIds: outcome.missingCourseIds, total: outcome.total, runToken });
  } catch (error) {
    console.error("[workspace/module-synthesis/plan] Exception:", error);
    return NextResponse.json({ success: false, error: "Une erreur inattendue est survenue. Réessaie." }, { status: 500 });
  }
}
