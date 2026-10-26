import { getChargilyCheckout, type ChargilyCheckout } from "@/lib/chargily";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { activateSubscription } from "@/lib/subscription";
import { isPlanId } from "@/lib/pricing";
import { createLeaderSeats, recordPoolPayment } from "@/lib/billing-pools";
import { sendPaymentThankYouEmail } from "@/lib/email/notifications";

/**
 * Settling a Chargily payment, shared by the two ways this app learns that a
 * checkout was paid:
 *  - PUSH: Chargily's signed webhook (app/api/chargily/webhook);
 *  - PULL: reconcileUserPayments below, which asks Chargily directly about a
 *    student's still-pending payments (app/api/chargily/reconcile) — the
 *    safety net for a webhook that arrives late or never (Chargily's hosted
 *    page or the Algérie Poste / CIB network stalling with a 504 is exactly
 *    when a payment goes through without the usual redirect).
 * Both go through the SAME atomic claim (claimCheckoutAsPaid), so a payment
 * activates exactly once, whichever path gets there first.
 */

/**
 * Records a `checkout.failed` / `checkout.canceled` event. Never downgrades a
 * row already "paid": an out-of-order event must not reopen a settled payment
 * to a second claim (a redelivered `checkout.paid` would then activate again).
 */
export async function updatePaymentStatus(
  checkoutId: string,
  status: "failed" | "canceled",
  payload: unknown
) {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("payments")
      .update({ status, raw_payload: payload, updated_at: new Date().toISOString() })
      .eq("chargily_checkout_id", checkoutId)
      .neq("status", "paid");
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
 * Returns `claimed: false` in every case where this call must NOT proceed to
 * activation. The pull path (reconcileUserPayments) uses this same claim, so
 * a webhook and a reconciliation racing for one payment activate it once.
 */
export async function claimCheckoutAsPaid(checkout: ChargilyCheckout, payload: unknown): Promise<{ claimed: boolean }> {
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

/** What a claimed, paid checkout buys: the payer's plan, a group leader's seats, or a share of a pooled group. Throws on a failed activation (the caller releases the claim). */
export async function fulfillPaidCheckout(checkout: ChargilyCheckout): Promise<void> {
  const metadata = checkout.metadata ?? { userId: "", plan: "", email: "" };
  const userId = metadata.userId;
  const plan = metadata.plan;

  if (userId && isPlanId(plan)) {
    if (metadata.kind === "pool_member" && metadata.poolId) {
      // A share of a pooled Promo / Groupe: counted on the gauge; the
      // payment that fills the last seat activates every member.
      await recordPoolPayment(metadata.poolId, userId, checkout.id, checkout.amount);
    } else if (metadata.kind === "group_leader") {
      await createLeaderSeats(userId, plan, checkout.id, metadata.email || undefined);
    } else {
      await activateSubscription({
        userId,
        email: metadata.email || undefined,
        plan,
        chargilyCheckoutId: checkout.id,
      });
    }
  } else {
    console.error("checkout.paid webhook missing userId/plan metadata", checkout.id);
  }
}

/** Undoes a claim whose activation failed, so the next delivery (or reconciliation) is processed instead of skipped as a duplicate. */
export async function releasePaidClaim(checkoutId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await getSupabaseAdmin().from("payments").update({ status: "pending", updated_at: new Date().toISOString() }).eq("chargily_checkout_id", checkoutId);
}

// ─── pull: reconciliation of a student's pending payments ────────────────

/** Pending payments older than this are not looked at any more. */
const RECONCILE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** The most recent pending payments checked per call (in parallel, one GET to Chargily each) — enough for a few retries during an outage. */
const RECONCILE_MAX_CHECKOUTS = 5;
/**
 * Chargily expires an unpaid checkout after 30 minutes, yet may still report
 * it "pending": well past that it was abandoned and is closed as canceled, so
 * it stops being re-checked. Safe either way — a `checkout.paid` webhook
 * still claims a canceled row (the claim only skips rows already paid).
 */
const ABANDONED_AFTER_MS = 2 * 60 * 60 * 1000;
/** How recent a payment must be to count as « the one the student just made » (latestStatus). */
const LATEST_PAYMENT_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface ReconcileResult {
  /** Payments found paid at Chargily and activated by THIS call. */
  activated: number;
  /** Payments still pending at Chargily (or unreachable): worth asking again a little later. */
  pending: number;
  /** Status of the student's most recent payment (last 2 hours) once reconciled — "paid" whoever settled it, webhook included. */
  latestStatus: "pending" | "paid" | "failed" | "canceled" | null;
}

type CheckoutOutcome = "activated" | "pending" | "closed";

/** Sets a still-pending row to its final Chargily status; never touches a row a webhook already settled. */
async function closePendingPayment(checkoutId: string, status: "failed" | "canceled", payload: unknown): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("payments")
    .update({ status, raw_payload: payload, updated_at: new Date().toISOString() })
    .eq("chargily_checkout_id", checkoutId)
    .eq("status", "pending");
  if (error) console.error(`[chargily-settlement] could not close pending payment ${checkoutId}:`, error.message);
}

async function reconcileCheckout(userId: string, checkoutId: string, createdAt: string, origin: string): Promise<CheckoutOutcome> {
  const current = await getChargilyCheckout(checkoutId);
  // Chargily unreachable right now: nothing is decided, ask again later.
  if (!current.ok) return "pending";
  const checkout = current.data;
  const payload = { source: "reconcile", data: checkout };
  // Fetched with our own secret key, so trusted — still, never settle someone else's payment here.
  if (checkout.metadata?.userId && checkout.metadata.userId !== userId) return "closed";

  switch (checkout.status) {
    case "paid": {
      // Every kind (individual, group leader, pooled share) is fulfilled exactly as the webhook would.
      const { claimed } = await claimCheckoutAsPaid(checkout, payload);
      if (!claimed) return "closed"; // the webhook (or another reconciliation) already settled it
      try {
        await fulfillPaidCheckout(checkout);
      } catch (error) {
        console.error(`[chargily-settlement] activation failed for paid checkout ${checkout.id}:`, error instanceof Error ? error.message : error);
        await releasePaidClaim(checkout.id);
        return "pending";
      }
      console.log(`[chargily-settlement] checkout ${checkout.id} found paid at Chargily — activated without its webhook.`);
      // Settled by THIS call (claim + fulfilment above): thank the payer once,
      // exactly as the webhook would have. Never throws, never releases the claim.
      await sendPaymentThankYouEmail(checkout, origin);
      return "activated";
    }
    case "failed":
      await closePendingPayment(checkoutId, "failed", payload);
      return "closed";
    case "canceled":
    case "expired":
      await closePendingPayment(checkoutId, "canceled", payload);
      return "closed";
    default:
      if (checkout.status === "pending" && Date.now() - new Date(createdAt).getTime() >= ABANDONED_AFTER_MS) {
        await closePendingPayment(checkoutId, "canceled", payload);
        return "closed";
      }
      // "pending" / "processing": the student may still be paying, or the bank is still answering.
      return "pending";
  }
}

/**
 * Asks Chargily about this student's most recent pending payments and settles
 * the paid ones exactly as the webhook would. Never throws. `origin` is the
 * app's address for the links in the thank-you email (APP_URL wins when set).
 */
export async function reconcileUserPayments(userId: string, origin = ""): Promise<ReconcileResult> {
  const result: ReconcileResult = { activated: 0, pending: 0, latestStatus: null };
  if (!isSupabaseConfigured()) return result;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("payments")
      .select("chargily_checkout_id, created_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .gte("created_at", new Date(Date.now() - RECONCILE_WINDOW_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(RECONCILE_MAX_CHECKOUTS);
    if (error) {
      console.error("[chargily-settlement] could not read pending payments:", error.message);
      return result;
    }
    const rows = (data ?? []) as { chargily_checkout_id: string; created_at: string }[];
    const outcomes = await Promise.all(rows.map((row) => reconcileCheckout(userId, row.chargily_checkout_id, row.created_at, origin)));
    for (const outcome of outcomes) {
      if (outcome === "activated") result.activated++;
      else if (outcome === "pending") result.pending++;
    }

    const { data: latest } = await supabase
      .from("payments")
      .select("status")
      .eq("user_id", userId)
      .gte("created_at", new Date(Date.now() - LATEST_PAYMENT_WINDOW_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    result.latestStatus = (latest as { status: ReconcileResult["latestStatus"] } | null)?.status ?? null;
  } catch (error) {
    console.error("[chargily-settlement] reconciliation failed:", error instanceof Error ? error.message : error);
  }
  return result;
}
