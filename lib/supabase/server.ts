import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

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

// Socket-level failures where the request never reached Postgres: a
// kept-alive connection the far end dropped while this serverless instance
// was frozen (the same failure class documented on lib/ai/openrouter.ts's
// createOpenRouterDispatcher), or a connect that never completed.
// DNS / connect failures (EAI_AGAIN, ENOTFOUND, ETIMEDOUT) belong to the same
// class: the request never left this instance.
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
 */
function isRetryableGatewayStatus(status: number, method: string): boolean {
  if (status === 502 || status === 503) return true;
  return status === 504 && (method === "GET" || method === "HEAD");
}

const RETRY_DELAYS_MS = [0, 400, 1200];

/**
 * The first query after an idle instance thaws can land on a dead pooled
 * socket and fail with "fetch failed", and a project waking up answers 503
 * for its first requests — supabase-js then returns an error, which the
 * quota gates surfaced as "Impossible de vérifier ton quota", while the
 * student's manual retry a second later always worked. These retries do
 * what that manual retry did. Limited to failures where the request was
 * never processed, so a write is never applied twice.
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
