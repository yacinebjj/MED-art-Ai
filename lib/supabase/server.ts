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
const STALE_SOCKET_CODES = new Set(["UND_ERR_SOCKET", "UND_ERR_CLOSED", "ECONNRESET", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED"]);

function isStaleSocketError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  const code = (error as NodeJS.ErrnoException).code ?? (error.cause as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && STALE_SOCKET_CODES.has(code);
}

/**
 * The first query after an idle instance thaws can land on a dead pooled
 * socket and fail with "fetch failed" — supabase-js then returns an error,
 * which the quota gates surfaced as "Impossible de vérifier ton quota",
 * while the student's manual retry (a fresh socket) always worked. One
 * immediate retry does what that manual retry did. Limited to socket errors
 * where the request was never processed, so a write is never applied twice.
 */
async function fetchWithStaleSocketRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const noStoreInit = { ...init, cache: "no-store" as const };
  try {
    return await fetch(input, noStoreInit);
  } catch (error) {
    if (!isStaleSocketError(error) || init?.signal?.aborted) throw error;
    console.warn("[supabase] Connexion réutilisée morte — nouvel essai immédiat:", (error as Error).message);
    return fetch(input, noStoreInit);
  }
}
