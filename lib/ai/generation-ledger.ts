/**
 * AI GENERATION LEDGER — one content-addressed, single-flight memory for every
 * paid model call whose output is a pure function of its input.
 *
 * Why this exists. The per-feature caches (studio_content_cache,
 * lab_course_cache, flashcards_content_cache, ...) each cover ONE feature, ONE
 * default variant, and none of them stops two identical requests that are in
 * flight at the same time (two tabs, a double tap, a client retry, two students
 * opening the same new polycopié). Every one of those paid twice. This ledger
 * sits UNDER the features, at the level of "this exact request to this exact
 * model", so it covers every variant and every concurrent duplicate at once.
 *
 * How a call resolves (`runThroughLedger`):
 *   1. Same process, same key already running → join that promise (0 tokens).
 *   2. Ledger row `ready` → return the stored output (0 tokens).
 *   3. Another instance holds a live lease on the key → wait for its result,
 *      up to `peerWaitMs` (0 tokens if it lands in time).
 *   4. Otherwise claim the lease, call the model ONCE, store, release.
 *
 * Correctness by construction. The key is a sha256 of EVERYTHING the model
 * sees (model id, every message, every output-shaping option — see
 * `modelCallKey`). Two requests share an output only when the model would have
 * received byte-identical input, so a prompt edit, a different course, another
 * language or a custom instruction is automatically a different key. Nothing
 * about prompts, models or medical content changes — only how often the same
 * work is paid for.
 *
 * Only VALIDATED results are stored: the producer passed to runThroughLedger
 * must include the caller's own parsing/validation and throw on a bad output,
 * so a truncated or malformed answer can never be memorized and replayed.
 *
 * BILLING RULE (non-negotiable): the ledger only ever lowers OUR model-provider
 * bill. It knows nothing about student quotas and must never be used to skip,
 * discount or refund one — every route reserves the student's standard unit
 * BEFORE calling into the ledger, whatever it then resolves to.
 *
 * Use it ONLY where a repeated identical request is supposed to get the same
 * answer. Never for "regenerate / give me a different version" actions, exam
 * variations, case-simulator turns, or chat.
 *
 * Fail-open everywhere: no Supabase, table not created yet, any read/write
 * error → the call simply goes to the model as before (step 1 still applies).
 * The ledger can only ever save money, never block a student. Table:
 * supabase/migrations/20261008_ai_generation_ledger.sql.
 */

import { createHash } from "crypto";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

const TABLE = "ai_generation_ledger";

/** Bump to orphan every stored row at once if the stored value format ever changes. */
const LEDGER_FORMAT = 1;

const DEFAULT_TTL_DAYS = 180;
/** How long a claimed lease tells peers "I am generating this, wait for me" — refreshed by nobody, so it must cover the slowest real generation. */
const DEFAULT_LEASE_MS = 5 * 60_000;
const PEER_POLL_INTERVAL_MS = 1_500;
/** Values above this are returned but not stored (a ledger row is not a blob store). */
const MAX_STORED_CHARS = 1_500_000;
/** After a "table missing" error, stop round-tripping to Supabase for this long. */
const DISABLED_BACKOFF_MS = 10 * 60_000;

export interface LedgerSpec {
  /** Feature bucket, for logs and cleanup, e.g. "explication-part". Part of the key. */
  namespace: string;
  /**
   * Everything that determines the output. Usually `modelCallKey(messages, options)`.
   * For per-student work, include the user id here so rows are never shared across accounts.
   */
  key: unknown;
  /** Row lifetime. Prompt edits already change the key, so this is storage hygiene, not freshness. */
  ttlDays?: number;
  /**
   * How long to wait for ANOTHER instance that is already generating the same
   * key before paying for it ourselves. Keep it well inside the route's own
   * maxDuration minus the generation's own timeout. 0 = never wait.
   */
  peerWaitMs?: number;
  /** How long our own claim protects the key from peers (≥ the producer's real worst case). */
  leaseMs?: number;
  /** Re-check a stored value before trusting it (e.g. a schema that tightened since it was stored). */
  isValid?: (value: unknown) => boolean;
  /**
   * What to do after waiting `peerWaitMs` on another instance's live lease
   * without getting its result. "produce" (default): generate ourselves.
   * "fail": throw LedgerBusyError instead — for long, expensive jobs (podcast
   * narration) whose route has no time left to generate after waiting, and
   * where paying twice for the same output is never worth it.
   */
  onPeerTimeout?: "produce" | "fail";
}

/** Thrown (onPeerTimeout: "fail") when an identical generation is still running elsewhere. Callers map it to a retryable error. */
export class LedgerBusyError extends Error {
  constructor(readonly namespace: string) {
    super("Une génération identique est déjà en cours. Réessaie dans un instant : le résultat sera prêt.");
  }
}

interface LedgerRow {
  status: "pending" | "ready";
  value: unknown;
  lease_until: string | null;
  expires_at: string | null;
}

const inflight = new Map<string, Promise<unknown>>();
let disabledUntil = 0;

// ─── keys ─────────────────────────────────────────────────────────────────

/** JSON with object keys sorted at every depth, so key order never changes a hash. */
function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function ledgerKey(namespace: string, material: unknown): string {
  return createHash("sha256").update(`v${LEDGER_FORMAT}|${namespace}|${stableStringify(material)}`, "utf8").digest("hex");
}

/**
 * The output-determining part of a callOpenRouter request: model, messages and
 * every option that changes WHAT is generated. Transport options (timeouts,
 * provider sort, mock bypass) are deliberately left out — they change where
 * and how fast the same model runs, not what it is asked.
 */
export function modelCallKey(
  messages: unknown,
  options: {
    model: string;
    maxTokens?: number;
    temperature?: number;
    reasoning?: unknown;
    responseFormat?: unknown;
  }
): unknown {
  return {
    model: options.model,
    messages,
    maxTokens: options.maxTokens ?? null,
    temperature: options.temperature ?? null,
    reasoning: options.reasoning ?? null,
    responseFormat: options.responseFormat ?? null,
  };
}

// ─── storage (every function fail-open) ───────────────────────────────────

function ledgerUsable(): boolean {
  return isSupabaseConfigured() && Date.now() >= disabledUntil;
}

function noteError(where: string, error: { code?: string; message?: string } | null | undefined): void {
  if (!error) return;
  const missing = error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202" || /does not exist|schema cache/i.test(error.message ?? "");
  if (missing) {
    disabledUntil = Date.now() + DISABLED_BACKOFF_MS;
    console.warn(`[ai-ledger] Table ${TABLE} absente — ledger désactivé ${DISABLED_BACKOFF_MS / 60_000} min (lancer supabase/migrations/20261008_ai_generation_ledger.sql).`);
    return;
  }
  console.error(`[ai-ledger:${where}] ${error.message ?? "erreur inconnue"} — fail-open.`);
}

async function readRow(key: string): Promise<LedgerRow | null> {
  try {
    const { data, error } = await getSupabaseAdmin().from(TABLE).select("status, value, lease_until, expires_at").eq("key", key).maybeSingle<LedgerRow>();
    if (error) {
      noteError("read", error);
      return null;
    }
    return data ?? null;
  } catch (error) {
    console.error("[ai-ledger:read] exception — fail-open:", error instanceof Error ? error.message : error);
    return null;
  }
}

function isExpired(row: LedgerRow): boolean {
  return row.expires_at !== null && new Date(row.expires_at).getTime() <= Date.now();
}

function leaseLive(row: LedgerRow): boolean {
  return row.status === "pending" && row.lease_until !== null && new Date(row.lease_until).getTime() > Date.now();
}

/** Inserts a pending row, or takes over a dead lease / stale row. True only if THIS call now owns the key. */
async function claimLease(key: string, spec: LedgerSpec, current: LedgerRow | null): Promise<boolean> {
  const leaseUntil = new Date(Date.now() + (spec.leaseMs ?? DEFAULT_LEASE_MS)).toISOString();
  try {
    const supabase = getSupabaseAdmin();
    if (!current) {
      const { data, error } = await supabase
        .from(TABLE)
        .upsert({ key, namespace: spec.namespace, status: "pending", value: null, lease_until: leaseUntil }, { onConflict: "key", ignoreDuplicates: true })
        .select("key");
      if (error) {
        noteError("claim", error);
        return false;
      }
      return (data?.length ?? 0) > 0;
    }
    // Dead lease (its owner crashed or timed out) or a stale/invalid ready row:
    // conditional update, so two instances racing for the takeover can't both win.
    const nowIso = new Date().toISOString();
    let query = supabase.from(TABLE).update({ status: "pending", lease_until: leaseUntil, updated_at: nowIso }).eq("key", key);
    query = current.status === "pending" ? query.eq("status", "pending").lt("lease_until", nowIso) : query.eq("status", "ready");
    const { data, error } = await query.select("key");
    if (error) {
      noteError("takeover", error);
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (error) {
    console.error("[ai-ledger:claim] exception — fail-open:", error instanceof Error ? error.message : error);
    return false;
  }
}

async function storeValue(key: string, spec: LedgerSpec, value: unknown): Promise<void> {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > MAX_STORED_CHARS) {
      await releaseLease(key);
      return;
    }
    const expiresAt = new Date(Date.now() + (spec.ttlDays ?? DEFAULT_TTL_DAYS) * 86_400_000).toISOString();
    const { error } = await getSupabaseAdmin()
      .from(TABLE)
      .upsert(
        { key, namespace: spec.namespace, status: "ready", value, lease_until: null, expires_at: expiresAt, output_chars: serialized.length, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
    if (error) noteError("store", error);
    // Opportunistic hygiene — no cron needed: roughly one store in 200 sweeps expired rows.
    if (Math.random() < 0.005) void sweepExpired();
  } catch (error) {
    console.error("[ai-ledger:store] exception — fail-open:", error instanceof Error ? error.message : error);
  }
}

/** Frees a claimed key after a failed generation, so peers stop waiting and generate themselves. */
async function releaseLease(key: string): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin().from(TABLE).delete().eq("key", key).eq("status", "pending");
    if (error) noteError("release", error);
  } catch {
    // The lease simply expires on its own.
  }
}

async function recordHit(key: string): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin().rpc("ai_ledger_record_hit", { p_key: key });
    if (error && error.code !== "PGRST202") noteError("hit", error);
  } catch {
    // Hit counters are observability only.
  }
}

async function sweepExpired(): Promise<void> {
  try {
    await getSupabaseAdmin().from(TABLE).delete().lt("expires_at", new Date().toISOString());
  } catch {
    // Next sweep will try again.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls a peer's lease. Resolves with its stored value, or `undefined` if it failed, vanished or took longer than we can wait. */
async function waitForPeer(key: string, spec: LedgerSpec, row: LedgerRow): Promise<{ value: unknown } | undefined> {
  const leaseEnd = row.lease_until ? new Date(row.lease_until).getTime() : 0;
  const deadline = Math.min(Date.now() + (spec.peerWaitMs ?? 0), leaseEnd);
  while (Date.now() < deadline) {
    await sleep(Math.min(PEER_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    const current = await readRow(key);
    if (!current || !ledgerUsable()) return undefined;
    if (current.status === "ready" && !isExpired(current) && (!spec.isValid || spec.isValid(current.value))) return { value: current.value };
    if (!leaseLive(current)) return undefined;
  }
  return undefined;
}

// ─── public API ───────────────────────────────────────────────────────────

async function resolveThroughLedger<T>(key: string, spec: LedgerSpec, produce: () => Promise<T>): Promise<T> {
  if (!ledgerUsable()) return produce();

  const row = await readRow(key);
  if (row?.status === "ready" && !isExpired(row) && (!spec.isValid || spec.isValid(row.value))) {
    console.log(`[ai-ledger] HIT ${spec.namespace} ${key.slice(0, 10)} — 0 token.`);
    void recordHit(key);
    return row.value as T;
  }

  let owns = false;
  let waitedOnPeer = false;
  if (row && leaseLive(row)) {
    waitedOnPeer = true;
    const peer = await waitForPeer(key, spec, row);
    if (peer) {
      console.log(`[ai-ledger] PEER ${spec.namespace} ${key.slice(0, 10)} — résultat d'une autre instance, 0 token.`);
      void recordHit(key);
      return peer.value as T;
    }
  } else if (ledgerUsable()) {
    owns = await claimLease(key, spec, row);
    if (!owns && !row) {
      // Lost the insert race: someone claimed it between our read and our insert.
      const raced = await readRow(key);
      if (raced?.status === "ready" && !isExpired(raced)) {
        void recordHit(key);
        return raced.value as T;
      }
      if (raced && leaseLive(raced)) {
        waitedOnPeer = true;
        const peer = await waitForPeer(key, spec, raced);
        if (peer) {
          void recordHit(key);
          return peer.value as T;
        }
      }
    }
  }

  if (waitedOnPeer && spec.onPeerTimeout === "fail") throw new LedgerBusyError(spec.namespace);

  let value: T;
  try {
    value = await produce();
  } catch (error) {
    if (owns) await releaseLease(key);
    throw error;
  }
  if (ledgerUsable()) await storeValue(key, spec, value);
  return value;
}

/**
 * Runs `produce` (the paid model call + the caller's own parsing/validation)
 * at most once per distinct key across concurrent callers, instances and
 * time. See the file header for the resolution order and the safety rules.
 */
export function runThroughLedger<T>(spec: LedgerSpec, produce: () => Promise<T>): Promise<T> {
  const key = ledgerKey(spec.namespace, spec.key);
  const running = inflight.get(key);
  if (running) {
    console.log(`[ai-ledger] JOIN ${spec.namespace} ${key.slice(0, 10)} — requête identique déjà en cours, 0 token.`);
    return running as Promise<T>;
  }
  const promise = resolveThroughLedger(key, spec, produce).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
