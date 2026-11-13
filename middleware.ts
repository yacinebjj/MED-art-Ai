import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { AUDIO_SMART_NOTES_API, AUDIO_SMART_NOTES_ENABLED, AUDIO_SMART_NOTES_PAGE, INFOGRAPHIC_API, INFOGRAPHIC_ENABLED } from "@/lib/feature-flags";
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, DEVICE_ID_RE } from "@/lib/device-cookie";

/** A Supabase Auth PKCE code. */
const AUTH_CODE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Withdrawn features (lib/feature-flags.ts). The API branch returns before
  // any Supabase call, so it never joins the refresh-token race described below.
  if (pathname.startsWith(AUDIO_SMART_NOTES_API)) {
    if (AUDIO_SMART_NOTES_ENABLED) return NextResponse.next();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (pathname.startsWith(INFOGRAPHIC_API)) {
    if (INFOGRAPHIC_ENABLED) return NextResponse.next();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!AUDIO_SMART_NOTES_ENABLED && pathname.startsWith(AUDIO_SMART_NOTES_PAGE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Supabase Auth falls back to the Site URL (/?code=…) when a sign-in's redirect isn't on its allow list:
  // finish the Google/Apple/e-mail sign-in at /auth/callback instead of leaving the student logged out on
  // the landing page. Only a Supabase auth code (a UUID) is taken — no other `code` parameter.
  if (pathname === "/" && AUTH_CODE_RE.test(request.nextUrl.searchParams.get("code") ?? "")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    return NextResponse.redirect(url);
  }

  const response = await updateSession(request);
  return withDeviceCookie(request, response);
}

/**
 * Every browser gets its device id on its first page load (lib/devices.ts,
 * 2-device limit) — BEFORE the app fires its parallel startup API calls,
 * so they all carry the same id instead of each minting their own.
 */
function withDeviceCookie(request: NextRequest, response: NextResponse): NextResponse {
  const existing = request.cookies.get(DEVICE_COOKIE)?.value;
  if (existing && DEVICE_ID_RE.test(existing)) return response;
  response.cookies.set(DEVICE_COOKIE, crypto.randomUUID(), DEVICE_COOKIE_OPTIONS);
  return response;
}

export const config = {
  matcher: [
    /*
     * Run on every PAGE load except static assets, so the auth cookie stays
     * fresh across navigations — the redirect-to-/login logic in
     * updateSession only actually triggers for /dashboard/** and /study.
     *
     * Deliberately excludes /api/** : every API route already does its own
     * auth check via getAuthenticatedUser() (lib/supabase/session-server.ts),
     * which refreshes the session itself when needed. Having middleware ALSO
     * refresh on every API call was a second, un-deduplicated refresh path
     * racing against the route handler's own — confirmed live in this app's
     * logs as the cause of "Invalid Refresh Token: Already Used" (two
     * concurrent requests each independently rotating the same single-use
     * token). Middleware's redirect behavior never applied to /api/** paths
     * anyway (they don't start with /dashboard or /study), so excluding them
     * loses no functionality while removing the race's other half.
     *
     * Static files from public/ are excluded too. /sw.js, /manifest.json,
     * /pdf.worker.min.mjs (1.3 MB), videos and models used to run the full
     * session refresh on every request that carried the cookie, delaying
     * them and adding more racers for the single-use refresh token.
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|mjs|json|webmanifest|txt|xml|glb|mp4|webm|mp3|woff2?|ttf|css|map)$).*)",
    // Feature-flag gate only (see above) — never reaches updateSession.
    "/api/lecture-notes/:path*",
    "/api/lecture-notes",
    "/api/studio/infographic/:path*",
    "/api/studio/infographic",
  ],
};
