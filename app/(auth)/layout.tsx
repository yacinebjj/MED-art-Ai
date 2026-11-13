import { AuthShell } from "@/components/auth/AuthShell";
import { loadEnabledOAuthProviders } from "@/lib/oauth-providers";

/**
 * Shared, persistent layout for /login, /register and /forgot-password: the
 * shell (background, logo, tabs, card frame) mounts once, so moving between
 * these pages is a smooth client transition instead of a full re-render.
 *
 * The Google/Apple providers enabled in Supabase are read here, on the
 * server (cached, refreshed every 5 minutes in the background — the pages
 * stay static), so their buttons are in the HTML from the first paint.
 */
export default async function AuthGroupLayout({ children }: { children: React.ReactNode }) {
  const oauthProviders = await loadEnabledOAuthProviders();
  return <AuthShell oauthProviders={oauthProviders}>{children}</AuthShell>;
}
