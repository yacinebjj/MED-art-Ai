import { NextRequest, NextResponse } from "next/server";
import { createChargilyCheckout } from "@/lib/chargily";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { GROUP_SIZE, groupLeaderTotalDZD, isPaidPlanId, isPlanId, PLANS } from "@/lib/pricing";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { billingPoolsAvailable } from "@/lib/billing-pools";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e) pour continuer." }, { status: 401 });
  }

  // SECURITY: this hits Chargily's live checkout API and writes a `payments`
  // row on every call — previously the only authenticated route in this
  // codebase with a real external side effect and NO rate limit at all,
  // letting a looped call flood Chargily (risking this app's own API key
  // being rate-limited/blocked there) and litter `payments` with unbounded
  // pending rows.
  const rl = rateLimit(`chargily-checkout:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const body = await request.json().catch(() => null);
  const plan = typeof body?.plan === "string" ? body.plan : "";
  // Groupe bought by a leader for the 5 seats at once (monetization v2).
  const asGroupLeader = body?.mode === "leader";

  if (!isPlanId(plan)) {
    return NextResponse.json({ error: "Formule invalide." }, { status: 400 });
  }

  if (!isPaidPlanId(plan)) {
    return NextResponse.json({ error: "Freemium est le niveau par défaut — aucun paiement n'est nécessaire." }, { status: 400 });
  }

  const planDetails = PLANS[plan];
  // Direct checkout sells: Individuel (any cycle), or Groupe as a leader
  // paying the 5 seats. A pooled Promo / Groupe share goes through
  // /api/billing/pools/[code] (seat hold + gauge). Legacy plans are not sold.
  if (!planDetails.purchasable || planDetails.tier === "promo" || (planDetails.tier === "group" && !asGroupLeader)) {
    return NextResponse.json({ error: "Cette formule se paie depuis la page de ton groupe (lien d'invitation)." }, { status: 400 });
  }
  if (asGroupLeader && !(await billingPoolsAvailable())) {
    return NextResponse.json({ error: "La formule Groupe arrive dans quelques instants — réessaie un peu plus tard." }, { status: 503 });
  }
  const amount = asGroupLeader ? groupLeaderTotalDZD(planDetails) : planDetails.priceDZD;
  const kind = asGroupLeader ? "group_leader" : "individual";
  const appUrl = process.env.APP_URL || request.nextUrl.origin;

  try {
    const checkout = await createChargilyCheckout({
      amount,
      currency: "dzd",
      successUrl: `${appUrl}/dashboard/billing?status=success`,
      failureUrl: `${appUrl}/dashboard/billing?status=failure`,
      webhookEndpoint: `${appUrl}/api/chargily/webhook`,
      description: asGroupLeader ? `Med Art AI — ${planDetails.label} (${GROUP_SIZE} places)` : `Med Art AI — ${planDetails.label}`,
      locale: "fr",
      metadata: { userId: user.id, plan, email: user.email ?? "", kind },
    });

    // Best-effort audit row — a Supabase hiccup here must never block a
    // customer from reaching a checkout page that Chargily already created.
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabaseAdmin();
        const { error } = await supabase.from("payments").insert({
          user_id: user.id,
          plan,
          amount,
          currency: "dzd",
          chargily_checkout_id: checkout.id,
          status: "pending",
        });
        if (error) console.error("Failed to record pending payment", error);
      } catch (error) {
        console.error("Failed to record pending payment (threw)", error);
      }
    } else {
      console.warn("Supabase not configured — skipping pending payment record.");
    }

    return NextResponse.json({ checkoutUrl: checkout.checkout_url });
  } catch (error) {
    console.error("Chargily checkout creation failed", error);
    return NextResponse.json(
      { error: "Impossible de créer le paiement. Réessaie dans un instant." },
      { status: 502 }
    );
  }
}
