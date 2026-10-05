import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { FREE_TRIAL, PLANS, type PlanId } from "@/lib/pricing";

/**
 * QUOTA ENGINE (monetization v2 — see lib/pricing.ts for the product rules).
 *
 * Every gate is an atomic check-and-increment in Postgres (reserve_* RPCs:
 * `UPDATE … WHERE used < cap RETURNING`), called BEFORE the expensive work;
 * the matching refund only undoes a reservation whose work then FAILED.
 * Deleting a course / exam / summary never gives a unit back.
 *
 * Blocked gates carry a `paywall` reason the client turns into the paywall
 * or limit screen (see lib/quota-response.ts and components/billing/PaywallProvider).
 *
 * Migration safety: until supabase/migrations/20261007_monetization.sql has
 * run, the new columns / RPCs do not exist — detected per request, and the
 * v1 behaviour is used instead of failing every request.
 */

export interface SubscriptionRow {
  user_id: string;
  email: string | null;
  plan: PlanId;
  status: "pending" | "active" | "expired" | "cancelled";
  period_start: string | null;
  period_end: string | null;
  generations_used: number;
  generations_period_start: string | null;
  highlight_messages_used: number;
  chat_messages_used: number;
  flashcards_used: number;
  remediation_used: number;
  daily_chat_messages_used: number;
  daily_chat_reset_at: string | null;
  chargily_checkout_id?: string | null;
  /** v2 counters — absent until the 20261007 migration has run. */
  courses_created_used?: number;
  exams_used?: number;
  syntheses_used?: number;
  audio_used?: number;
  audio_daily_used?: number;
  audio_daily_reset_at?: string | null;
  free_courses_used?: number;
  free_messages_used?: number;
}

export type PaywallReason =
  | "trial_courses"
  | "trial_messages"
  | "trial_feature"
  | "quota_courses"
  | "quota_exams"
  | "quota_syntheses"
  | "quota_audio_daily"
  | "quota_audio_monthly";

export type GateBlocked = { allowed: false; reason: string; paywall?: PaywallReason };
export type GateResult = { allowed: true } | GateBlocked;

const V1_COLUMNS =
  "user_id, email, plan, status, period_start, period_end, generations_used, generations_period_start, highlight_messages_used, chat_messages_used, flashcards_used, remediation_used, daily_chat_messages_used, daily_chat_reset_at, chargily_checkout_id";
const V2_COLUMNS = `${V1_COLUMNS}, courses_created_used, exams_used, syntheses_used, audio_used, audio_daily_used, audio_daily_reset_at, free_courses_used, free_messages_used`;

function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST202" || error.code === "42883" || error.code === "PGRST204" || /does not exist|could not find/i.test(error.message ?? "");
}

/** True once the v2 columns exist on this row. */
function isV2(sub: SubscriptionRow): boolean {
  return typeof sub.free_messages_used === "number";
}

/** Local dev skips quota counting unless MEDART_ENFORCE_QUOTAS_IN_DEV=1 (to test the paywall locally). */
function devBypass(): boolean {
  return process.env.NODE_ENV === "development" && process.env.MEDART_ENFORCE_QUOTAS_IN_DEV !== "1";
}

export async function getSubscription(userId: string): Promise<SubscriptionRow | null> {
  if (!userId || !isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabaseAdmin();
    const v2 = await supabase.from("subscriptions").select(V2_COLUMNS).eq("user_id", userId).maybeSingle();
    if (!v2.error) return (v2.data as SubscriptionRow | null) ?? null;
    if (!isMissingSchema(v2.error)) {
      console.error("Supabase subscriptions lookup failed", v2.error);
      return null;
    }
    const v1 = await supabase.from("subscriptions").select(V1_COLUMNS).eq("user_id", userId).maybeSingle();
    if (v1.error) {
      console.error("Supabase subscriptions lookup failed", v1.error);
      return null;
    }
    return (v1.data as SubscriptionRow | null) ?? null;
  } catch (error) {
    console.error("Supabase subscriptions lookup threw", error);
    return null;
  }
}

/** Every account has a row (the signup trigger creates it); this repairs one that predates it. */
async function ensureSubscriptionRow(userId: string): Promise<SubscriptionRow | null> {
  const existing = await getSubscription(userId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("subscriptions")
    .upsert({ user_id: userId, plan: "freemium", status: "active", period_start: now, generations_period_start: now }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) console.error("Failed to create missing subscription row", error);
  return getSubscription(userId);
}

/** True only for a PAID plan currently within its billing period. */
export function isSubscriptionActive(sub: SubscriptionRow | null): boolean {
  if (!sub || sub.plan === "freemium" || sub.status !== "active" || !sub.period_end) return false;
  return new Date(sub.period_end).getTime() > Date.now();
}

/** The plan that governs quotas RIGHT NOW: a lapsed paid plan is the free tier again. */
export function resolveEffectivePlan(sub: SubscriptionRow | null): PlanId {
  if (!sub || sub.plan === "freemium") return "freemium";
  return isSubscriptionActive(sub) ? sub.plan : "freemium";
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function isStale(start: string | null | undefined, periodMs: number): boolean {
  if (!start) return true;
  return Date.now() - new Date(start).getTime() >= periodMs;
}

/**
 * Lazy monthly rollover of every MONTHLY counter (never the lifetime free_*
 * ones). Cheap and correct without a cron: runs when a gate notices the
 * period is 30 days old.
 */
async function ensureFreshUsagePeriod(userId: string, sub: SubscriptionRow): Promise<SubscriptionRow> {
  if (!isStale(sub.generations_period_start, MONTH_MS)) return sub;
  const now = new Date().toISOString();
  const reset: Partial<SubscriptionRow> = { generations_used: 0, highlight_messages_used: 0, chat_messages_used: 0, flashcards_used: 0, remediation_used: 0 };
  if (isV2(sub)) Object.assign(reset, { courses_created_used: 0, exams_used: 0, syntheses_used: 0, audio_used: 0 });
  const { error } = await getSupabaseAdmin()
    .from("subscriptions")
    .update({ ...reset, generations_period_start: now, updated_at: now })
    .eq("user_id", userId);
  if (error) {
    console.error("Failed to roll over monthly quota period", error);
    return sub;
  }
  return { ...sub, ...reset, generations_period_start: now };
}

async function ensureFreshDay(userId: string, sub: SubscriptionRow, used: "daily_chat_messages_used" | "audio_daily_used", resetAt: "daily_chat_reset_at" | "audio_daily_reset_at"): Promise<SubscriptionRow> {
  if (!isStale(sub[resetAt] ?? null, DAY_MS)) return sub;
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("subscriptions")
    .update({ [used]: 0, [resetAt]: now, updated_at: now })
    .eq("user_id", userId);
  if (error) {
    console.error(`Failed to roll over ${used}`, error);
    return sub;
  }
  return { ...sub, [used]: 0, [resetAt]: now };
}

interface GateUser {
  id: string;
  created_at?: string | null;
}

const NOT_CONFIGURED: GateBlocked = { allowed: false, reason: "La vérification d'abonnement n'est pas configurée sur le serveur." };
const NO_ACCOUNT: GateBlocked = { allowed: false, reason: "Compte introuvable. Reconnecte-toi puis réessaie." };
const CHECK_FAILED: GateBlocked = { allowed: false, reason: "Impossible de vérifier ton quota pour le moment. Réessaie dans un instant." };

/** Loads (or repairs) the row and rolls the month over. null = blocked with `fail`. */
async function loadForGate(user: GateUser): Promise<{ sub: SubscriptionRow } | { fail: GateBlocked }> {
  if (!isSupabaseConfigured()) return { fail: NOT_CONFIGURED };
  if (!user?.id) return { fail: NO_ACCOUNT };
  const raw = await ensureSubscriptionRow(user.id);
  if (!raw) return { fail: CHECK_FAILED };
  return { sub: await ensureFreshUsagePeriod(user.id, raw) };
}

type Counter = "courses_created_used" | "exams_used" | "syntheses_used" | "free_courses_used" | "free_messages_used";

/** Atomic reserve on a v2 counter: true = reserved, false = cap reached, "legacy" = migration not run. */
async function reserveCounter(userId: string, counter: Counter, cap: number): Promise<boolean | "legacy" | "error"> {
  const { data, error } = await getSupabaseAdmin().rpc("reserve_usage_counter", { p_user_id: userId, p_column: counter, p_cap: cap });
  if (error) {
    if (isMissingSchema(error)) return "legacy";
    console.error(`[subscription] reserve_usage_counter(${counter}) failed:`, error.message);
    return "error";
  }
  return data !== null;
}

async function refundCounter(userId: string, counter: Counter): Promise<void> {
  if (!userId || !isSupabaseConfigured()) return;
  const { error } = await getSupabaseAdmin().rpc("refund_usage_counter", { p_user_id: userId, p_column: counter });
  if (error && !isMissingSchema(error)) console.warn(`refund_usage_counter(${counter}) failed:`, error.message);
}

/** Legacy (v1) monthly pools: reserve_<x>_used(p_user_id, p_cap). */
async function reserveLegacy(
  userId: string,
  rpc: "reserve_generations_used" | "reserve_highlight_messages_used" | "reserve_chat_messages_used" | "reserve_remediation_used",
  cap: number,
  exceeded: string
): Promise<GateResult> {
  const { data, error } = await getSupabaseAdmin().rpc(rpc, { p_user_id: userId, p_cap: cap });
  if (error) {
    console.error(`[subscription] ${rpc} failed:`, error.message);
    return CHECK_FAILED;
  }
  return data === null ? { allowed: false, reason: exceeded } : { allowed: true };
}

async function refundLegacy(userId: string, rpc: "refund_generations_used" | "refund_highlight_messages_used" | "refund_chat_messages_used" | "refund_remediation_used"): Promise<void> {
  if (!userId || !isSupabaseConfigured()) return;
  const { error } = await getSupabaseAdmin().rpc(rpc, { p_user_id: userId });
  if (error) console.warn(`${rpc} failed:`, error.message);
}

const TRIAL_FEATURE_REASON = "Cette fonctionnalité fait partie des formules payantes. Choisis ta formule pour la débloquer.";

// ─── Studio generations (fair use) ───────────────────────────────────────

/**
 * Studio generations (sections, Lab, podcast, infographic, Explication…)
 * on a course the student owns. Not a product limit — the product limit is
 * the number of COURSES (reserveCourseCreation) — but a high monthly
 * fair-use ceiling against scripted abuse.
 */
export async function reserveGeneration(user: GateUser): Promise<GateResult> {
  const loaded = await loadForGate(user);
  if ("fail" in loaded) return loaded.fail;
  if (devBypass()) return { allowed: true };
  const plan = PLANS[resolveEffectivePlan(loaded.sub)];
  return reserveLegacy(user.id, "reserve_generations_used", plan.courseCap, "Tu as atteint la limite d'utilisation du Studio pour ce mois-ci. Elle se recharge au début de ton prochain mois d'abonnement.");
}

export async function refundGeneration(userId: string): Promise<void> {
  await refundLegacy(userId, "refund_generations_used");
}

// ─── Courses (the product limit) ─────────────────────────────────────────

/**
 * One unit per course CREATED (upload, pasted text, audio → course).
 * Free trial: 1 course, once. Paid: 40 per month. Deleting a course never
 * gives the unit back; only a creation that fails is refunded.
 */
export async function reserveCourseCreation(user: GateUser): Promise<GateResult> {
  const loaded = await loadForGate(user);
  if ("fail" in loaded) return loaded.fail;
  if (devBypass()) return { allowed: true };
  const sub = loaded.sub;
  if (!isV2(sub)) return { allowed: true };
  const planId = resolveEffectivePlan(sub);
  if (planId === "freemium") {
    const r = await reserveCounter(user.id, "free_courses_used", FREE_TRIAL.courses);
    if (r === "error") return CHECK_FAILED;
    if (r === false) return { allowed: false, paywall: "trial_courses", reason: "Ton cours gratuit est déjà utilisé. Choisis ta formule pour importer d'autres cours." };
    return { allowed: true };
  }
  const cap = PLANS[planId].coursesPerMonth;
  const r = await reserveCounter(user.id, "courses_created_used", cap);
  if (r === "error") return CHECK_FAILED;
  if (r === false) return { allowed: false, paywall: "quota_courses", reason: `Tu as importé tes ${cap} cours de ce mois-ci. Ton compteur se recharge au début de ton prochain mois d'abonnement.` };
  return { allowed: true };
}

/**
 * Read-only pre-check (no reservation) so an upload route can refuse BEFORE
 * spending time on extraction / OCR. The atomic reservation still happens
 * in createStudioCourse.
 */
export async function peekCourseCreation(userId: string): Promise<GateResult> {
  if (devBypass()) return { allowed: true };
  const usage = await getUsageSnapshot(userId);
  if (!usage || !usage.enforced || usage.courses.used < usage.courses.cap) return { allowed: true };
  return usage.isTrial
    ? { allowed: false, paywall: "trial_courses", reason: "Ton cours gratuit est déjà utilisé. Choisis ta formule pour importer d'autres cours." }
    : { allowed: false, paywall: "quota_courses", reason: `Tu as importé tes ${usage.courses.cap} cours de ce mois-ci. Ton compteur se recharge au début de ton prochain mois d'abonnement.` };
}

/** Only when the course could NOT be created (never when it is deleted later). */
export async function refundCourseCreation(userId: string): Promise<void> {
  const sub = await getSubscription(userId);
  if (!sub || !isV2(sub)) return;
  await refundCounter(userId, resolveEffectivePlan(sub) === "freemium" ? "free_courses_used" : "courses_created_used");
}

// ─── Exams & module summaries ────────────────────────────────────────────

/**
 * Paid-only features (exam, module summary): checked at the ENTRY of the
 * route, before any shared cache lookup — otherwise a free account could
 * still be served an exam / summary someone else already generated.
 */
export async function requirePaidPlan(userId: string): Promise<GateResult> {
  if (devBypass()) return { allowed: true };
  const sub = await getSubscription(userId);
  if (!sub || !isV2(sub)) return { allowed: true };
  return resolveEffectivePlan(sub) === "freemium" ? { allowed: false, paywall: "trial_feature", reason: TRIAL_FEATURE_REASON } : { allowed: true };
}

async function reservePaidCounter(user: GateUser, counter: "exams_used" | "syntheses_used", capOf: (planId: PlanId) => number, paywall: PaywallReason, exceeded: (cap: number) => string): Promise<GateResult> {
  const loaded = await loadForGate(user);
  if ("fail" in loaded) return loaded.fail;
  if (devBypass()) return { allowed: true };
  const sub = loaded.sub;
  const planId = resolveEffectivePlan(sub);
  if (!isV2(sub)) {
    // Migration not run yet: the v1 shared generation pool still applies.
    return reserveLegacy(user.id, "reserve_generations_used", PLANS[planId].courseCap, "Tu as atteint la limite de ta formule pour ce mois-ci.");
  }
  if (planId === "freemium") return { allowed: false, paywall: "trial_feature", reason: TRIAL_FEATURE_REASON };
  const cap = capOf(planId);
  const r = await reserveCounter(user.id, counter, cap);
  if (r === "error") return CHECK_FAILED;
  if (r === false) return { allowed: false, paywall, reason: exceeded(cap) };
  return { allowed: true };
}

async function refundPaidCounter(userId: string, counter: "exams_used" | "syntheses_used"): Promise<void> {
  const sub = await getSubscription(userId);
  if (!sub) return;
  if (!isV2(sub)) return refundLegacy(userId, "refund_generations_used");
  await refundCounter(userId, counter);
}

/** One unit per exam actually generated (cache hits are free). 10 per month. */
export async function reserveExam(user: GateUser): Promise<GateResult> {
  return reservePaidCounter(user, "exams_used", (p) => PLANS[p].examsPerMonth, "quota_exams", (cap) => `Tu as utilisé tes ${cap} examens de ce mois-ci. Ils se rechargent au début de ton prochain mois d'abonnement.`);
}

export async function refundExam(userId: string): Promise<void> {
  await refundPaidCounter(userId, "exams_used");
}

/** One unit per module summary generated — Résumé, Mots-clés or Dictionnaire (already-cached results are free). 5 per month. */
export async function reserveSynthesis(user: GateUser): Promise<GateResult> {
  return reservePaidCounter(user, "syntheses_used", (p) => PLANS[p].synthesesPerMonth, "quota_syntheses", (cap) => `Tu as utilisé tes ${cap} résumés de module de ce mois-ci. Ils se rechargent au début de ton prochain mois d'abonnement.`);
}

export async function refundSynthesis(userId: string): Promise<void> {
  await refundPaidCounter(userId, "syntheses_used");
}

// ─── Audio → Smart Notes ─────────────────────────────────────────────────

/** One unit per recorded lecture: 1 per day and 30 per month. */
export async function reserveAudioSession(user: GateUser): Promise<GateResult> {
  const loaded = await loadForGate(user);
  if ("fail" in loaded) return loaded.fail;
  if (devBypass()) return { allowed: true };
  let sub = loaded.sub;
  if (!isV2(sub)) return { allowed: true };
  const planId = resolveEffectivePlan(sub);
  if (planId === "freemium") return { allowed: false, paywall: "trial_feature", reason: TRIAL_FEATURE_REASON };
  sub = await ensureFreshDay(user.id, sub, "audio_daily_used", "audio_daily_reset_at");
  const plan = PLANS[planId];
  const { data, error } = await getSupabaseAdmin().rpc("reserve_audio_session", { p_user_id: user.id, p_daily_cap: plan.audioPerDay, p_monthly_cap: plan.audioPerMonth });
  if (error) {
    if (isMissingSchema(error)) return { allowed: true };
    console.error("[subscription] reserve_audio_session failed:", error.message);
    return CHECK_FAILED;
  }
  if (data !== null) return { allowed: true };
  if ((sub.audio_used ?? 0) >= plan.audioPerMonth) {
    return { allowed: false, paywall: "quota_audio_monthly", reason: `Tu as utilisé tes ${plan.audioPerMonth} audios de ce mois-ci. Ils se rechargent au début de ton prochain mois d'abonnement.` };
  }
  return { allowed: false, paywall: "quota_audio_daily", reason: `Tu as déjà transformé ${plan.audioPerDay} audio aujourd'hui. Reviens demain pour le suivant.` };
}

/**
 * Counts a recorded lecture ONCE, however many chunks it has: the first
 * chunk of a new upload id reserves the audio unit, later chunks (and
 * retries) of the same lecture are free.
 */
export async function claimAudioSession(user: GateUser, uploadId: string): Promise<GateResult> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("audio_quota_sessions").insert({ user_id: user.id, upload_id: uploadId });
  if (error) {
    if (error.code === "23505") return { allowed: true }; // same lecture, already counted
    if (isMissingSchema(error) || error.code === "42P01" || error.code === "PGRST205") return { allowed: true }; // migration not run yet
    console.error("[subscription] audio_quota_sessions insert failed:", error.message);
    return CHECK_FAILED;
  }
  const gate = await reserveAudioSession(user);
  if (!gate.allowed) await supabase.from("audio_quota_sessions").delete().eq("user_id", user.id).eq("upload_id", uploadId);
  return gate;
}

export async function refundAudioSession(userId: string): Promise<void> {
  if (!userId || !isSupabaseConfigured()) return;
  const { error } = await getSupabaseAdmin().rpc("refund_audio_session", { p_user_id: userId });
  if (error && !isMissingSchema(error)) console.warn("refund_audio_session failed:", error.message);
}

// ─── MedArt Assistant & Copilot ──────────────────────────────────────────

const DAILY_PREMIUM_MESSAGES = 20;

export type AssistantTurnGate = { allowed: true; premium: boolean } | GateBlocked;

/**
 * One assistant / copilot message.
 *  - Free trial: 20 messages for the life of the account, then paywall.
 *  - Paid: 20 per day on the premium model; past that the reply is still
 *    served, silently, by the free model (`premium: false`) — never blocked.
 */
export async function reserveAssistantTurn(user: GateUser): Promise<AssistantTurnGate> {
  const loaded = await loadForGate(user);
  if ("fail" in loaded) return loaded.fail;
  if (devBypass()) return { allowed: true, premium: true };
  let sub = loaded.sub;
  const planId = resolveEffectivePlan(sub);
  if (planId === "freemium" && isV2(sub)) {
    const r = await reserveCounter(user.id, "free_messages_used", FREE_TRIAL.messages);
    if (r === "error") return CHECK_FAILED;
    if (r === false) {
      return { allowed: false, paywall: "trial_messages", reason: `Tes ${FREE_TRIAL.messages} messages gratuits sont utilisés. Choisis ta formule pour continuer à discuter avec MedArt.` };
    }
    return { allowed: true, premium: true };
  }
  sub = await ensureFreshDay(user.id, sub, "daily_chat_messages_used", "daily_chat_reset_at");
  const { data, error } = await getSupabaseAdmin().rpc("reserve_daily_chat_messages_used", { p_user_id: user.id, p_cap: DAILY_PREMIUM_MESSAGES });
  if (error) {
    console.error("[subscription] reserve_daily_chat_messages_used failed:", error.message);
    // Paid account: never block a message over a counter hiccup — just use the free model.
    return { allowed: true, premium: false };
  }
  return { allowed: true, premium: data !== null };
}

/** Back-compat shim for callers that only need "premium model or not". */
export async function reserveChatMessageDaily(user: GateUser): Promise<GateResult> {
  const turn = await reserveAssistantTurn(user);
  if (!turn.allowed) return turn;
  return turn.premium ? { allowed: true } : { allowed: false, reason: "Messages premium du jour utilisés." };
}

/** Selection pool ("Ask MedArt" / translate): fair use, per month. */
export async function reserveHighlightMessage(user: GateUser): Promise<GateResult> {
  const loaded = await loadForGate(user);
  if ("fail" in loaded) return loaded.fail;
  if (devBypass()) return { allowed: true };
  const plan = PLANS[resolveEffectivePlan(loaded.sub)];
  return reserveLegacy(user.id, "reserve_highlight_messages_used", plan.highlightMessageCap, "Tu as atteint la limite de messages « sélection » de ce mois-ci.");
}

/** Selection pool only — for callers that did not reserve an assistant message (To-Do sub-task suggestions). */
export async function refundHighlightPool(userId: string): Promise<void> {
  await refundLegacy(userId, "refund_highlight_messages_used");
}

export async function refundHighlightMessage(userId: string): Promise<void> {
  await refundLegacy(userId, "refund_highlight_messages_used");
  await refundFreeMessageIfTrial(userId);
}

/** Legacy monthly chat pool — effectively unlimited now (paid chat is limited per day, free per lifetime). */
export async function reserveChatMessage(user: GateUser): Promise<GateResult> {
  const loaded = await loadForGate(user);
  if ("fail" in loaded) return loaded.fail;
  if (devBypass()) return { allowed: true };
  const plan = PLANS[resolveEffectivePlan(loaded.sub)];
  return reserveLegacy(user.id, "reserve_chat_messages_used", plan.chatMessageCap, "Tu as atteint la limite de messages de ce mois-ci.");
}

export async function refundChatMessage(userId: string): Promise<void> {
  await refundLegacy(userId, "refund_chat_messages_used");
  await refundFreeMessageIfTrial(userId);
}

/** A reply that failed must not cost the free trial one of its 20 messages. */
async function refundFreeMessageIfTrial(userId: string): Promise<void> {
  const sub = await getSubscription(userId);
  if (sub && isV2(sub) && resolveEffectivePlan(sub) === "freemium") await refundCounter(userId, "free_messages_used");
}

export async function reserveRemediation(user: GateUser): Promise<GateResult> {
  const loaded = await loadForGate(user);
  if ("fail" in loaded) return loaded.fail;
  if (devBypass()) return { allowed: true };
  const plan = PLANS[resolveEffectivePlan(loaded.sub)];
  if (plan.remediationCap === 0) return { allowed: false, paywall: "trial_feature", reason: TRIAL_FEATURE_REASON };
  return reserveLegacy(user.id, "reserve_remediation_used", plan.remediationCap, `Tu as atteint la limite de ${plan.remediationCap} plans de remédiation ce mois-ci.`);
}

export async function refundRemediation(userId: string): Promise<void> {
  await refundLegacy(userId, "refund_remediation_used");
}

// ─── Usage snapshot (for the UI) ─────────────────────────────────────────

export interface UsageSnapshot {
  planId: PlanId;
  isTrial: boolean;
  /** Free trial fully used (course AND messages): the app is locked behind the paywall. */
  trialExhausted: boolean;
  periodEnd: string | null;
  /** When the monthly counters next reset. */
  monthResetsAt: string | null;
  courses: { used: number; cap: number; lifetime: boolean };
  messages: { used: number; cap: number; perDay: boolean };
  exams: { used: number; cap: number };
  syntheses: { used: number; cap: number };
  audio: { usedToday: number; capPerDay: number; usedThisMonth: number; capPerMonth: number };
  /** False until the 20261007 migration has run. */
  enforced: boolean;
}

export async function getUsageSnapshot(userId: string): Promise<UsageSnapshot | null> {
  const raw = await getSubscription(userId);
  if (!raw) return null;
  const planId = resolveEffectivePlan(raw);
  const plan = PLANS[planId];
  const isTrial = planId === "freemium";
  const monthStale = isStale(raw.generations_period_start, MONTH_MS);
  const dayStale = isStale(raw.daily_chat_reset_at, DAY_MS);
  const audioDayStale = isStale(raw.audio_daily_reset_at ?? null, DAY_MS);
  const monthly = (n: number | undefined) => (monthStale ? 0 : (n ?? 0));
  const freeCourses = raw.free_courses_used ?? 0;
  const freeMessages = raw.free_messages_used ?? 0;
  return {
    planId,
    isTrial,
    trialExhausted: isTrial && isV2(raw) && freeCourses >= FREE_TRIAL.courses && freeMessages >= FREE_TRIAL.messages,
    periodEnd: isTrial ? null : raw.period_end,
    monthResetsAt: raw.generations_period_start && !monthStale ? new Date(new Date(raw.generations_period_start).getTime() + MONTH_MS).toISOString() : null,
    courses: isTrial ? { used: freeCourses, cap: FREE_TRIAL.courses, lifetime: true } : { used: monthly(raw.courses_created_used), cap: plan.coursesPerMonth, lifetime: false },
    messages: isTrial
      ? { used: freeMessages, cap: FREE_TRIAL.messages, perDay: false }
      : { used: dayStale ? 0 : raw.daily_chat_messages_used, cap: plan.premiumMessagesPerDay, perDay: true },
    exams: { used: monthly(raw.exams_used), cap: plan.examsPerMonth },
    syntheses: { used: monthly(raw.syntheses_used), cap: plan.synthesesPerMonth },
    audio: { usedToday: audioDayStale ? 0 : (raw.audio_daily_used ?? 0), capPerDay: plan.audioPerDay, usedThisMonth: monthly(raw.audio_used), capPerMonth: plan.audioPerMonth },
    enforced: isV2(raw),
  };
}

// ─── Activation ──────────────────────────────────────────────────────────

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Activates (or renews) a paid plan — called only from the verified
 * Chargily webhook, or for a pooled purchase / group seat that just
 * completed. A renewal while still active EXTENDS the current period
 * instead of discarding the days left. `periodEnd` forces the end date
 * (a Groupe member joining a leader's seats shares the leader's period).
 */
export async function activateSubscription(params: { userId: string; email?: string; plan: PlanId; chargilyCheckoutId: string; periodEnd?: Date }): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error("Supabase n'est pas configuré — impossible d'activer l'abonnement.");
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const plan = PLANS[params.plan];
  const current = await getSubscription(params.userId);
  // Idempotent per payment: a webhook retry after a partial failure never extends the period twice.
  if (current?.chargily_checkout_id && current.chargily_checkout_id === params.chargilyCheckoutId) return;
  const currentEnd = current && isSubscriptionActive(current) && current.period_end ? new Date(current.period_end) : null;
  const periodEnd = params.periodEnd ?? addMonths(currentEnd && currentEnd > now ? currentEnd : now, plan.durationMonths);

  const base = {
    user_id: params.userId,
    ...(params.email ? { email: params.email } : {}),
    plan: params.plan,
    status: "active",
    period_start: currentEnd ? current?.period_start ?? now.toISOString() : now.toISOString(),
    period_end: periodEnd.toISOString(),
    chargily_checkout_id: params.chargilyCheckoutId,
    updated_at: now.toISOString(),
  };
  // A NEW subscription starts a fresh monthly window; a renewal keeps the running one.
  const freshCounters = currentEnd
    ? {}
    : { generations_used: 0, generations_period_start: now.toISOString(), highlight_messages_used: 0, chat_messages_used: 0, flashcards_used: 0, remediation_used: 0 };
  const freshV2 = currentEnd ? {} : { courses_created_used: 0, exams_used: 0, syntheses_used: 0, audio_used: 0 };

  let { error } = await supabase.from("subscriptions").upsert({ ...base, ...freshCounters, ...freshV2 }, { onConflict: "user_id" });
  if (error && isMissingSchema(error)) {
    ({ error } = await supabase.from("subscriptions").upsert({ ...base, ...freshCounters }, { onConflict: "user_id" }));
  }
  if (error) {
    console.error("Failed to activate subscription", error);
    throw error;
  }
}
