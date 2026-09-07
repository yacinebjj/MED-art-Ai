import { NextRequest, NextResponse } from "next/server";
import { verifyChargilySignature, type ChargilyCheckout } from "@/lib/chargily";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { activateSubscription } from "@/lib/subscription";
import { isPlanId } from "@/lib/pricing";

export const runtime = "nodejs";

interface ChargilyWebhookEnvelope {
  id?: string;
  type?: string;
  event?: string;
  data?: ChargilyCheckout;
}

async function updatePaymentStatus(
  checkoutId: string,
  status: "paid" | "failed" | "canceled",
  payload: unknown
) {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("payments")
      .update({ status, raw_payload: payload, updated_at: new Date().toISOString() })
      .eq("chargily_checkout_id", checkoutId);
    if (error) console.error(`Failed to update payment row to ${status}`, error);
  } catch (error) {
    console.error(`Failed to update payment row to ${status} (threw)`, error);
  }
}

export async function POST(request: NextRequest) {
  // Signature verification needs the untouched raw body — never call
  // request.json() before this, it would re-serialize and break the HMAC.
  const rawBody = await request.text();
  const signature = request.headers.get("signature");

  if (!verifyChargilySignature(rawBody, signature)) {
    console.warn("Chargily webhook: invalid signature");
    return NextResponse.json({ error: "Signature invalide." }, { status: 403 });
  }

  let payload: ChargilyWebhookEnvelope;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Payload JSON invalide." }, { status: 400 });
  }

  // `JSON.parse` succeeds (and skips the catch above) on plenty of non-object
  // JSON — "null", "42", "\"a string\"", "[]" — any of which crashes the very
  // next line with an unhandled TypeError on `.type`. Signature verification
  // above already restricts this to Chargily or a holder of the webhook
  // secret, but a payment-critical endpoint shouldn't produce a raw-stack-
  // trace 500 on a malformed-but-technically-valid body. Found during a
  // security audit.
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Payload invalide : un objet JSON était attendu." }, { status: 400 });
  }

  const eventType = payload.type ?? payload.event ?? "";
  const checkout = payload.data ?? (payload as unknown as ChargilyCheckout);

  try {
    switch (eventType) {
      case "checkout.paid": {
        const metadata = checkout.metadata ?? {};
        const userId = metadata.userId;
        const plan = metadata.plan;

        if (userId && isPlanId(plan)) {
          await activateSubscription({
            userId,
            email: metadata.email || undefined,
            plan,
            chargilyCheckoutId: checkout.id,
          });
        } else {
          console.error("checkout.paid webhook missing userId/plan metadata", checkout.id);
        }

        await updatePaymentStatus(checkout.id, "paid", payload);
        break;
      }

      case "checkout.failed":
      case "checkout.canceled": {
        const status = eventType === "checkout.failed" ? "failed" : "canceled";
        await updatePaymentStatus(checkout.id, status, payload);
        break;
      }

      default:
        // Unhandled event type — acknowledge anyway so Chargily doesn't retry.
        break;
    }
  } catch (error) {
    console.error("Chargily webhook processing failed", error);
    return NextResponse.json({ error: "Traitement du webhook échoué." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
