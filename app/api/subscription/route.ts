import { NextResponse } from "next/server";
import { getSubscription, isSubscriptionActive, resolveEffectivePlan } from "@/lib/subscription";
import { getProfile, isTrialActive, getTrialDaysRemaining } from "@/lib/trial";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { PLANS } from "@/lib/pricing";

export const runtime = "nodejs";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ subscription: null, trial: null }, { status: 401 });
  }

  const [sub, profile] = await Promise.all([getSubscription(user.id), getProfile(user.id)]);

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
      }
    : null;

  const trialPayload = {
    active: trialing,
    daysRemaining: getTrialDaysRemaining(profile, user.created_at),
    endsAt: profile?.trial_ends_at ?? null,
  };

  return NextResponse.json({ subscription: subscriptionPayload, trial: trialPayload });
}
