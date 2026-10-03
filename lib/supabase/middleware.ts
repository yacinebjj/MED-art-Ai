import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
 * Upper bound on the Supabase round trip (getUser, which may also refresh
 * the session) before a navigation is let through. Without it, a slow or
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

function redirectToLogin(request: NextRequest, pathname: string) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/login";
  redirectUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(redirectUrl);
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

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const authResult = await Promise.race([
    supabase.auth
      .getUser()
      .then(({ data }) => ({ timedOut: false as const, user: data.user }))
      .catch(() => ({ timedOut: false as const, user: null })),
    new Promise<{ timedOut: true; user: null }>((resolve) => {
      timeoutId = setTimeout(() => resolve({ timedOut: true, user: null }), AUTH_CHECK_TIMEOUT_MS);
    }),
  ]);
  if (timeoutId) clearTimeout(timeoutId);

  if (authResult.timedOut) {
    console.warn(`[middleware] Supabase auth check exceeded ${AUTH_CHECK_TIMEOUT_MS}ms on ${pathname} — continuing without blocking the navigation.`);
    if (isProtected && !hasAuthCookie(request)) return redirectToLogin(request, pathname);
    return NextResponse.next({ request });
  }

  const user = authResult.user;

  if (!user && isProtected) {
    return redirectToLogin(request, pathname);
  }

  if (user && (pathname === "/login" || pathname === "/register" || pathname === "/")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
