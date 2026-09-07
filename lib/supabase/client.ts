import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

/**
 * Browser-side Supabase client, authenticated with the public anon key.
 * Safe to use in "use client" components — this is what powers real
 * sign up / sign in / sign out (see providers/AuthProvider.tsx).
 *
 * Returns the SAME singleton instance on every call, across the whole app.
 * Previously every caller (AuthProvider, LoginForm, RegisterForm, the
 * Settings page, the Studio workspace page) built its own independent
 * client — each one is a full GoTrueClient with its own `autoRefreshToken`
 * background timer. Supabase's refresh tokens are single-use/rotating: two
 * independent timers in the SAME browser tab racing to refresh the SAME
 * cookie is exactly what produced the real, repeated
 * "AuthApiError: Invalid Refresh Token: Already Used" seen in this app's
 * logs — the longer a page stays open (e.g. a multi-minute Studio
 * generation), the wider the window for two timers to collide. That, not a
 * request timeout, is what made getAuthenticatedUser() intermittently see
 * no valid session. One shared client means one refresh timer per tab, so
 * this class of self-inflicted race is now structurally impossible.
 *
 * `autoRefreshToken: false` removes the SECOND actor in this race:
 * middleware.ts's updateSession() already refreshes the session cookie on
 * every single request/navigation (server-side) — that alone is enough to
 * keep the session alive for as long as the tab is actually used. Leaving
 * the browser SDK's own proactive background timer running as well means
 * two independent, uncoordinated processes (the server's per-request
 * refresh and the browser's own timer) can both try to rotate the same
 * single-use refresh token around the same moment; whichever loses gets
 * "Invalid Refresh Token: Already Used", and the browser client then
 * believes the session is dead even though it was simply refreshed
 * elsewhere a moment earlier. Explicit calls like `supabase.auth.getUser()`
 * still refresh on demand when actually needed — only the unattended
 * background timer is disabled.
 */
export function createClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false } }
    );
  }
  return browserClient;
}
