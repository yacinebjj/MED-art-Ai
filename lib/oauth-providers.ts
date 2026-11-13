/**
 * The one-tap sign-in providers MedArt offers next to e-mail
 * (components/auth/SocialAuthButtons.tsx). Each is switched on in Supabase →
 * Authentication → Providers; which ones are is read from Auth's PUBLIC
 * settings endpoint (/auth/v1/settings, with the anon key — public by design,
 * already shipped to every browser). So a button appears once its provider
 * is enabled in Supabase, with no redeploy — and never before: a disabled
 * provider answers a click with a raw JSON error page.
 *
 * Any failure reads as "none": e-mail and password always work.
 */

export type OAuthProviderId = "google" | "apple";

export const OAUTH_PROVIDERS: readonly OAuthProviderId[] = ["google", "apple"];

const SETTINGS_PATH = "/auth/v1/settings";
/** The auth pages are regenerated in the background at most this often (ISR): no student ever waits on this call. */
const SERVER_REVALIDATE_S = 300;
const SERVER_TIMEOUT_MS = 3000;
const CLIENT_TIMEOUT_MS = 6000;
const CACHE_KEY = "medart:oauth-providers";
const CACHE_MS = 10 * 60 * 1000;

/** The providers Auth's settings answer has switched on, in OAUTH_PROVIDERS order. */
export function enabledProvidersFrom(settings: unknown): OAuthProviderId[] {
  const external = (settings as { external?: Record<string, unknown> } | null)?.external;
  if (!external || typeof external !== "object") return [];
  return OAUTH_PROVIDERS.filter((id) => external[id] === true);
}

function settingsEndpoint(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url: `${url.replace(/\/+$/, "")}${SETTINGS_PATH}`, key } : null;
}

/**
 * Server side, for the (auth) layout: the list is baked into the page's HTML,
 * so the buttons are there on the first paint — nothing pops in and pushes
 * the e-mail field down under the student's thumb. Cached by Next's fetch
 * cache and refreshed every SERVER_REVALIDATE_S in the background; bounded
 * in time; never throws.
 */
export async function loadEnabledOAuthProviders(): Promise<OAuthProviderId[]> {
  const endpoint = settingsEndpoint();
  if (!endpoint) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      fetch(endpoint.url, { headers: { apikey: endpoint.key }, next: { revalidate: SERVER_REVALIDATE_S } }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SERVER_TIMEOUT_MS);
      }),
    ]);
    if (!res || !res.ok) return [];
    return enabledProvidersFrom(await res.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Client: the last answer this browser session, if fresh. */
export function cachedEnabledOAuthProviders(): OAuthProviderId[] | null {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "null") as { at?: unknown; providers?: unknown } | null;
    if (cached && typeof cached.at === "number" && Date.now() - cached.at < CACHE_MS && Array.isArray(cached.providers)) {
      return enabledProvidersFrom({ external: Object.fromEntries(cached.providers.map((id) => [String(id), true])) });
    }
  } catch {
    // Storage blocked or garbled: just ask again.
  }
  return null;
}

/**
 * Client: ask Supabase now (`fresh` skips this session's cache — the owner's
 * `?sso=preview` check right after switching a provider on). `null` when it
 * couldn't tell: a failed check must never hide buttons the page already has.
 */
export async function fetchEnabledOAuthProviders({ fresh = false }: { fresh?: boolean } = {}): Promise<OAuthProviderId[] | null> {
  if (!fresh) {
    const cached = cachedEnabledOAuthProviders();
    if (cached) return cached;
  }
  const endpoint = settingsEndpoint();
  if (!endpoint) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint.url, { headers: { apikey: endpoint.key }, signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    const providers = enabledProvidersFrom(await res.json());
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), providers }));
    } catch {
      // Storage blocked: it is asked again next time, that's all.
    }
    return providers;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
