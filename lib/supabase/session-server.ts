import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

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

function authCookieFingerprint(cookieStore: ReturnType<typeof cookies>): string | null {
  const authCookies = cookieStore.getAll().filter((c) => c.name.startsWith("sb-"));
  if (authCookies.length === 0) return null;
  return authCookies
    .map((c) => `${c.name}=${c.value}`)
    .sort()
    .join("&");
}

export async function getAuthenticatedUser(): Promise<User | null> {
  const fingerprint = authCookieFingerprint(cookies());
  if (!fingerprint) {
    console.log("[auth] Aucun cookie sb- présent sur la requête — pas de session à vérifier.");
    return null;
  }

  const shortId = fingerprint.slice(0, 24);
  const existing = inFlightByCookieFingerprint.get(fingerprint);
  if (existing) {
    console.log(`[auth] Requête concurrente détectée pour le cookie ${shortId}... — réutilisation de la vérification déjà en cours (pas de second appel Supabase).`);
    return existing;
  }

  const check = (async () => {
    const supabase = createSessionClient();
    const { data, error } = await supabase.auth.getUser();
    if (!error) return data.user;

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
    return await check;
  } finally {
    inFlightByCookieFingerprint.delete(fingerprint);
  }
}
