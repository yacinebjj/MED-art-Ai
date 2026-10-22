import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ChargilyUnavailableError, createChargilyCheckout, expireChargilyCheckout, getChargilyCheckout, type ChargilyCheckout } from "@/lib/chargily";
import { PAYMENT_GATEWAY_UNAVAILABLE_MESSAGE } from "@/lib/payment-messages";
import { GROUP_SIZE, PLANS, POOL_DEADLINE_DAYS, PROMO_SIZE, SEAT_HOLD_MINUTES, type BillingCycle, type PlanId } from "@/lib/pricing";
import { activateSubscription, getSubscription, isSubscriptionActive } from "@/lib/subscription";

/**
 * POOLED PURCHASES (monetization v2) — server side of the Groupe de 10
 * (tier id "promo", exactly 10) and Groupe (exactly 5) plans.
 *
 *  - "pooled": every member pays their own share through the invite link.
 *    A member about to pay holds a seat for HOLD_MINUTES, so the pool can
 *    never take more payments than seats (billing_pool_hold_seat, row-locked
 *    in Postgres). The payment that fills the last seat completes the pool:
 *    every paid member is activated at once. Not full after
 *    POOL_DEADLINE_DAYS days → the pool expires and each paid member gets
 *    an automatic refund request (billing_pools_expire), processed by the
 *    team from /dashboard/admin/refunds — Chargily has no refund API, so the
 *    transfer itself is manual and the student is told the real delay.
 *  - "leader": one student paid the 5 Groupe seats; the 4 others join with
 *    the invite code and share the leader's period.
 *
 * Money safety:
 *  - A member never has two payable checkouts for the same seat: before a
 *    new checkout is opened (« Reprendre le paiement ») or a seat is left,
 *    the previous one is expired at Chargily — or, if it is already paid /
 *    being processed, nothing new is opened (startPoolCheckout, leavePool).
 *  - A payment that cannot take a seat is never swallowed: overflow / late
 *    payments get a refund request in billing_pool_mark_paid, a second
 *    payment of an already-paid member or a payment for a pool that no
 *    longer exists gets one here (recordPoolPayment).
 *  - Activation of a completed pool is idempotent and retried wherever a
 *    member shows up (webhook redelivery, tracker, billing page, account
 *    refresh), so an interrupted activation loop always finishes.
 *
 * Expiry is applied lazily on every read (and by /api/cron/billing-pools),
 * so no deadline depends on a cron actually firing.
 */

const HOLD_MINUTES = SEAT_HOLD_MINUTES;

export type PoolKind = "promo" | "group";
export type PoolMode = "pooled" | "leader";

export interface PoolRow {
  id: string;
  kind: PoolKind;
  mode: PoolMode;
  cycle: BillingCycle;
  plan: PlanId;
  size: number;
  price_per_member: number;
  invite_code: string;
  created_by: string;
  status: "open" | "complete" | "expired";
  expires_at: string;
  completed_at: string | null;
  period_end: string | null;
  created_at: string;
}

interface MemberRow {
  id: string;
  pool_id: string;
  user_id: string;
  status: "holding" | "paid" | "activated" | "refund_pending" | "refunded" | "released";
  chargily_checkout_id: string | null;
  amount: number;
  hold_expires_at: string | null;
  paid_at: string | null;
  activated_at: string | null;
}

/**
 * pool_expired / pool_overflow: created by the SQL functions (member_id set).
 * duplicate_payment / orphan_payment: an extra payment recorded here
 * (member_id null) — see recordExtraPaymentRefund.
 */
type RefundReason = "pool_expired" | "pool_overflow" | "duplicate_payment" | "orphan_payment";

interface RefundRow {
  id: string;
  user_id: string;
  pool_id: string | null;
  amount: number;
  reason: RefundReason;
  status: "pending" | "refunded";
  created_at: string;
  refunded_at: string | null;
  refunded_by: string | null;
  note: string | null;
  chargily_checkout_id: string | null;
}

export interface PoolView {
  code: string;
  kind: PoolKind;
  mode: PoolMode;
  cycle: BillingCycle;
  planLabel: string;
  size: number;
  /** Members who paid (pooled) or took a seat (leader). */
  confirmed: number;
  status: PoolRow["status"];
  pricePerMember: number;
  expiresAt: string;
  completedAt: string | null;
  periodEnd: string | null;
  isCreator: boolean;
  me: {
    status: MemberRow["status"] | null;
    refund: { status: RefundRow["status"]; createdAt: string; refundedAt: string | null; amount: number } | null;
    /** When the member opened their current checkout (status "holding" only): tells a payment being confirmed from an abandoned one. */
    paymentStartedAt: string | null;
    /** End of the seat reservation (status "holding" only). */
    holdExpiresAt: string | null;
    /** The viewer already has a paid plan running until this date, so they cannot pay a share now. */
    activePlanEnd: string | null;
    /** Automatic refunds of an extra payment this member made for this group (paid twice). */
    extraRefunds: { amount: number; status: RefundRow["status"]; createdAt: string; refundedAt: string | null }[];
  };
}

export class PoolError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function db() {
  return getSupabaseAdmin();
}

const CYCLE_LABEL: Record<BillingCycle, string> = { monthly: "1 mois", quad: "4 mois", annual: "8 mois" };

/** "Groupe de 10 · 1 mois" — how a pool is named in messages. */
function describePool(pool: Pick<PoolRow, "plan" | "size" | "cycle">): string {
  return `${PLANS[pool.plan]?.label ?? `Groupe de ${pool.size}`} · ${CYCLE_LABEL[pool.cycle] ?? pool.cycle}`;
}

function formatFrenchDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/** 8 characters, no ambiguous ones (0/O, 1/I): easy to read out in a group chat. */
function newInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{8}$/.test(code) ? code : null;
}

/** False until supabase/migrations/20261007_monetization.sql has run: group / promo purchases are refused instead of half-working. */
export async function billingPoolsAvailable(): Promise<boolean> {
  const { error } = await db().from("billing_pools").select("id").limit(1);
  if (!error) return true;
  console.error("[billing-pools] billing tables unavailable (run the 20261007 migration):", error.message);
  return false;
}

export async function expireOverduePools(): Promise<number> {
  const { data, error } = await db().rpc("billing_pools_expire");
  if (error) {
    console.error("[billing-pools] billing_pools_expire failed:", error.message);
    return 0;
  }
  return Number(data ?? 0);
}

async function poolByCode(code: string): Promise<PoolRow | null> {
  const { data, error } = await db().from("billing_pools").select("*").eq("invite_code", code).maybeSingle();
  if (error) throw new PoolError("Lecture du groupe impossible pour le moment.", 500);
  return (data as PoolRow | null) ?? null;
}

async function membersOf(poolId: string): Promise<MemberRow[]> {
  const { data, error } = await db().from("billing_pool_members").select("*").eq("pool_id", poolId);
  if (error) throw new PoolError("Lecture du groupe impossible pour le moment.", 500);
  return (data ?? []) as MemberRow[];
}

/**
 * Activates every PAID member of a completed pooled purchase. Idempotent:
 * a member is flipped to "activated" only after their subscription is
 * written, and only "paid" members are picked up — rerunning after a crash
 * finishes the job without activating anyone twice (activateSubscription is
 * itself idempotent per checkout id). One member's failure never stops the
 * others; the call throws at the end if anyone is still not activated, so
 * the webhook answers 500 and Chargily's redelivery retries it.
 */
export async function activateCompletedPool(poolId: string): Promise<void> {
  const { data: pool, error } = await db().from("billing_pools").select("*").eq("id", poolId).maybeSingle();
  if (error) throw new Error(`activateCompletedPool: pool read failed: ${error.message}`);
  const row = pool as PoolRow | null;
  if (!row || row.status !== "complete" || row.mode !== "pooled") return;
  const members = (await membersOf(poolId)).filter((m) => m.status === "paid");
  let failed = 0;
  for (const member of members) {
    try {
      await activateSubscription({ userId: member.user_id, plan: row.plan, chargilyCheckoutId: member.chargily_checkout_id ?? `pool:${poolId}` });
      const now = new Date().toISOString();
      const { error: updateError } = await db().from("billing_pool_members").update({ status: "activated", activated_at: now, updated_at: now }).eq("id", member.id).eq("status", "paid");
      if (updateError) throw new Error(updateError.message);
    } catch (activationError) {
      failed += 1;
      console.error(`[billing-pools] activation of member ${member.id} (pool ${poolId}) failed:`, activationError instanceof Error ? activationError.message : activationError);
    }
  }
  if (failed > 0) throw new Error(`activateCompletedPool: ${failed}/${members.length} member(s) not activated yet (pool ${poolId})`);
}

/** Same as activateCompletedPool, for callers that must never fail because of it (page loads, account refresh). */
async function activateCompletedPoolSafely(poolId: string): Promise<void> {
  try {
    await activateCompletedPool(poolId);
  } catch (error) {
    console.error("[billing-pools] activation retry failed:", error instanceof Error ? error.message : error);
  }
}

/**
 * Self-heal for the account refresh (/api/subscription): finishes the
 * activation of any completed group this student paid for but was not
 * activated in yet (an interrupted activation loop). Never throws.
 */
export async function ensurePendingPoolActivations(userId: string): Promise<void> {
  try {
    const { data, error } = await db().from("billing_pool_members").select("pool_id").eq("user_id", userId).eq("status", "paid");
    if (error || !data || data.length === 0) return;
    const ids = Array.from(new Set((data as { pool_id: string }[]).map((m) => m.pool_id)));
    const { data: pools } = await db().from("billing_pools").select("id").in("id", ids).eq("status", "complete").eq("mode", "pooled");
    for (const pool of (pools ?? []) as { id: string }[]) await activateCompletedPoolSafely(pool.id);
  } catch (error) {
    console.error("[billing-pools] ensurePendingPoolActivations failed:", error instanceof Error ? error.message : error);
  }
}

/** What a pool view needs to know about the viewer's own account. */
interface ViewerContext {
  activePlanEnd: string | null;
}

async function viewerContext(userId: string): Promise<ViewerContext> {
  const sub = await getSubscription(userId);
  return { activePlanEnd: sub && isSubscriptionActive(sub) && sub.period_end ? sub.period_end : null };
}

/** The seat is held HOLD_MINUTES from the moment the member's current checkout was opened. */
function paymentStartedAtOf(member: MemberRow | null): string | null {
  if (!member || member.status !== "holding" || !member.hold_expires_at || !member.chargily_checkout_id) return null;
  return new Date(new Date(member.hold_expires_at).getTime() - HOLD_MINUTES * 60_000).toISOString();
}

async function buildView(pool: PoolRow, userId: string, ctx: ViewerContext): Promise<PoolView> {
  const members = await membersOf(pool.id);
  const confirmed = members.filter((m) => (pool.mode === "pooled" ? m.status === "paid" || m.status === "activated" : m.status === "activated")).length;
  const mine = members.find((m) => m.user_id === userId) ?? null;
  let refund: PoolView["me"]["refund"] = null;
  if (mine && (mine.status === "refund_pending" || mine.status === "refunded")) {
    const { data } = await db().from("billing_refund_requests").select("status, created_at, refunded_at, amount").eq("member_id", mine.id).maybeSingle();
    const r = data as Pick<RefundRow, "status" | "created_at" | "refunded_at" | "amount"> | null;
    if (r) refund = { status: r.status, createdAt: r.created_at, refundedAt: r.refunded_at, amount: r.amount };
  }
  let extraRefunds: PoolView["me"]["extraRefunds"] = [];
  if (mine && mine.status !== "holding" && mine.status !== "released") {
    const { data } = await db()
      .from("billing_refund_requests")
      .select("status, created_at, refunded_at, amount")
      .eq("pool_id", pool.id)
      .eq("user_id", userId)
      .is("member_id", null)
      .order("created_at", { ascending: true });
    extraRefunds = ((data ?? []) as Pick<RefundRow, "status" | "created_at" | "refunded_at" | "amount">[]).map((r) => ({
      amount: r.amount,
      status: r.status,
      createdAt: r.created_at,
      refundedAt: r.refunded_at,
    }));
  }
  return {
    code: pool.invite_code,
    kind: pool.kind,
    mode: pool.mode,
    cycle: pool.cycle,
    planLabel: PLANS[pool.plan]?.label ?? pool.plan,
    size: pool.size,
    confirmed,
    status: pool.status,
    pricePerMember: pool.price_per_member,
    expiresAt: pool.expires_at,
    completedAt: pool.completed_at,
    periodEnd: pool.period_end,
    isCreator: pool.created_by === userId,
    me: {
      status: mine?.status ?? null,
      refund,
      paymentStartedAt: paymentStartedAtOf(mine),
      holdExpiresAt: mine?.status === "holding" ? mine.hold_expires_at : null,
      activePlanEnd: ctx.activePlanEnd,
      extraRefunds,
    },
  };
}

/** Tracker read: applies overdue expiry and finishes any interrupted activation first. */
export async function getPoolView(code: string, userId: string): Promise<PoolView> {
  await expireOverduePools();
  const pool = await poolByCode(code);
  if (!pool) throw new PoolError("Ce lien d'invitation n'existe pas. Vérifie-le auprès de la personne qui te l'a envoyé.", 404);
  if (pool.status === "complete" && pool.mode === "pooled") await activateCompletedPoolSafely(pool.id);
  return buildView(pool, userId, await viewerContext(userId));
}

async function assertNoActivePaidPlan(userId: string, context: "create" | "join"): Promise<void> {
  const sub = await getSubscription(userId);
  if (sub && isSubscriptionActive(sub) && sub.period_end) {
    const end = formatFrenchDate(sub.period_end);
    throw new PoolError(
      context === "create"
        ? `Tu as déjà un abonnement actif jusqu'au ${end} : tu profites déjà de tout MedArt AI. Tu pourras lancer un groupe dès la fin de ton abonnement.`
        : `Tu as déjà un abonnement actif jusqu'au ${end} : tu n'as rien à payer pour l'instant. Tu pourras rejoindre un groupe à la fin de ton abonnement — préviens le créateur pour qu'il invite quelqu'un d'autre à ta place.`,
      409
    );
  }
}

/**
 * The open pooled purchase this student is committed to: a paid share, or
 * a seat reservation that is still running. An EXPIRED reservation does not
 * count — clicking « Payer » on a group without paying never traps anyone.
 */
async function openMembershipOf(userId: string): Promise<PoolRow | null> {
  const { data } = await db().from("billing_pool_members").select("pool_id, status, hold_expires_at").eq("user_id", userId).in("status", ["holding", "paid"]);
  const now = Date.now();
  const ids = ((data ?? []) as Pick<MemberRow, "pool_id" | "status" | "hold_expires_at">[])
    .filter((m) => m.status === "paid" || (m.hold_expires_at !== null && new Date(m.hold_expires_at).getTime() > now))
    .map((m) => m.pool_id);
  if (ids.length === 0) return null;
  const { data: pools } = await db().from("billing_pools").select("*").in("id", ids).eq("status", "open");
  const open = ((pools ?? []) as PoolRow[]).filter((p) => new Date(p.expires_at).getTime() > now);
  return open[0] ?? null;
}

/** The open pooled purchase this student started themselves (paid or not yet). */
async function createdOpenPoolOf(userId: string): Promise<PoolRow | null> {
  const { data } = await db().from("billing_pools").select("*").eq("created_by", userId).eq("mode", "pooled").eq("status", "open").order("created_at", { ascending: false });
  const now = Date.now();
  return ((data ?? []) as PoolRow[]).find((p) => new Date(p.expires_at).getTime() > now) ?? null;
}

/** Someone paid, or holds a seat (running, or ended in the last 10 minutes: a payment may still be confirming). */
function poolHasActivity(members: MemberRow[]): boolean {
  const recent = Date.now() - 10 * 60_000;
  return members.some(
    (m) => m.status === "paid" || m.status === "activated" || (m.status === "holding" && m.hold_expires_at !== null && new Date(m.hold_expires_at).getTime() > recent)
  );
}

/**
 * The student started a group, nobody paid or is paying in it, and they now
 * pick another formula (another duration, Groupe de 5 / de 10): that empty
 * group is closed so the new one replaces it. A group with any activity is
 * never closed this way.
 */
async function retireEmptyCreatedPool(pool: PoolRow): Promise<void> {
  const busy = `Ton groupe en cours (${describePool(pool)}) a déjà des membres : ouvre-le depuis « Ton groupe en cours », en haut de ta page Abonnement, plutôt que d'en lancer un autre.`;
  if (poolHasActivity(await membersOf(pool.id))) throw new PoolError(busy, 409);
  const { error } = await db().from("billing_pools").update({ status: "expired" }).eq("id", pool.id).eq("status", "open");
  if (error) {
    console.error("[billing-pools] could not close an empty group:", error.message);
    throw new PoolError("La création du groupe n'a pas abouti — rien n'a été payé. Réessaie dans un instant.", 500);
  }
  // A friend may have reserved a seat in that very instant — or the re-check itself fails:
  // in both cases the old group is reopened, never left closed by mistake.
  let activity = true;
  let recheckFailed = false;
  try {
    activity = poolHasActivity(await membersOf(pool.id));
  } catch (recheckError) {
    recheckFailed = true;
    console.error("[billing-pools] re-check of a closed empty group failed:", recheckError instanceof Error ? recheckError.message : recheckError);
  }
  if (activity) {
    const { error: reopenError } = await db().from("billing_pools").update({ status: "open" }).eq("id", pool.id).eq("status", "expired");
    if (reopenError) console.error(`[billing-pools] could not reopen group ${pool.id} after a failed replacement:`, reopenError.message);
    if (recheckFailed) throw new PoolError("La création du groupe n'a pas abouti — rien n'a été payé. Réessaie dans un instant.", 500);
    throw new PoolError(busy, 409);
  }
}

/**
 * Creates a pooled Groupe de 10 (tier id "promo", 10 seats) or Groupe de 5,
 * any cycle, and returns its invite code. One open group at a time: a
 * student who already paid or is paying in one is sent back to it; a group
 * they started for the same formula is reused; an EMPTY group they started
 * for another formula is replaced.
 */
export async function createPooledPurchase(userId: string, kind: PoolKind, cycle: BillingCycle): Promise<string> {
  if (!(await billingPoolsAvailable())) throw new PoolError("Les formules Groupe arrivent dans quelques instants — réessaie un peu plus tard.", 503);
  await expireOverduePools();
  await assertNoActivePaidPlan(userId, "create");
  const membership = await openMembershipOf(userId);
  if (membership) {
    if (membership.kind === kind && membership.cycle === cycle) return membership.invite_code;
    throw new PoolError(
      `Tu as déjà une place réservée ou payée dans un groupe en cours (${describePool(membership)}). Ouvre-le depuis « Ton groupe en cours », en haut de ta page Abonnement : un seul groupe à la fois.`,
      409
    );
  }
  const started = await createdOpenPoolOf(userId);
  if (started) {
    if (started.kind === kind && started.cycle === cycle) return started.invite_code;
    await retireEmptyCreatedPool(started);
  }
  const plan = `${kind}_${cycle}` as PlanId;
  const size = kind === "promo" ? PROMO_SIZE : GROUP_SIZE;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newInviteCode();
    const { error } = await db()
      .from("billing_pools")
      .insert({
        kind,
        mode: "pooled",
        cycle,
        plan,
        size,
        price_per_member: PLANS[plan].priceDZD,
        invite_code: code,
        created_by: userId,
        expires_at: new Date(Date.now() + POOL_DEADLINE_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      });
    if (!error) return code;
    const pgError = error as { code?: string; message?: string; details?: string | null; hint?: string | null };
    if (pgError.code !== "23505") {
      console.error("[billing-pools] create failed:", pgError.code ?? "", pgError.message ?? "", pgError.details ?? "", pgError.hint ?? "");
      if (pgError.code === "23514") {
        console.error(`[billing-pools] billing_pools refused a ${size}-seat pool: run supabase/migrations/20261021_group_pool_hardening.sql (its size check must allow 5, 10, 15 and 40).`);
      }
      throw new PoolError("La création du groupe n'a pas abouti — rien n'a été payé. Réessaie dans un instant.", 500);
    }
  }
  throw new PoolError("La création du groupe n'a pas abouti — rien n'a été payé. Réessaie dans un instant.", 500);
}

/**
 * Makes sure a checkout this member opened earlier can no longer be paid
 * before anything else happens to their seat (a new checkout, or leaving):
 *  - "free": expired now, already expired, failed or canceled — safe;
 *  - "paid": paid or being processed by Chargily — must NOT open another;
 *  - "unknown": Chargily could not be reached — refuse, never risk two payments.
 * Anything but a successful expiry is confirmed with GET /checkouts/{id}.
 * `holdEnded`: the seat reservation that came with this checkout is over —
 * the checkout is then past Chargily's 30-minute lifetime and a "pending"
 * status can only mean it expired unpaid.
 */
async function settleCheckout(checkoutId: string, holdEnded: boolean): Promise<"free" | "paid" | "unknown"> {
  const expired = await expireChargilyCheckout(checkoutId);
  let outcome: "free" | "paid" | "unknown";
  if (expired.ok) {
    outcome = "free"; // It was pending and has just been expired: it cannot be paid any more.
  } else {
    const current = await getChargilyCheckout(checkoutId);
    if (current.ok) {
      const status = String(current.data.status ?? "").toLowerCase();
      if (status === "paid" || status === "processing") outcome = "paid";
      else if (status === "failed" || status === "canceled" || status === "cancelled" || status === "expired") outcome = "free";
      // Chargily answers 400 to « expire » when the checkout already expired (it can still read "pending").
      else if (status === "pending" && (expired.status === 400 || holdEnded)) outcome = "free";
      else outcome = "unknown";
    } else {
      outcome = current.status === 404 ? "free" : "unknown";
    }
  }
  if (outcome === "free") {
    // The abandoned checkout stops showing as « En attente » in the student's payment history.
    const { error } = await db().from("payments").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("chargily_checkout_id", checkoutId).eq("status", "pending");
    if (error) console.warn("[billing-pools] could not mark an abandoned checkout as canceled:", error.message);
  }
  return outcome;
}

/**
 * Frees THIS request's seat reservation when it never got a payable checkout
 * (creation or recording failed). Compare-and-set on the checkout the seat
 * recorded when this request started: if a concurrent request (another tab)
 * attached its own checkout meanwhile, that live reservation is left alone.
 */
async function releaseHold(poolId: string, userId: string, recordedCheckoutId: string | null): Promise<void> {
  let release = db()
    .from("billing_pool_members")
    .update({ status: "released", hold_expires_at: null, updated_at: new Date().toISOString() })
    .eq("pool_id", poolId)
    .eq("user_id", userId)
    .eq("status", "holding");
  release = recordedCheckoutId ? release.eq("chargily_checkout_id", recordedCheckoutId) : release.is("chargily_checkout_id", null);
  const { error } = await release;
  if (error) console.error("[billing-pools] could not release a seat reservation:", error.message);
}

/** True once a member's seat reservation is over (released, or its hold time passed). */
function holdEndedFor(member: MemberRow): boolean {
  return member.status !== "holding" || !member.hold_expires_at || new Date(member.hold_expires_at).getTime() <= Date.now();
}

async function releasePreviousCheckout(checkoutId: string, holdEnded: boolean): Promise<void> {
  const outcome = await settleCheckout(checkoutId, holdEnded);
  if (outcome === "paid") {
    throw new PoolError("Ton paiement précédent est déjà validé (ou en cours de validation) chez Chargily. Ne repaie surtout pas : ta place sera confirmée automatiquement dans quelques minutes.", 409);
  }
  if (outcome === "unknown") {
    throw new PoolError("Impossible de vérifier ton paiement précédent auprès de Chargily pour le moment. Pour éviter tout double paiement, réessaie dans une minute.", 503);
  }
}

/** Holds a seat, then opens the Chargily checkout for this member's share. */
export async function startPoolCheckout(code: string, user: { id: string; email?: string | null }, appUrl: string): Promise<string> {
  await expireOverduePools();
  const pool = await poolByCode(code);
  if (!pool) throw new PoolError("Ce lien d'invitation n'existe pas.", 404);
  if (pool.mode !== "pooled") throw new PoolError("Ce groupe a déjà été payé par son chef : utilise « Rejoindre » avec le code.", 400);
  await assertNoActivePaidPlan(user.id, "join");
  const other = await openMembershipOf(user.id);
  if (other && other.id !== pool.id) {
    throw new PoolError(`Tu as déjà une place réservée ou payée dans un autre groupe (${describePool(other)}). Ouvre-le depuis ta page Abonnement, ou quitte-le avant de payer ici.`, 409);
  }

  // Never two payable checkouts for the same seat (« Reprendre le paiement », a second tab…):
  // the previous one is expired first, or nothing new is opened if it is already being paid.
  const previous = (await membersOf(pool.id)).find((m) => m.user_id === user.id) ?? null;
  if (previous && (previous.status === "paid" || previous.status === "activated")) throw new PoolError("Ton paiement pour ce groupe est déjà confirmé.", 409);
  const previousCheckoutId = previous?.chargily_checkout_id ?? null;
  if (previous && previousCheckoutId && (previous.status === "holding" || previous.status === "released")) {
    await releasePreviousCheckout(previousCheckoutId, holdEndedFor(previous));
  }

  const { data: held, error } = await db().rpc("billing_pool_hold_seat", { p_pool_id: pool.id, p_user_id: user.id, p_hold_minutes: HOLD_MINUTES });
  if (error) {
    console.error("[billing-pools] hold_seat failed:", error.message);
    throw new PoolError("Impossible de réserver ta place pour le moment. Réessaie dans un instant.", 500);
  }
  if (held === "already_paid") throw new PoolError("Ton paiement pour ce groupe est déjà confirmé.", 409);
  if (held === "full") throw new PoolError(`Toutes les places de ce groupe sont prises (ou en cours de paiement). Réessaie dans ${HOLD_MINUTES} minutes ou crée ton propre groupe.`, 409);
  if (held !== "held") throw new PoolError("Ce groupe est clôturé : il n'accepte plus de paiement.", 410);

  const plan = PLANS[pool.plan];
  const back = `${appUrl}/dashboard/billing/pool/${pool.invite_code}`;
  let checkout: ChargilyCheckout;
  try {
    checkout = await createChargilyCheckout({
      amount: pool.price_per_member,
      currency: "dzd",
      successUrl: `${back}?status=success`,
      failureUrl: `${back}?status=failure`,
      webhookEndpoint: `${appUrl}/api/chargily/webhook`,
      description: `Med Art AI — ${plan.label} (${pool.size} personnes) — ta part`,
      locale: "fr",
      metadata: { userId: user.id, plan: pool.plan, email: user.email ?? "", kind: "pool_member", poolId: pool.id },
    });
  } catch (creationError) {
    console.error("[billing-pools] checkout creation failed:", creationError instanceof Error ? creationError.message : creationError);
    // No payable checkout exists for this seat: free it so the student can retry right away
    // (instead of waiting on a « confirmation en cours » for a payment that was never opened).
    await releaseHold(pool.id, user.id, previousCheckoutId);
    if (creationError instanceof ChargilyUnavailableError) throw new PoolError(PAYMENT_GATEWAY_UNAVAILABLE_MESSAGE, 503);
    throw new PoolError("Chargily ne répond pas pour le moment : rien n'a été payé. Réessaie dans un instant.", 502);
  }
  // The seat records its payable checkout as a compare-and-set on the one this request settled:
  // if another request (a second tab, another device) attached its own checkout in the meantime,
  // this one is cancelled instead of leaving two payable links for the same seat.
  let attach = db()
    .from("billing_pool_members")
    .update({ chargily_checkout_id: checkout.id, updated_at: new Date().toISOString() })
    .eq("pool_id", pool.id)
    .eq("user_id", user.id)
    .eq("status", "holding");
  attach = previousCheckoutId ? attach.eq("chargily_checkout_id", previousCheckoutId) : attach.is("chargily_checkout_id", null);
  const { data: attached, error: attachError } = await attach.select("id");
  if (attachError || !attached || attached.length === 0) {
    // A seat must always know its payable checkout (that is what prevents double payments):
    // cancel this one instead of handing out a payment link the seat does not record.
    const expired = await expireChargilyCheckout(checkout.id);
    if (!expired.ok && expired.status !== 400) console.error(`[billing-pools] could not expire unrecorded checkout ${checkout.id} (HTTP ${expired.status})`);
    if (attachError) {
      console.error("[billing-pools] attach checkout failed:", attachError.message);
      await releaseHold(pool.id, user.id, previousCheckoutId);
      throw new PoolError("Le paiement n'a pas pu être préparé : rien n'a été payé. Réessaie dans un instant.", 500);
    }
    throw new PoolError("Un autre paiement est déjà en cours pour ta place (autre onglet ou autre appareil ?). Actualise la page avant de réessayer.", 409);
  }
  const { error: payError } = await db()
    .from("payments")
    .insert({ user_id: user.id, plan: pool.plan, amount: pool.price_per_member, currency: "dzd", chargily_checkout_id: checkout.id, status: "pending" });
  if (payError) console.error("[billing-pools] pending payment insert failed:", payError.message);
  return checkout.checkout_url;
}

/**
 * A member who reserved a seat but has not paid frees it. Their open
 * checkout is expired at Chargily first, so they cannot pay after leaving;
 * if it is already being paid, they stay (the payment confirms the seat).
 */
export async function leavePool(code: string, userId: string): Promise<PoolView> {
  await expireOverduePools();
  const pool = await poolByCode(code);
  if (!pool) throw new PoolError("Ce lien d'invitation n'existe pas.", 404);
  const mine = (await membersOf(pool.id)).find((m) => m.user_id === userId) ?? null;
  if (mine && (mine.status === "paid" || mine.status === "activated")) {
    throw new PoolError(
      "Ta part est déjà payée : ta place est confirmée et ne peut plus être libérée. Si le groupe n'est pas complet à temps, tu seras remboursé(e) automatiquement.",
      409
    );
  }
  if (pool.mode === "pooled" && pool.status === "open" && mine?.status === "holding") {
    if (mine.chargily_checkout_id) {
      const outcome = await settleCheckout(mine.chargily_checkout_id, holdEndedFor(mine));
      if (outcome === "paid") {
        throw new PoolError("Ton paiement est en cours de validation chez Chargily : tu ne peux pas quitter maintenant. Actualise la page dans quelques minutes.", 409);
      }
      if (outcome === "unknown") {
        throw new PoolError("Impossible de vérifier ton paiement auprès de Chargily pour le moment. Réessaie dans une minute.", 503);
      }
    }
    const now = new Date().toISOString();
    const { error } = await db().from("billing_pool_members").update({ status: "released", hold_expires_at: null, updated_at: now }).eq("id", mine.id).eq("status", "holding");
    if (error) {
      console.error("[billing-pools] leave failed:", error.message);
      throw new PoolError("Impossible de quitter le groupe pour le moment. Réessaie dans un instant.", 500);
    }
  }
  // Nothing (more) to leave: the view shows where the student stands now.
  return getPoolView(code, userId);
}

/**
 * Records a payment that cannot buy a seat so it is never silently kept:
 * a refund request (processed from /dashboard/admin/refunds), at most once
 * per checkout. Throws on a database failure so the webhook answers 500 and
 * Chargily redelivers the event.
 */
async function recordExtraPaymentRefund(input: {
  userId: string;
  poolId: string | null;
  checkoutId: string;
  amount: number;
  reason: "duplicate_payment" | "orphan_payment";
  note: string;
}): Promise<void> {
  const { data: existing, error: readError } = await db().from("billing_refund_requests").select("id").eq("chargily_checkout_id", input.checkoutId).limit(1);
  if (readError) throw new Error(`refund lookup failed: ${readError.message}`);
  if ((existing ?? []).length > 0) return;
  const row = {
    user_id: input.userId,
    pool_id: input.poolId,
    member_id: null,
    chargily_checkout_id: input.checkoutId,
    amount: input.amount,
    reason: input.reason,
    note: input.note,
  };
  let { error } = await db().from("billing_refund_requests").insert(row);
  if (error?.code === "23514") {
    // The reason check predates supabase/migrations/20261021_group_pool_hardening.sql: keep the refund
    // under a reason it already accepts — the note says what really happened.
    ({ error } = await db().from("billing_refund_requests").insert({ ...row, reason: "pool_overflow" }));
  }
  if (error) throw new Error(`refund request insert failed: ${error.message}`);
  console.warn(`[billing-pools] automatic refund request (${input.reason}) for checkout ${input.checkoutId}`);
}

/** A "duplicate" from billing_pool_mark_paid is either the same payment delivered again, or a SECOND payment of a member whose seat is already paid. */
async function refundIfSecondPayment(poolId: string, userId: string, checkoutId: string, amount: number): Promise<void> {
  const { data, error } = await db().from("billing_pool_members").select("chargily_checkout_id").eq("pool_id", poolId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`member read failed: ${error.message}`);
  const recorded = (data as { chargily_checkout_id: string | null } | null)?.chargily_checkout_id ?? null;
  if (recorded === checkoutId) return; // The same payment delivered again: nothing new.
  await recordExtraPaymentRefund({
    userId,
    poolId,
    checkoutId,
    amount,
    reason: "duplicate_payment",
    note: "Second paiement du même membre pour ce groupe : sa place était déjà payée.",
  });
}

/** Webhook side of a member's payment. */
export async function recordPoolPayment(poolId: string, userId: string, checkoutId: string, amount: number): Promise<void> {
  const { data, error } = await db().rpc("billing_pool_mark_paid", { p_pool_id: poolId, p_user_id: userId, p_checkout_id: checkoutId, p_amount: amount });
  if (error) throw new Error(`billing_pool_mark_paid failed: ${error.message}`);
  if (data === "unknown") {
    await recordExtraPaymentRefund({ userId, poolId: null, checkoutId, amount, reason: "orphan_payment", note: `Paiement reçu pour un groupe introuvable (${poolId}).` });
    return;
  }
  if (data === "duplicate") await refundIfSecondPayment(poolId, userId, checkoutId, amount);
  // Idempotent: activates every paid member once the pool is complete — including
  // after a redelivered event on a completed pool whose activation was interrupted.
  await activateCompletedPool(poolId);
}

/** Webhook side of a Groupe leader's payment: activates the leader and opens the 4 seats. */
export async function createLeaderSeats(userId: string, plan: PlanId, checkoutId: string, email?: string): Promise<void> {
  const { data: existing } = await db().from("billing_pool_members").select("pool_id").eq("chargily_checkout_id", checkoutId).maybeSingle();
  if (existing) return; // redelivered webhook
  // Activated once per payment, even if a retry of this webhook runs after a partial failure.
  const before = await getSubscription(userId);
  const alreadyActivated = before?.chargily_checkout_id === checkoutId;
  if (!alreadyActivated) await activateSubscription({ userId, email, plan, chargilyCheckoutId: checkoutId });
  const sub = await getSubscription(userId);
  const periodEnd = sub?.period_end ?? new Date(Date.now() + PLANS[plan].durationMonths * 30 * 24 * 60 * 60 * 1000).toISOString();
  const cycle = PLANS[plan].cycle ?? "monthly";
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: pool, error } = await db()
      .from("billing_pools")
      .insert({
        kind: "group",
        mode: "leader",
        cycle,
        plan,
        size: GROUP_SIZE,
        price_per_member: PLANS[plan].priceDZD,
        invite_code: newInviteCode(),
        created_by: userId,
        status: "complete",
        expires_at: periodEnd,
        completed_at: new Date().toISOString(),
        period_end: periodEnd,
      })
      .select("id")
      .single();
    if (!error && pool) {
      await db()
        .from("billing_pool_members")
        .insert({ pool_id: (pool as { id: string }).id, user_id: userId, status: "activated", chargily_checkout_id: checkoutId, amount: PLANS[plan].priceDZD * GROUP_SIZE, paid_at: new Date().toISOString(), activated_at: new Date().toISOString() });
      return;
    }
    if ((error as { code?: string } | null)?.code !== "23505") throw new Error(`leader pool insert failed: ${error?.message}`);
  }
}

/** A Groupe member takes one of the leader's seats with the code. */
export async function joinLeaderSeat(code: string, userId: string): Promise<PoolView> {
  const pool = await poolByCode(code);
  if (!pool || pool.mode !== "leader") throw new PoolError("Ce code ne correspond à aucun groupe payé.", 404);
  await assertNoActivePaidPlan(userId, "join");
  const { data, error } = await db().rpc("billing_pool_join_leader", { p_pool_id: pool.id, p_user_id: userId });
  if (error) throw new PoolError("Impossible de rejoindre le groupe pour le moment.", 500);
  if (data === "full") throw new PoolError(`Les ${GROUP_SIZE} places de ce groupe sont déjà prises.`, 409);
  if (data === "closed") throw new PoolError("Ce groupe n'est plus actif.", 410);
  if (data === "joined" && pool.period_end) {
    try {
      await activateSubscription({ userId, plan: pool.plan, chargilyCheckoutId: `seat:${pool.id}`, periodEnd: new Date(pool.period_end) });
    } catch (activationError) {
      // The seat row is written before the account is activated: undo it so « Rejoindre » can simply
      // be retried, instead of a seat that looks taken on an account that is not active.
      if (userId !== pool.created_by) {
        const { error: undoError } = await db().from("billing_pool_members").delete().eq("pool_id", pool.id).eq("user_id", userId).eq("status", "activated");
        if (undoError) console.error("[billing-pools] could not undo a leader seat after a failed activation:", undoError.message);
      }
      throw activationError;
    }
  }
  return buildView(pool, userId, await viewerContext(userId));
}

/** Every pool this student created or belongs to (billing page). Finishes any interrupted activation on the way. */
export async function listMyPools(userId: string): Promise<PoolView[]> {
  await expireOverduePools();
  const { data: memberships } = await db().from("billing_pool_members").select("pool_id").eq("user_id", userId);
  const { data: created } = await db().from("billing_pools").select("id").eq("created_by", userId);
  const ids = Array.from(new Set([...((memberships ?? []) as { pool_id: string }[]).map((m) => m.pool_id), ...((created ?? []) as { id: string }[]).map((p) => p.id)]));
  if (ids.length === 0) return [];
  const { data: pools } = await db().from("billing_pools").select("*").in("id", ids).order("created_at", { ascending: false }).limit(20);
  const rows = (pools ?? []) as PoolRow[];
  for (const pool of rows) {
    if (pool.status === "complete" && pool.mode === "pooled") await activateCompletedPoolSafely(pool.id);
  }
  const ctx = await viewerContext(userId);
  return Promise.all(rows.map((pool) => buildView(pool, userId, ctx)));
}

// ─── Admin (refunds) ─────────────────────────────────────────────────────

/** Platform admins: comma-separated emails in MEDART_ADMIN_EMAILS. */
export function isBillingAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.MEDART_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

export interface RefundRequestView {
  id: string;
  userId: string;
  email: string | null;
  amount: number;
  reason: RefundRow["reason"];
  status: RefundRow["status"];
  createdAt: string;
  refundedAt: string | null;
  refundedBy: string | null;
  note: string | null;
  chargilyCheckoutId: string | null;
  poolCode: string | null;
}

export async function listRefundRequests(status: "pending" | "refunded" | "all"): Promise<RefundRequestView[]> {
  await expireOverduePools();
  let query = db().from("billing_refund_requests").select("*").order("created_at", { ascending: true }).limit(500);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new PoolError("Lecture des remboursements impossible.", 500);
  const rows = (data ?? []) as RefundRow[];
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const poolIds = Array.from(new Set(rows.map((r) => r.pool_id).filter((id): id is string => Boolean(id))));
  const [{ data: subs }, { data: pools }] = await Promise.all([
    userIds.length ? db().from("subscriptions").select("user_id, email").in("user_id", userIds) : Promise.resolve({ data: [] }),
    poolIds.length ? db().from("billing_pools").select("id, invite_code").in("id", poolIds) : Promise.resolve({ data: [] }),
  ]);
  const emailOf = new Map(((subs ?? []) as { user_id: string; email: string | null }[]).map((s) => [s.user_id, s.email]));
  const codeOf = new Map(((pools ?? []) as { id: string; invite_code: string }[]).map((p) => [p.id, p.invite_code]));
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    email: emailOf.get(r.user_id) ?? null,
    amount: r.amount,
    reason: r.reason,
    status: r.status,
    createdAt: r.created_at,
    refundedAt: r.refunded_at,
    refundedBy: r.refunded_by,
    note: r.note,
    chargilyCheckoutId: r.chargily_checkout_id,
    poolCode: r.pool_id ? (codeOf.get(r.pool_id) ?? null) : null,
  }));
}

/** Marks a refund as sent (after the transfer was actually made). */
export async function markRefundSent(id: string, adminEmail: string, note: string | null): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("billing_refund_requests")
    // An empty admin note keeps the automatic one (why the refund was requested).
    .update({ status: "refunded", refunded_at: now, refunded_by: adminEmail, ...(note ? { note } : {}) })
    .eq("id", id)
    .eq("status", "pending")
    .select("member_id")
    .maybeSingle();
  if (error) throw new PoolError("Mise à jour impossible.", 500);
  const memberId = (data as { member_id: string | null } | null)?.member_id;
  if (memberId) await db().from("billing_pool_members").update({ status: "refunded", updated_at: now }).eq("id", memberId);
}
