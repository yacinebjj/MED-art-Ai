import { NextResponse } from "next/server";
import { getSubscription, isSubscriptionActive, resolveEffectivePlan } from "@/lib/subscription";
import { getProfile, isTrialActive, getTrialDaysRemaining } from "@/lib/trial";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { PLANS } from "@/lib/pricing";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

/** Mirrors MODULE_EXAM_REGENERATE_CAP in app/api/exam/generate/route.ts. */
const EXAM_REGENERATE_CAP = 5;

/** Exam regenerations used — tolerant: 0 when the column isn't migrated yet. */
async function readExamRegenerationsUsed(userId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const { data, error } = await getSupabaseAdmin()
    .from("profiles")
    .select("module_exam_regenerations_used")
    .eq("id", userId)
    .maybeSingle<{ module_exam_regenerations_used: number | null }>();
  if (error || !data) return 0;
  return Math.max(0, Number(data.module_exam_regenerations_used ?? 0));
}

export const runtime = "nodejs";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ subscription: null, trial: null }, { status: 401 });
  }

  const [sub, profile, examRegenerationsUsed] = await Promise.all([getSubscription(user.id), getProfile(user.id), readExamRegenerationsUsed(user.id)]);

  const trialing = isTrialActive(profile, user.created_at);
  // The plan actually governing quotas right now — falls back to Freemium
  // the moment a paid plan's period_end passes, even though `sub.plan`
  // itself still shows the last purchased plan until a renewal overwrites
  // it. See lib/subscription.ts's resolveEffectivePlan for why this is a
  // pure read-time fallback rather than a written "expired" state.
  const effectivePlanId = resolveEffectivePlan(sub);
  const effectivePlan = PLANS[effectivePlanId];

  const subscriptionPayload = sub
    ? {
        plan: sub.plan,
        planLabel: PLANS[sub.plan].label,
        status: sub.status,
        active: isSubscriptionActive(sub),
        periodEnd: sub.period_end,
        effectivePlan: effectivePlanId,
        effectivePlanLabel: effectivePlan.label,
        unlimitedThisPeriod: trialing,
        coursesUsed: sub.generations_used,
        courseCap: effectivePlan.courseCap,
        highlightMessagesUsed: sub.highlight_messages_used,
        highlightMessageCap: effectivePlan.highlightMessageCap,
        chatMessagesUsed: sub.chat_messages_used,
        chatMessageCap: effectivePlan.chatMessageCap,
        remediationUsed: sub.remediation_used,
        remediationCap: effectivePlan.remediationCap,
        examRegenerationsUsed,
        examRegenerationCap: EXAM_REGENERATE_CAP,
        periodStart: sub.period_start,
      }
    : null;

  const trialPayload = {
    active: trialing,
    daysRemaining: getTrialDaysRemaining(profile, user.created_at),
    endsAt: profile?.trial_ends_at ?? null,
  };

  return NextResponse.json({ subscription: subscriptionPayload, trial: trialPayload });
}
