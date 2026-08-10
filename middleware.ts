import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
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
  ],
};
