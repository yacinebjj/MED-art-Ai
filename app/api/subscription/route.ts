import { NextResponse } from "next/server";
import { getSubscription, getUsageSnapshot, isSubscriptionActive, resolveEffectivePlan } from "@/lib/subscription";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { FREE_TRIAL, PLANS } from "@/lib/pricing";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { isBillingAdmin } from "@/lib/billing-pools";

/** Mirrors MODULE_EXAM_REGENERATE_CAP in lib/exam-generation.ts. */
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
export const dynamic = "force-dynamic";

/**
 * Current plan + every usage counter (monetization v2, lib/subscription.ts
 * getUsageSnapshot). `usage` is what the billing page, the paywall and the
 * pre-generation warnings read. The legacy fields are kept for older UI.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ subscription: null, trial: null, usage: null }, { status: 401 });
  }

  const [sub, usage, examRegenerationsUsed] = await Promise.all([getSubscription(user.id), getUsageSnapshot(user.id), readExamRegenerationsUsed(user.id)]);
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
        unlimitedThisPeriod: false,
        coursesUsed: usage?.courses.used ?? 0,
        courseCap: usage?.courses.cap ?? effectivePlan.coursesPerMonth,
        highlightMessagesUsed: sub.highlight_messages_used,
        highlightMessageCap: effectivePlan.highlightMessageCap,
        chatMessagesUsed: usage?.messages.used ?? 0,
        chatMessageCap: usage?.messages.cap ?? effectivePlan.premiumMessagesPerDay,
        remediationUsed: sub.remediation_used,
        remediationCap: effectivePlan.remediationCap,
        examRegenerationsUsed,
        examRegenerationCap: EXAM_REGENERATE_CAP,
        periodStart: sub.period_start,
      }
    : null;

  return NextResponse.json({
    subscription: subscriptionPayload,
    // The 7-day unlimited trial no longer exists: the free trial is one-time (1 course + 20 messages).
    trial: { active: false, daysRemaining: 0, endsAt: null },
    freeTrial: { courses: FREE_TRIAL.courses, messages: FREE_TRIAL.messages },
    usage,
    isAdmin: isBillingAdmin(user.email),
  });
}
