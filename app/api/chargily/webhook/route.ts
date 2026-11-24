import { NextRequest, NextResponse } from "next/server";
import { verifyChargilySignature, type ChargilyCheckout } from "@/lib/chargily";
import { claimCheckoutAsPaid, fulfillPaidCheckout, markFulfilled, releasePaidClaim, updatePaymentStatus } from "@/lib/chargily-settlement";
import { sendPaymentThankYouEmail } from "@/lib/email/notifications";

export const runtime = "nodejs";
// Completing a pooled group activates every member in one delivery: room for that, so a large group is
// never cut off by the platform's default timeout halfway (a stale claim is taken over anyway).
export const maxDuration = 60;

interface ChargilyWebhookEnvelope {
  id?: string;
  type?: string;
  event?: string;
  data?: ChargilyCheckout;
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
  // Set only once THIS delivery has claimed and fulfilled the payment.
  let settledCheckout: ChargilyCheckout | null = null;
  // Only a claim taken by THIS delivery may be released on failure — never one held by another delivery in flight.
  let claimedByThisDelivery = false;

  try {
    switch (eventType) {
      case "checkout.paid": {
        // Idempotency FIRST: this both records the payment as paid AND
        // tells us whether WE are the delivery that gets to act on it. A
        // redelivery of an already-settled checkout must never be fulfilled
        // again (an old payment re-applied after a newer renewal would
        // extend the period twice) — see claimCheckoutAsPaid
        // (lib/chargily-settlement.ts). The same claim guards the pull path
        // (/api/chargily/reconcile), so whichever arrives first activates.
        const claim = await claimCheckoutAsPaid(checkout, payload);
        if (claim.status === "duplicate") {
          console.log(`checkout.paid: ${checkout.id} already processed — skipping duplicate delivery`);
          break;
        }
        if (claim.status === "in_flight") {
          // Another delivery is settling this payment right now. NOT a 200: if that attempt fails, this
          // redelivery must come back — Chargily retries a non-2xx answer.
          return NextResponse.json({ error: "Paiement en cours de traitement — renvoie l'événement plus tard." }, { status: 503, headers: { "Retry-After": "120" } });
        }
        if (claim.status === "error") {
          // Database unreachable: nothing was decided. Chargily redelivers.
          return NextResponse.json({ error: "Traitement momentanément impossible — renvoie l'événement plus tard." }, { status: 500 });
        }
        claimedByThisDelivery = true;
        await fulfillPaidCheckout(checkout);
        await markFulfilled(checkout.id, claim.record);
        settledCheckout = checkout;
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
    // This delivery's claim marked the payment "paid": release it so
    // Chargily's retry of this event is processed instead of skipped as a duplicate.
    if (claimedByThisDelivery && checkout?.id) await releasePaidClaim(checkout.id);
    return NextResponse.json({ error: "Traitement du webhook échoué." }, { status: 500 });
  }

  // Outside the try/catch above on purpose: the payment is settled by now,
  // and nothing about its email (which never throws anyway) may release that
  // claim. Once per payment: a redelivery never gets past the claim.
  if (settledCheckout) await sendPaymentThankYouEmail(settledCheckout, request.nextUrl.origin);

  return NextResponse.json({ received: true });
}
