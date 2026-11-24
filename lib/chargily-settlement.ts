import { getChargilyCheckout, type ChargilyCheckout } from "@/lib/chargily";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { activateSubscription } from "@/lib/subscription";
import { isPlanId } from "@/lib/pricing";
import { createLeaderSeats, recordPoolPayment, recordUnusablePayment } from "@/lib/billing-pools";
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
 * IDEMPOTENCY GUARD against a redelivered `checkout.paid` event — and the
 * state machine that makes sure a paid checkout is never left without its
 * entitlement.
 *
 * Webhook providers (Chargily included) deliver at least once: the SAME
 * event can arrive several times, minutes or hours apart. Fulfilment must
 * run once per payment (activateSubscription extends the period; a group
 * leader's payment opens a group…), so a payment is first CLAIMED — its row
 * set to "paid" atomically — and only the delivery that wins the claim
 * fulfils it. The pull path (reconcileUserPayments) goes through the same
 * claim, so a webhook and a reconciliation racing for one payment fulfil it
 * once.
 *
 * Every claim is recorded in the row's raw_payload (`medart_settlement`:
 * claimed_at, then fulfilled_at once the entitlement is granted — no schema
 * change), which is what tells the cases apart when the row is already
 * "paid":
 *   - fulfilled (or settled before these markers existed) → a genuine
 *     duplicate: acknowledge it;
 *   - claimed less than CLAIM_STALE_MS ago → another delivery is fulfilling
 *     it right now: answer "try again later" (a 503 to Chargily) — never a
 *     200, or a first attempt that then fails would never be retried;
 *   - claimed longer ago and never fulfilled → the delivery that claimed it
 *     crashed (fulfilment AND the release of its claim failed, typically in
 *     the same database outage): taken over, atomically, and fulfilled.
 * A database error is "error" (a 500 to Chargily: redelivered later), never
 * "duplicate" — before, a hiccup here acknowledged the event and the payment
 * stayed pending with no retry.
 *
 * The initial `payments` row insert at checkout creation is best-effort, so
 * the row may not exist when the webhook arrives: it is then recovered here,
 * already paid. A unique violation on that insert means another delivery is
 * on it ("in_flight").
 */
const CLAIM_STALE_MS = 2 * 60 * 1000;

interface SettlementMarks {
  claimed_at: string;
  fulfilled_at?: string;
  takeovers?: number;
}

export type ClaimOutcome =
  | { status: "claimed"; record: Record<string, unknown> }
  | { status: "duplicate" }
  | { status: "in_flight" }
  | { status: "error" };

function settlementOf(rawPayload: unknown): SettlementMarks | null {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const marks = (rawPayload as { medart_settlement?: unknown }).medart_settlement;
  if (!marks || typeof marks !== "object" || typeof (marks as SettlementMarks).claimed_at !== "string") return null;
  return marks as SettlementMarks;
}

function withSettlement(payload: unknown, marks: SettlementMarks): Record<string, unknown> {
  const base = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : { payload };
  return { ...base, medart_settlement: marks };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function claimCheckoutAsPaid(checkout: ChargilyCheckout, payload: unknown): Promise<ClaimOutcome> {
  const nowIso = new Date().toISOString();
  const record = withSettlement(payload, { claimed_at: nowIso });
  if (!isSupabaseConfigured()) return { status: "claimed", record }; // dev / misconfigured env, as in the rest of this file
  const supabase = getSupabaseAdmin();

  // 1. The common case: the row exists from the checkout step and is not paid yet. Atomic.
  const { data: updated, error: updateError } = await supabase
    .from("payments")
    .update({ status: "paid", raw_payload: record, updated_at: nowIso })
    .eq("chargily_checkout_id", checkout.id)
    .neq("status", "paid")
    .select("id");
  if (updateError) {
    console.error(`[chargily-settlement] claim of ${checkout.id} failed — will be retried`, updateError);
    return { status: "error" };
  }
  if ((updated?.length ?? 0) > 0) return { status: "claimed", record };

  // 2. Zero rows updated: already paid, or no row at all.
  const { data: existing, error: selectError } = await supabase
    .from("payments")
    .select("status, raw_payload, updated_at")
    .eq("chargily_checkout_id", checkout.id)
    .maybeSingle();
  if (selectError) {
    console.error(`[chargily-settlement] could not read payment ${checkout.id} after a claim miss — will be retried`, selectError);
    return { status: "error" };
  }
  if (existing) {
    const row = existing as { status: string; raw_payload: unknown; updated_at: string };
    // Not paid any more: a failing delivery released its claim between our two reads.
    if (row.status !== "paid") return { status: "in_flight" };
    const marks = settlementOf(row.raw_payload);
    if (!marks || marks.fulfilled_at) return { status: "duplicate" };
    if (Date.now() - new Date(marks.claimed_at).getTime() < CLAIM_STALE_MS) return { status: "in_flight" };
    // 3. Claimed long ago, never fulfilled: the delivery that claimed it crashed. Take it over —
    //    compare-and-set on updated_at, so two deliveries can't both take it.
    const takeover = withSettlement(payload, { claimed_at: nowIso, takeovers: (marks.takeovers ?? 0) + 1 });
    const { data: taken, error: takeoverError } = await supabase
      .from("payments")
      .update({ raw_payload: takeover, updated_at: nowIso })
      .eq("chargily_checkout_id", checkout.id)
      .eq("status", "paid")
      .eq("updated_at", row.updated_at)
      .select("id");
    if (takeoverError) {
      console.error(`[chargily-settlement] takeover of stuck payment ${checkout.id} failed — will be retried`, takeoverError);
      return { status: "error" };
    }
    if ((taken?.length ?? 0) === 0) return { status: "in_flight" };
    console.warn(`[chargily-settlement] payment ${checkout.id} was claimed at ${marks.claimed_at} but never fulfilled — taken over and fulfilled now.`);
    return { status: "claimed", record: takeover };
  }

  // 4. No row at all — the best-effort insert at checkout time never landed. Recover it, already paid.
  const metadata = checkout.metadata ?? { userId: "", plan: "", email: "" };
  const { error: insertError } = await supabase.from("payments").insert({
    user_id: metadata.userId,
    plan: metadata.plan,
    amount: checkout.amount,
    currency: checkout.currency,
    chargily_checkout_id: checkout.id,
    status: "paid",
    raw_payload: record,
  });
  if (insertError) {
    // 23505 = unique_violation on chargily_checkout_id: a concurrent delivery inserted it and is on it.
    if ((insertError as { code?: string }).code === "23505") return { status: "in_flight" };
    console.error(`[chargily-settlement] could not recover missing payment row ${checkout.id} — will be retried`, insertError);
    return { status: "error" };
  }
  return { status: "claimed", record };
}

/**
 * Records that a claimed payment's entitlement was granted. Retried a few
 * times; if it still fails, a later delivery treats the claim as stuck and
 * fulfils again — harmless, every fulfilment is idempotent per checkout
 * (activateSubscription, createLeaderSeats, recordPoolPayment). Never throws.
 */
export async function markFulfilled(checkoutId: string, record: Record<string, unknown>): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const marks = settlementOf(record) ?? { claimed_at: new Date().toISOString() };
  const done = { ...record, medart_settlement: { ...marks, fulfilled_at: new Date().toISOString() } };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { error } = await getSupabaseAdmin()
        .from("payments")
        .update({ raw_payload: done, updated_at: new Date().toISOString() })
        .eq("chargily_checkout_id", checkoutId)
        .eq("status", "paid");
      if (!error) return;
      console.error(`[chargily-settlement] could not mark ${checkoutId} fulfilled (attempt ${attempt + 1}):`, error.message);
    } catch (error) {
      console.error(`[chargily-settlement] could not mark ${checkoutId} fulfilled (attempt ${attempt + 1}, threw):`, error instanceof Error ? error.message : error);
    }
    await pause(250 * (attempt + 1));
  }
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
    // Money received but nothing to grant (no payer, or a plan this version doesn't know — e.g. plans
    // changed while the checkout was open). Never swallowed: a refund request for the team, like the
    // groups' overflow payments.
    console.error(`[chargily-settlement] paid checkout ${checkout.id} has no usable userId/plan metadata (plan « ${plan || "?"} »)`);
    await recordUnusablePayment({ userId, checkoutId: checkout.id, amount: checkout.amount, plan });
  }
}

/**
 * Undoes a claim whose activation failed, so the next delivery (or
 * reconciliation) is processed instead of skipped as a duplicate. Retried; if
 * it still fails, the claim is taken over once stale (claimCheckoutAsPaid).
 * Never throws.
 */
export async function releasePaidClaim(checkoutId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { error } = await getSupabaseAdmin()
        .from("payments")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("chargily_checkout_id", checkoutId)
        .eq("status", "paid");
      if (!error) return;
      console.error(`[chargily-settlement] could not release claim of ${checkoutId} (attempt ${attempt + 1}):`, error.message);
    } catch (error) {
      console.error(`[chargily-settlement] could not release claim of ${checkoutId} (attempt ${attempt + 1}, threw):`, error instanceof Error ? error.message : error);
    }
    await pause(250 * (attempt + 1));
  }
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
      const claim = await claimCheckoutAsPaid(checkout, payload);
      if (claim.status === "duplicate") return "closed"; // the webhook (or another reconciliation) already settled it
      if (claim.status !== "claimed") return "pending"; // being settled right now, or the database hiccuped: ask again
      try {
        await fulfillPaidCheckout(checkout);
      } catch (error) {
        console.error(`[chargily-settlement] activation failed for paid checkout ${checkout.id}:`, error instanceof Error ? error.message : error);
        await releasePaidClaim(checkout.id);
        return "pending";
      }
      await markFulfilled(checkout.id, claim.record);
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
    // Pending payments, plus paid ones whose claim never reached fulfilment (a crashed delivery — see
    // claimCheckoutAsPaid): both get settled here, the latter only once their claim is stale.
    const { data, error } = await supabase
      .from("payments")
      .select("chargily_checkout_id, created_at, status, raw_payload")
      .eq("user_id", userId)
      .in("status", ["pending", "paid"])
      .gte("created_at", new Date(Date.now() - RECONCILE_WINDOW_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(RECONCILE_MAX_CHECKOUTS * 4);
    if (error) {
      console.error("[chargily-settlement] could not read pending payments:", error.message);
      return result;
    }
    const rows = ((data ?? []) as { chargily_checkout_id: string; created_at: string; status: string; raw_payload: unknown }[])
      .filter((row) => {
        if (row.status === "pending") return true;
        const marks = settlementOf(row.raw_payload);
        return Boolean(marks && !marks.fulfilled_at);
      })
      .slice(0, RECONCILE_MAX_CHECKOUTS);
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
