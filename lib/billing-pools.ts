import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { createChargilyCheckout } from "@/lib/chargily";
import { GROUP_SIZE, PLANS, POOL_DEADLINE_DAYS, PROMO_SIZE, SEAT_HOLD_MINUTES, type BillingCycle, type PlanId } from "@/lib/pricing";
import { activateSubscription, getSubscription, isSubscriptionActive } from "@/lib/subscription";

/**
 * POOLED PURCHASES (monetization v2) — server side of the Promo (exactly
 * 15, 700 DA, 1 month) and Groupe (exactly 5) plans.
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

interface RefundRow {
  id: string;
  user_id: string;
  pool_id: string | null;
  amount: number;
  reason: "pool_expired" | "pool_overflow";
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
 * finishes the job without activating anyone twice.
 */
export async function activateCompletedPool(poolId: string): Promise<void> {
  const { data: pool } = await db().from("billing_pools").select("*").eq("id", poolId).maybeSingle();
  const row = pool as PoolRow | null;
  if (!row || row.status !== "complete" || row.mode !== "pooled") return;
  const members = (await membersOf(poolId)).filter((m) => m.status === "paid");
  for (const member of members) {
    await activateSubscription({ userId: member.user_id, plan: row.plan, chargilyCheckoutId: member.chargily_checkout_id ?? `pool:${poolId}` });
    await db().from("billing_pool_members").update({ status: "activated", activated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", member.id).eq("status", "paid");
  }
}

async function buildView(pool: PoolRow, userId: string): Promise<PoolView> {
  const members = await membersOf(pool.id);
  const confirmed = members.filter((m) => (pool.mode === "pooled" ? m.status === "paid" || m.status === "activated" : m.status === "activated")).length;
  const mine = members.find((m) => m.user_id === userId) ?? null;
  let refund: PoolView["me"]["refund"] = null;
  if (mine && (mine.status === "refund_pending" || mine.status === "refunded")) {
    const { data } = await db().from("billing_refund_requests").select("status, created_at, refunded_at, amount").eq("member_id", mine.id).maybeSingle();
    const r = data as Pick<RefundRow, "status" | "created_at" | "refunded_at" | "amount"> | null;
    if (r) refund = { status: r.status, createdAt: r.created_at, refundedAt: r.refunded_at, amount: r.amount };
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
    me: { status: mine?.status ?? null, refund },
  };
}

/** Tracker read: applies overdue expiry and finishes any interrupted activation first. */
export async function getPoolView(code: string, userId: string): Promise<PoolView> {
  await expireOverduePools();
  const pool = await poolByCode(code);
  if (!pool) throw new PoolError("Ce lien d'invitation n'existe pas. Vérifie-le auprès de la personne qui te l'a envoyé.", 404);
  if (pool.status === "complete" && pool.mode === "pooled") await activateCompletedPool(pool.id);
  return buildView(pool, userId);
}

async function assertNoActivePaidPlan(userId: string): Promise<void> {
  const sub = await getSubscription(userId);
  if (sub && isSubscriptionActive(sub) && sub.period_end) {
    const end = new Date(sub.period_end).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    throw new PoolError(`Tu as déjà un abonnement actif jusqu'au ${end}. Tu pourras rejoindre un groupe à la fin de celui-ci.`, 409);
  }
}

/** A student can wait on only one open pooled purchase at a time. */
async function openMembershipOf(userId: string): Promise<PoolRow | null> {
  const { data } = await db().from("billing_pool_members").select("pool_id, status").eq("user_id", userId).in("status", ["holding", "paid"]);
  const ids = ((data ?? []) as { pool_id: string; status: string }[]).map((m) => m.pool_id);
  if (ids.length === 0) return null;
  const { data: pools } = await db().from("billing_pools").select("*").in("id", ids).eq("status", "open");
  const open = ((pools ?? []) as PoolRow[]).filter((p) => new Date(p.expires_at).getTime() > Date.now());
  return open[0] ?? null;
}

/** Creates a pooled Groupe de 10 (tier id "promo", 10 seats) or Groupe de 5, any cycle, and returns its invite code. */
export async function createPooledPurchase(userId: string, kind: PoolKind, cycle: BillingCycle): Promise<string> {
  if (!(await billingPoolsAvailable())) throw new PoolError("Les formules Groupe arrivent dans quelques instants — réessaie un peu plus tard.", 503);
  await expireOverduePools();
  await assertNoActivePaidPlan(userId);
  // Groupe de 10 (tier id "promo") is sold for every duration.
  const existing = await openMembershipOf(userId);
  if (existing) {
    if (existing.kind === kind && existing.cycle === cycle) return existing.invite_code;
    throw new PoolError("Tu participes déjà à un groupe en cours. Termine-le (ou attends sa clôture) avant d'en créer un autre.", 409);
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
    if ((error as { code?: string }).code !== "23505") {
      console.error("[billing-pools] create failed:", error.message);
      throw new PoolError("Impossible de créer le groupe pour le moment. Réessaie dans un instant.", 500);
    }
  }
  throw new PoolError("Impossible de créer le groupe pour le moment. Réessaie dans un instant.", 500);
}

/** Holds a seat, then opens the Chargily checkout for this member's share. */
export async function startPoolCheckout(code: string, user: { id: string; email?: string | null }, appUrl: string): Promise<string> {
  await expireOverduePools();
  const pool = await poolByCode(code);
  if (!pool) throw new PoolError("Ce lien d'invitation n'existe pas.", 404);
  if (pool.mode !== "pooled") throw new PoolError("Ce groupe a déjà été payé par son chef : utilise « Rejoindre » avec le code.", 400);
  await assertNoActivePaidPlan(user.id);
  const other = await openMembershipOf(user.id);
  if (other && other.id !== pool.id) throw new PoolError("Tu participes déjà à un autre groupe en cours.", 409);

  const { data: held, error } = await db().rpc("billing_pool_hold_seat", { p_pool_id: pool.id, p_user_id: user.id, p_hold_minutes: HOLD_MINUTES });
  if (error) {
    console.error("[billing-pools] hold_seat failed:", error.message);
    throw new PoolError("Impossible de réserver ta place pour le moment. Réessaie dans un instant.", 500);
  }
  if (held === "already_paid") throw new PoolError("Ton paiement pour ce groupe est déjà confirmé.", 409);
  if (held === "full") throw new PoolError("Toutes les places de ce groupe sont prises (ou en cours de paiement). Réessaie dans 30 minutes ou crée ton propre groupe.", 409);
  if (held !== "held") throw new PoolError("Ce groupe est clôturé : il n'accepte plus de paiement.", 410);

  const plan = PLANS[pool.plan];
  const back = `${appUrl}/dashboard/billing/pool/${pool.invite_code}`;
  const checkout = await createChargilyCheckout({
    amount: pool.price_per_member,
    currency: "dzd",
    successUrl: `${back}?status=success`,
    failureUrl: `${back}?status=failure`,
    webhookEndpoint: `${appUrl}/api/chargily/webhook`,
    description: `Med Art AI — ${plan.label} (${pool.size} personnes) — ta part`,
    locale: "fr",
    metadata: { userId: user.id, plan: pool.plan, email: user.email ?? "", kind: "pool_member", poolId: pool.id },
  });
  await db().rpc("billing_pool_attach_checkout", { p_pool_id: pool.id, p_user_id: user.id, p_checkout_id: checkout.id });
  const { error: payError } = await db()
    .from("payments")
    .insert({ user_id: user.id, plan: pool.plan, amount: pool.price_per_member, currency: "dzd", chargily_checkout_id: checkout.id, status: "pending" });
  if (payError) console.error("[billing-pools] pending payment insert failed:", payError.message);
  return checkout.checkout_url;
}

/** Webhook side of a member's payment. */
export async function recordPoolPayment(poolId: string, userId: string, checkoutId: string, amount: number): Promise<void> {
  const { data, error } = await db().rpc("billing_pool_mark_paid", { p_pool_id: poolId, p_user_id: userId, p_checkout_id: checkoutId, p_amount: amount });
  if (error) throw new Error(`billing_pool_mark_paid failed: ${error.message}`);
  if (data === "complete") await activateCompletedPool(poolId);
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
  await assertNoActivePaidPlan(userId);
  const { data, error } = await db().rpc("billing_pool_join_leader", { p_pool_id: pool.id, p_user_id: userId });
  if (error) throw new PoolError("Impossible de rejoindre le groupe pour le moment.", 500);
  if (data === "full") throw new PoolError(`Les ${GROUP_SIZE} places de ce groupe sont déjà prises.`, 409);
  if (data === "closed") throw new PoolError("Ce groupe n'est plus actif.", 410);
  if (data === "joined" && pool.period_end) {
    await activateSubscription({ userId, plan: pool.plan, chargilyCheckoutId: `seat:${pool.id}`, periodEnd: new Date(pool.period_end) });
  }
  return buildView(pool, userId);
}

/** Every pool this student created or belongs to (billing page). */
export async function listMyPools(userId: string): Promise<PoolView[]> {
  await expireOverduePools();
  const { data: memberships } = await db().from("billing_pool_members").select("pool_id").eq("user_id", userId);
  const { data: created } = await db().from("billing_pools").select("id").eq("created_by", userId);
  const ids = Array.from(new Set([...((memberships ?? []) as { pool_id: string }[]).map((m) => m.pool_id), ...((created ?? []) as { id: string }[]).map((p) => p.id)]));
  if (ids.length === 0) return [];
  const { data: pools } = await db().from("billing_pools").select("*").in("id", ids).order("created_at", { ascending: false }).limit(20);
  return Promise.all(((pools ?? []) as PoolRow[]).map((pool) => buildView(pool, userId)));
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
    .update({ status: "refunded", refunded_at: now, refunded_by: adminEmail, note })
    .eq("id", id)
    .eq("status", "pending")
    .select("member_id")
    .maybeSingle();
  if (error) throw new PoolError("Mise à jour impossible.", 500);
  const memberId = (data as { member_id: string | null } | null)?.member_id;
  if (memberId) await db().from("billing_pool_members").update({ status: "refunded", updated_at: now }).eq("id", memberId);
}
