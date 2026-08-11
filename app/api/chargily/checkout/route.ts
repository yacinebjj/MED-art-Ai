import { NextRequest, NextResponse } from "next/server";
import { createChargilyCheckout } from "@/lib/chargily";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { isPaidPlanId, isPlanId, PLANS } from "@/lib/pricing";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e) pour continuer." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const plan = typeof body?.plan === "string" ? body.plan : "";

  if (!isPlanId(plan)) {
    return NextResponse.json({ error: "Formule invalide." }, { status: 400 });
  }

  if (!isPaidPlanId(plan)) {
    return NextResponse.json({ error: "Freemium est le niveau par défaut — aucun paiement n'est nécessaire." }, { status: 400 });
  }

  const planDetails = PLANS[plan];
  const appUrl = process.env.APP_URL || request.nextUrl.origin;

  try {
    const checkout = await createChargilyCheckout({
      amount: planDetails.priceDZD,
      currency: "dzd",
      successUrl: `${appUrl}/dashboard/billing?status=success`,
      failureUrl: `${appUrl}/dashboard/billing?status=failure`,
      webhookEndpoint: `${appUrl}/api/chargily/webhook`,
      description: `Med Art AI — ${planDetails.label}`,
      locale: "fr",
      metadata: { userId: user.id, plan, email: user.email ?? "" },
    });

    // Best-effort audit row — a Supabase hiccup here must never block a
    // customer from reaching a checkout page that Chargily already created.
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabaseAdmin();
        const { error } = await supabase.from("payments").insert({
          user_id: user.id,
          plan,
          amount: planDetails.priceDZD,
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
