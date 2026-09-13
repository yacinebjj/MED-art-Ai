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

/**
 * IDEMPOTENCY GUARD against a redelivered `checkout.paid` event.
 *
 * Webhook providers (Chargily included) use at-least-once delivery: a slow
 * response, a transient 5xx, or their own retry policy can and does cause
 * the SAME event to arrive more than once — sometimes minutes or hours
 * apart. Without this guard, activateSubscription() below runs again on
 * every redelivery, and it is NOT naturally idempotent: it resets
 * generations_used/chat_messages_used/etc. to 0 and shifts period_start to
 * "now" every time it runs. A benign redelivery would silently hand the
 * student a free mid-cycle quota reset and quietly shift their billing
 * window — a real, exploitable-by-accident correctness bug, not a
 * hypothetical.
 *
 * Two-step claim, not a single blind upsert, because the initial `payments`
 * row insert at checkout-creation time (app/api/chargily/checkout/route.ts)
 * is EXPLICITLY best-effort — a Supabase hiccup there must never block a
 * checkout Chargily already created. So by the time the webhook fires, the
 * row may genuinely not exist yet, and "no row found" must NOT be treated
 * the same as "already paid, skip":
 *
 *   1. Conditional UPDATE ... WHERE status != 'paid' — the common case (the
 *      row exists from the checkout step). Atomic: only the request that
 *      actually flips the row wins, which is also what makes this safe
 *      against two redeliveries arriving genuinely concurrently (Postgres
 *      serializes concurrent UPDATEs to the same row; a plain
 *      SELECT-then-UPDATE would have a real time-of-check/time-of-use race
 *      here).
 *   2. If that affected zero rows, find out WHY before deciding: either the
 *      row already says "paid" (a genuine redelivery — skip), or it never
 *      existed (recover it here, from the webhook's own data, via an
 *      INSERT). The INSERT can itself lose a concurrency race to another
 *      redelivery — a unique-violation on chargily_checkout_id there means
 *      the other request won, so this one correctly stands down too.
 *
 * Returns `claimed: false` in every case where this webhook call must NOT
 * proceed to activateSubscription.
 */
async function claimCheckoutAsPaid(checkout: ChargilyCheckout, payload: unknown): Promise<{ claimed: boolean }> {
  if (!isSupabaseConfigured()) return { claimed: true }; // fail-open in dev/misconfigured envs, matches the rest of this file
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from("payments")
    .update({ status: "paid", raw_payload: payload, updated_at: nowIso })
    .eq("chargily_checkout_id", checkout.id)
    .neq("status", "paid")
    .select("id");

  if (updateError) {
    console.error("Failed to atomically claim checkout as paid — refusing to activate on ambiguity", updateError);
    return { claimed: false };
  }
  if ((updated?.length ?? 0) > 0) return { claimed: true };

  // Zero rows updated — disambiguate "already paid" from "row never existed".
  const { data: existing, error: selectError } = await supabase
    .from("payments")
    .select("status")
    .eq("chargily_checkout_id", checkout.id)
    .maybeSingle();

  if (selectError) {
    console.error("Failed to read payment row while disambiguating a claim miss — refusing to activate on ambiguity", selectError);
    return { claimed: false };
  }
  if (existing) {
    // Row exists and (per the failed UPDATE above) is already "paid" — a
    // genuine redelivery. Do not re-activate.
    return { claimed: false };
  }

  // No row at all — the best-effort insert at checkout time never landed.
  // Recover it here, straight from the webhook's own payload, already paid.
  const metadata = checkout.metadata ?? { userId: "", plan: "", email: "" };
  const { error: insertError } = await supabase.from("payments").insert({
    user_id: metadata.userId,
    plan: metadata.plan,
    amount: checkout.amount,
    currency: checkout.currency,
    chargily_checkout_id: checkout.id,
    status: "paid",
    raw_payload: payload,
  });

  if (insertError) {
    // 23505 = unique_violation on chargily_checkout_id: a concurrent
    // redelivery's INSERT (or UPDATE) won this exact race — correct for
    // this request to stand down, not to treat it as a real failure.
    if ((insertError as { code?: string }).code === "23505") return { claimed: false };
    console.error("Failed to recover a missing payment row as paid — refusing to activate on ambiguity", insertError);
    return { claimed: false };
  }
  return { claimed: true };
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
        // Idempotency FIRST: this both records the payment as paid AND
        // tells us whether WE are the delivery that gets to act on it. A
        // redelivery of an already-paid checkout must never reach
        // activateSubscription() again — see claimCheckoutAsPaid's own
        // comment for why that call is not naturally idempotent.
        const { claimed } = await claimCheckoutAsPaid(checkout, payload);
        if (!claimed) {
          console.log(`checkout.paid: ${checkout.id} already processed — skipping duplicate delivery`);
          break;
        }

        const metadata = checkout.metadata ?? { userId: "", plan: "", email: "" };
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
