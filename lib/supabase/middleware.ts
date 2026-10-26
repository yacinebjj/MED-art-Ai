import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { EXPIRED_COOKIE, isDeadSessionError, isSessionCookieName } from "@/lib/supabase/dead-session";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

// "/study" lives outside /dashboard (its own full-page layout, no
// Sidebar/Topbar chrome) but needs the exact same auth gate — it used to
// rely solely on "nobody will type this URL directly," which isn't a real
// guard: its data routes (app/api/srs/*) were always server-gated, but the
// page itself rendered for anyone who hit the URL.
const PROTECTED_PREFIXES = ["/dashboard", "/study"];

/**
 * Upper bound on the Supabase round trip (getSession refreshing an expired
 * access token) before a navigation is let through. Without it, a slow or
 * stalled connection — the norm for an installed PWA resumed on a mobile
 * network — left every client-side navigation waiting on this call with no
 * limit: the UI stayed on the old page until a manual reload.
 */
const AUTH_CHECK_TIMEOUT_MS = 2500;

/**
 * A request made by the client-side ROUTER (soft navigation or <Link>
 * prefetch), as opposed to a full document load.
 *
 * Next.js 14 deletes its own flight headers (RSC, Next-Router-Prefetch,
 * Next-Router-State-Tree) and the _rsc query before middleware runs
 * (next/dist/server/web/adapter.js), so they cannot be used here. The
 * browser-set Fetch Metadata header can: router requests are fetch() calls
 * (`Sec-Fetch-Dest: empty`), a real page load is `document`. Browsers
 * without Fetch Metadata simply take the full (bounded) check below.
 */
function isClientRouterRequest(request: NextRequest): boolean {
  return request.headers.get("sec-fetch-dest") === "empty" || request.headers.get("purpose") === "prefetch";
}

/** A Supabase session cookie is present (`sb-<project>-auth-token`, possibly chunked `.0`, `.1`…). No network involved. */
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"));
}

/**
 * `sessionResponse` carries what getSession() just wrote: when the refresh
 * token was dead it deleted the session cookie, and dropping that deletion
 * here sent the dead cookie on to /login, which then failed on it again.
 */
function redirectToLogin(request: NextRequest, pathname: string, sessionResponse?: NextResponse) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/login";
  redirectUrl.searchParams.set("next", pathname);
  const redirect = NextResponse.redirect(redirectUrl);
  sessionResponse?.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

/**
 * Supabase Auth itself says the cookie's session is gone for good
 * (lib/supabase/dead-session.ts). A slow or failed check is NOT dead: the
 * cookie keeps its word, as with getSession() alone.
 */
async function isDeadSession(supabase: SupabaseClient): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const dead = await Promise.race([
    supabase.auth
      .getUser()
      .then(({ error }) => error !== null && isDeadSessionError(error))
      .catch(() => false),
    new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), AUTH_CHECK_TIMEOUT_MS);
    }),
  ]);
  if (timeoutId) clearTimeout(timeoutId);
  return dead;
}

/**
 * Refreshes the Supabase auth cookie on full page loads (required so session
 * tokens don't silently expire) and redirects unauthenticated visitors away
 * from /dashboard/**. Called from the root middleware.ts.
 *
 * Navigation-safety rules (the installed-app "frozen until F5" bug):
 *  - CLIENT-ROUTER requests (soft navigations and <Link> prefetches) never
 *    call Supabase. The Sidebar alone prefetches ~15 routes; each one used to
 *    run getUser(), and right after the app resumes with an expired access
 *    token they ALL raced to refresh with the same single-use refresh token
 *    ("Invalid Refresh Token: Already Used" — the same race already
 *    documented for /api/** in middleware.ts). The losers saw no user, were
 *    redirected to /login, and could clear the session cookies mid-flight;
 *    on a slow network each click also waited on that round trip with no
 *    limit. Router requests now only get the instant cookie check. The
 *    session is still refreshed by full page loads, by the browser Supabase
 *    client (providers/AuthProvider), and by every API route.
 *  - Full page loads get a BOUNDED auth check (AUTH_CHECK_TIMEOUT_MS). When
 *    it times out and a session cookie exists, the page loads anyway: this
 *    redirect is a UX gate, while every /api/** route enforces auth itself
 *    (getAuthenticatedUser), so no data is exposed by letting it through.
 */
export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (isClientRouterRequest(request)) {
    if (isProtected && !hasAuthCookie(request)) return redirectToLogin(request, pathname);
    return NextResponse.next({ request });
  }

  // No session cookie: nobody to verify. Public pages (landing, login,
  // register) answer immediately instead of waiting on a Supabase round
  // trip that can only answer "no user".
  if (!hasAuthCookie(request)) {
    if (isProtected) return redirectToLogin(request, pathname);
    return NextResponse.next({ request });
  }

  // The installed app always launches on "/" (manifest start_url). With a
  // session cookie, go straight to /dashboard: verifying here as well meant
  // two serial auth checks (up to 2 × AUTH_CHECK_TIMEOUT_MS) before the
  // first byte of every launch. /dashboard's own load runs the check below
  // and still sends a stale session to /login.
  if (pathname === "/") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getSession(), not getUser(): it reads the session from the cookie and
  // only goes to the network when the access token has expired (to refresh
  // it — which is what keeps the cookie fresh). getUser() asked Supabase Auth
  // on EVERY full page load, the main cost of each app launch on a mobile
  // network. That's enough here because this redirect is a UX gate only:
  // every /api/** route still verifies the user itself (getAuthenticatedUser),
  // so no data is ever served on the strength of this check.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const authResult = await Promise.race([
    supabase.auth
      .getSession()
      .then(({ data }) => ({ timedOut: false as const, signedIn: data.session !== null }))
      .catch(() => ({ timedOut: false as const, signedIn: false })),
    new Promise<{ timedOut: true; signedIn: false }>((resolve) => {
      timeoutId = setTimeout(() => resolve({ timedOut: true, signedIn: false }), AUTH_CHECK_TIMEOUT_MS);
    }),
  ]);
  if (timeoutId) clearTimeout(timeoutId);

  if (authResult.timedOut) {
    console.warn(`[middleware] Supabase auth check exceeded ${AUTH_CHECK_TIMEOUT_MS}ms on ${pathname} — continuing without blocking the navigation.`);
    if (isProtected && !hasAuthCookie(request)) return redirectToLogin(request, pathname);
    return NextResponse.next({ request });
  }

  if (!authResult.signedIn && isProtected) {
    return redirectToLogin(request, pathname, supabaseResponse);
  }

  if (authResult.signedIn && (pathname === "/login" || pathname === "/register")) {
    // getSession() only read the cookie. Before sending this visitor away
    // from the sign-in and sign-up forms, ask Auth whether the session still
    // exists: a deleted account's cookie keeps reading as a session for up
    // to an hour, and bouncing it to /dashboard — where every request fails —
    // locked that browser out of both forms. One round trip, only here, only
    // with a session cookie (a signed-in student rarely loads these pages).
    if (await isDeadSession(supabase)) {
      request.cookies.getAll().forEach(({ name }) => {
        if (isSessionCookieName(name)) supabaseResponse.cookies.set(name, "", EXPIRED_COOKIE);
      });
      return supabaseResponse;
    }
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    // Carry over any session cookies getSession() just refreshed: dropping
    // them made the /dashboard load right after this redirect refresh
    // again with the already-consumed refresh token.
    const redirect = NextResponse.redirect(redirectUrl);
    supabaseResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return supabaseResponse;
}
