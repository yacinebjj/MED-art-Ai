import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { AUDIO_SMART_NOTES_API, AUDIO_SMART_NOTES_ENABLED, AUDIO_SMART_NOTES_PAGE, INFOGRAPHIC_API, INFOGRAPHIC_ENABLED } from "@/lib/feature-flags";

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

  return await updateSession(request);
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
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    // Feature-flag gate only (see above) — never reaches updateSession.
    "/api/lecture-notes/:path*",
    "/api/lecture-notes",
    "/api/studio/infographic/:path*",
    "/api/studio/infographic",
  ],
};
