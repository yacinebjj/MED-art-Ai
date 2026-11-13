/**
 * Supabase — the signed-in user, for server code.
 *
 * Where it runs   On the server, inside a request: API route handlers (and
 *                 Server Components, which can read cookies but not write them).
 * Credentials     The public anon key plus the request's own session cookie:
 *                 Supabase Auth is asked whom that cookie belongs to.
 * Exports         getAuthenticatedUser()  the user, device limit enforced —
 *                                         what API routes call
 *                 getSessionUser()        the user, without the device limit
 *
 * Why this is more than one getUser() call (each point is explained where it
 * lives below):
 *   - concurrent requests carrying the same session cookie share ONE Supabase
 *     round trip;
 *   - a successful check is remembered for 30 seconds;
 *   - a session Supabase declares dead gets its cookie deleted;
 *   - any other failure is retried once.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { checkDevice } from "@/lib/devices";
import { EXPIRED_COOKIE, isDeadSessionError, isSessionCookieName } from "@/lib/supabase/dead-session";

// ---------------------------------------------------------------------------
// Session client: the anon key + this request's cookies

/** A cookie as @supabase/ssr hands it to the cookie adapter's setAll(). */
interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

/**
 * A Supabase client bound to THIS request: it reads the session from the
 * request's cookies and, when Supabase refreshes that session, writes the new
 * cookies back — where the context allows writing (route handlers). Anywhere
 * else the write throws and is ignored: the middleware keeps the cookie fresh.
 *
 * @returns A new anon-key client for the current request.
 */
function createSessionClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // middleware.ts already refreshes the session cookie on every
            // request — a failure to re-set it here is never fatal.
          }
        },
      },
    }
  );
}

// ---------------------------------------------------------------------------
// One check per session at a time, remembered briefly

/**
 * Confirmed from real server logs: `/api/upload` and `/api/studio/generate`
 * 401ing at the same moment, immediately followed by
 * `AuthApiError: Invalid Refresh Token: Already Used`, then EVERY subsequent
 * request 401ing until reload. Root cause — two genuinely concurrent
 * requests (a second tab, a background /api/subscription poll, a click on
 * another Studio tile before the first one resolves) each independently
 * calling supabase.auth.getUser() with the SAME stale refresh-token cookie.
 * Supabase rotates refresh tokens on use (single-use): the first one to
 * reach the auth server wins and gets a new token pair; the other's own
 * refresh attempt, using the now-already-consumed token, hard-fails —
 * that's the permanent lockout, not a rare flicker a plain retry can fix
 * (retrying with a token that's already dead just fails again, which is
 * exactly the uniform ~340ms 401 bursts seen in the logs).
 *
 * Fix: coalesce concurrent checks. Two requests carrying the EXACT SAME
 * session cookie value are, for all practical purposes, the same browser
 * tab/session firing overlapping calls — routing them through ONE shared
 * Supabase round trip means there is only ever one refresh attempt in
 * flight for that session at a time, so this class of self-inflicted race
 * becomes structurally impossible. Keyed by the raw cookie value (never by
 * anything derived from a completed lookup), so a request carrying a
 * DIFFERENT cookie — a different user, or this same user after a real,
 * later rotation — always gets its own independent, uncached check; no
 * result is ever shared across two different sessions.
 */
const inFlightByCookieFingerprint = new Map<string, Promise<User | null>>();

/**
 * Successful checks are remembered briefly, per exact cookie value. On
 * app open the browser fires ~10 API calls within a few seconds; a warm
 * instance now answers the later ones without another Supabase Auth round
 * trip. Same isolation as the coalescing above (keyed by the raw cookie, so
 * a refreshed or different session never matches), only successes are
 * cached, and the TTL is far below the access token's own lifetime.
 */
const VERIFIED_TTL_MS = 30_000;
/** Size limit of that memory — rememberVerified() says what happens when it is reached. */
const VERIFIED_MAX_ENTRIES = 500;
/** Verified sessions by cookie fingerprint, each with the moment its entry expires. */
const verifiedByCookieFingerprint = new Map<string, { user: User; expiresAt: number }>();

/**
 * Remembers a successful check for VERIFIED_TTL_MS. When the memory is full
 * (VERIFIED_MAX_ENTRIES), expired entries are dropped first; if it is still
 * full after that, it is emptied — every session is simply checked again.
 *
 * @param fingerprint - The request's session-cookie fingerprint.
 * @param user - The user Supabase Auth just confirmed for it.
 */
function rememberVerified(fingerprint: string, user: User): void {
  if (verifiedByCookieFingerprint.size >= VERIFIED_MAX_ENTRIES) {
    const now = Date.now();
    verifiedByCookieFingerprint.forEach((entry, key) => {
      if (entry.expiresAt <= now) verifiedByCookieFingerprint.delete(key);
    });
    if (verifiedByCookieFingerprint.size >= VERIFIED_MAX_ENTRIES) verifiedByCookieFingerprint.clear();
  }
  verifiedByCookieFingerprint.set(fingerprint, { user, expiresAt: Date.now() + VERIFIED_TTL_MS });
}

// ---------------------------------------------------------------------------
// Cookie helpers

/**
 * Deletes this request's session cookie (never the PKCE code verifier — see
 * lib/supabase/dead-session.ts) so the browser stops presenting a dead
 * session. Takes effect from route handlers; a Server Component can't set
 * cookies, so there it's a no-op. Returns how many cookies were deleted.
 *
 * @returns The number of session cookies deleted (0 where cookies are read-only).
 */
function deleteSessionCookies(): number {
  const cookieStore = cookies();
  let deleted = 0;
  for (const { name } of cookieStore.getAll()) {
    if (!isSessionCookieName(name)) continue;
    try {
      cookieStore.set(name, "", EXPIRED_COOKIE);
      deleted++;
    } catch {
      return deleted;
    }
  }
  return deleted;
}

/**
 * A request's session, as one string: every Supabase cookie (name starting
 * with `sb-`) written `name=value`, sorted, joined with "&". Two requests get
 * the same fingerprint only when they carry exactly the same Supabase cookies.
 *
 * @param cookieStore - The request's cookies (next/headers).
 * @returns The fingerprint, or null when the request has no Supabase cookie.
 */
function authCookieFingerprint(cookieStore: ReturnType<typeof cookies>): string | null {
  const authCookies = cookieStore.getAll().filter((c) => c.name.startsWith("sb-"));
  if (authCookies.length === 0) return null;
  return authCookies
    .map((c) => `${c.name}=${c.value}`)
    .sort()
    .join("&");
}

// ---------------------------------------------------------------------------
// Public API

/**
 * The signed-in user, or null — what every /api/** route calls. Also
 * enforces the 2-device limit (lib/devices.ts): a device beyond it is
 * treated as signed out (401) by every route, and DeviceGuard shows it the
 * device-limit screen. Use getSessionUser() only for the routes that must
 * work from such a device (listing / replacing devices, signing out).
 *
 * @returns The verified user; null when signed out or on a device past the limit.
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  const user = await getSessionUser();
  if (!user) return null;
  if ((await checkDevice(user.id)) === "limit") {
    console.warn(`[auth] Limite d'appareils atteinte pour ${user.id} — requête refusée.`);
    return null;
  }
  return user;
}

/**
 * Session check only, WITHOUT the device limit — see getAuthenticatedUser.
 *
 * In order:
 *  1. no Supabase cookie on the request → null, nothing is asked;
 *  2. this exact cookie was verified less than VERIFIED_TTL_MS ago → that user;
 *  3. a check of this exact cookie is already running → its result is shared;
 *  4. otherwise Supabase Auth is asked (getUser). A dead session has its
 *     cookie deleted and is not retried; any other failure is retried once,
 *     300 ms later, with a fresh client.
 * Only a success is remembered (for step 2).
 *
 * @returns The verified user, or null when the request has no valid session.
 */
export async function getSessionUser(): Promise<User | null> {
  const fingerprint = authCookieFingerprint(cookies());
  if (!fingerprint) {
    console.log("[auth] Aucun cookie sb- présent sur la requête — pas de session à vérifier.");
    return null;
  }

  const shortId = fingerprint.slice(0, 24);
  const cached = verifiedByCookieFingerprint.get(fingerprint);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  const existing = inFlightByCookieFingerprint.get(fingerprint);
  if (existing) {
    console.log(`[auth] Requête concurrente détectée pour le cookie ${shortId}... — réutilisation de la vérification déjà en cours (pas de second appel Supabase).`);
    return existing;
  }

  const check = (async () => {
    const supabase = createSessionClient();
    const { data, error } = await supabase.auth.getUser();
    if (!error) return data.user;

    // A dead session (deleted account, signed out elsewhere, vanished refresh
    // token) can't come back: no retry, and its cookie goes, or every request
    // from that browser kept failing on it — twice, logged — for up to an hour.
    if (isDeadSessionError(error)) {
      if (deleteSessionCookies() > 0) {
        console.warn(`[auth] Session morte pour ${shortId}... (${(error as { code?: string }).code ?? error.message}) — cookie de session effacé, requête rejetée avec 401.`);
      }
      return null;
    }

    console.error(`[auth] Premier getUser() échoué pour ${shortId}... :`, error.message, `(code: ${(error as { code?: string }).code ?? "?"})`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const retrySupabase = createSessionClient();
    const retry = await retrySupabase.auth.getUser();
    if (retry.error) {
      console.error(`[auth] Retry ÉGALEMENT échoué pour ${shortId}... :`, retry.error.message, `(code: ${(retry.error as { code?: string }).code ?? "?"}) — la requête sera rejetée avec 401.`);
      return null;
    }
    console.log(`[auth] Retry réussi pour ${shortId}... — session récupérée après le premier échec.`);
    return retry.data.user;
  })();

  inFlightByCookieFingerprint.set(fingerprint, check);
  try {
    const user = await check;
    if (user) rememberVerified(fingerprint, user);
    return user;
  } finally {
    inFlightByCookieFingerprint.delete(fingerprint);
  }
}
