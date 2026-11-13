/**
 * Supabase — service-role ("admin") client.
 *
 * Where it runs   On the server only: API routes and the server-side modules
 *                 they call.
 * Credentials     SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. This key bypasses
 *                 Row Level Security entirely: the code calling it is the
 *                 only access control, so it must never reach the browser.
 * Exports         isSupabaseConfigured()  are both variables set?
 *                 getSupabaseAdmin()      the process-wide client
 *
 * This file has two parts:
 *   1. The admin client: a lazily created singleton.
 *   2. Its fetch: never cached by Next.js, and retried only when sending the
 *      request again cannot apply anything twice (dead socket, gateway
 *      502/503, 504 on reads).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// 1. Admin client

/**
 * Server-only Supabase client using the service-role key. Never import this
 * from a "use client" component or expose SUPABASE_SERVICE_ROLE_KEY to the
 * browser — it bypasses Row Level Security entirely.
 *
 * Typed loosely (`any` schema) rather than against generated Supabase types —
 * this project doesn't run `supabase gen types` yet. If you add that later,
 * swap the `any`s here for the generated `Database` type.
 */
let client: SupabaseClient<any, any, any> | null = null;

/**
 * Whether the server has both variables the admin client needs
 * (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY). Routes check this first and
 * answer cleanly, instead of letting getSupabaseAdmin() throw.
 *
 * @returns true when both variables are set and non-empty.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * The service-role client, built on the first call and reused for the life
 * of the server instance. It keeps no session and refreshes no token (a
 * service-role key needs neither), and sends every request through
 * fetchWithStaleSocketRetry (part 2 below).
 *
 * @returns The shared admin client. It bypasses Row Level Security.
 * @throws Error when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.
 */
export function getSupabaseAdmin(): SupabaseClient<any, any, any> {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server."
    );
  }

  client = createClient<any, any, any>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Next.js patches the global fetch() to cache requests by default. Without
    // this, a course row read before its sections were generated can get
    // cached and keep serving stale nulls after generation actually succeeds
    // (reproduced live: DB had the data, this admin client kept returning
    // null until the cache was forced to bypass).
    global: { fetch: fetchWithStaleSocketRetry },
  });

  return client;
}

// ---------------------------------------------------------------------------
// 2. Resilient fetch: retries only what is safe to send again

/**
 * Socket-level failures where the request never reached Postgres: a
 * kept-alive connection the far end dropped while this serverless instance
 * was frozen (the same failure class documented on lib/ai/openrouter.ts's
 * createOpenRouterDispatcher), or a connect that never completed.
 * DNS / connect failures (EAI_AGAIN, ENOTFOUND, ETIMEDOUT) belong to the same
 * class: the request never left this instance.
 */
const STALE_SOCKET_CODES = new Set([
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

/**
 * Whether a rejected fetch() is one of those socket-level failures: an Error
 * whose `code` — or whose `cause.code`, where Node's fetch reports the
 * underlying socket error — is in STALE_SOCKET_CODES. An AbortError never
 * is: the caller cancelled.
 *
 * @param error - What fetch() rejected with.
 * @returns true when the request never reached Postgres and can be re-sent.
 */
function isStaleSocketError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  const code = (error as NodeJS.ErrnoException).code ?? (error.cause as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && STALE_SOCKET_CODES.has(code);
}

/**
 * Gateway answers meaning Supabase's API layer could not reach Postgres, so
 * nothing was executed: 502/503 for every method (a cold or restarting
 * project answers 503 "PGRST002 — could not query the schema cache" for a
 * few seconds). 504 only for reads — a write may have run before the
 * gateway gave up waiting.
 *
 * @param status - The HTTP status Supabase answered with.
 * @param method - The request's HTTP method, upper-cased.
 * @returns true when re-sending the request cannot apply anything twice.
 */
function isRetryableGatewayStatus(status: number, method: string): boolean {
  if (status === 502 || status === 503) return true;
  return status === 504 && (method === "GET" || method === "HEAD");
}

/**
 * The wait before each attempt, by attempt index: none before the first,
 * 400 ms before the second, 1200 ms before the third and last. Its length is
 * therefore also the maximum number of attempts.
 */
const RETRY_DELAYS_MS = [0, 400, 1200];

/**
 * The first query after an idle instance thaws can land on a dead pooled
 * socket and fail with "fetch failed", and a project waking up answers 503
 * for its first requests — supabase-js then returns an error, which the
 * quota gates surfaced as "Impossible de vérifier ton quota", while the
 * student's manual retry a second later always worked. These retries do
 * what that manual retry did. Limited to failures where the request was
 * never processed, so a write is never applied twice.
 *
 * Every attempt is sent with `cache: "no-store"` (see the note in
 * getSupabaseAdmin). A caller that aborted its signal is never retried.
 *
 * @param input - The request, as for fetch().
 * @param init - Its options, as for fetch().
 * @returns The first answer that is not a retryable gateway status — or the
 *          last attempt's answer, whatever it is.
 * @throws The fetch() error when it is not a stale-socket failure, or when
 *         no attempt is left.
 */
async function fetchWithStaleSocketRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const noStoreInit = { ...init, cache: "no-store" as const };
  const method = (init?.method ?? "GET").toUpperCase();
  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < RETRY_DELAYS_MS.length - 1 && !init?.signal?.aborted;
    let response: Response;
    try {
      response = await fetch(input, noStoreInit);
    } catch (error) {
      if (!isStaleSocketError(error) || !canRetry) throw error;
      console.warn(`[supabase] Connexion morte (${(error as Error).message}) — nouvel essai ${attempt + 1}`);
      await sleep(RETRY_DELAYS_MS[attempt + 1]);
      continue;
    }
    if (!isRetryableGatewayStatus(response.status, method) || !canRetry) return response;
    console.warn(`[supabase] HTTP ${response.status} de la passerelle — nouvel essai ${attempt + 1}`);
    await response.body?.cancel().catch(() => {});
    await sleep(RETRY_DELAYS_MS[attempt + 1]);
  }
}

/**
 * Waits.
 *
 * @param ms - How long, in milliseconds.
 * @returns A promise resolved once that time has passed.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
