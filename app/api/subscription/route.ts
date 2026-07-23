import { NextResponse } from "next/server";
import { getSubscription, isSubscriptionActive } from "@/lib/subscription";
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

  const active = isSubscriptionActive(sub);
  const subscriptionPayload = sub
    ? {
        plan: sub.plan,
        planLabel: PLANS[sub.plan].label,
        status: sub.status,
        active,
        periodEnd: sub.period_end,
        generationsUsed: sub.generations_used,
        generationCap: PLANS[sub.plan].generationCap,
      }
    : null;

  const trialPayload = {
    active: isTrialActive(profile, user.created_at),
    daysRemaining: getTrialDaysRemaining(profile, user.created_at),
    endsAt: profile?.trial_ends_at ?? null,
  };

  return NextResponse.json({ subscription: subscriptionPayload, trial: trialPayload });
}
