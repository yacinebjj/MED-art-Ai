import { isAuthSessionMissingError } from "@supabase/supabase-js";

/**
 * Supabase Auth answers meaning the session in a browser's cookie is gone for
 * good — no retry or refresh can bring it back (all seen in the server logs):
 *  - user_not_found ("User from sub claim in JWT does not exist"): the account
 *    was deleted while this browser was signed in to it. The cookie still
 *    parses as a session until its access token expires (up to an hour), and
 *    supabase-js keeps it, unlike the two cases below;
 *  - session_not_found / "Auth session missing!": signed out — from this
 *    device, "everywhere" (Paramètres) — or no usable session in the cookie;
 *  - refresh_token_not_found: the session's refresh token no longer exists.
 * A live session never gets these, so acting on them can't sign anyone out.
 * Shared by middleware.ts (Edge) and session-server.ts (Node): keep it pure.
 */
const DEAD_SESSION_CODES = new Set(["user_not_found", "session_not_found", "refresh_token_not_found"]);

export function isDeadSessionError(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && DEAD_SESSION_CODES.has(code);
}

/**
 * The session cookie itself (`sb-<project>-auth-token`, or its `.0`, `.1`…
 * chunks) — never the PKCE `-code-verifier` cookie that a pending
 * confirmation or password-reset link still needs.
 */
export function isSessionCookieName(name: string): boolean {
  return /^sb-.+-auth-token(\.\d+)?$/.test(name);
}

/** Cookie options that delete a cookie written by @supabase/ssr (path "/", host-only). */
export const EXPIRED_COOKIE = { path: "/", maxAge: 0 };
