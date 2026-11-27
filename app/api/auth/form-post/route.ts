import { NextResponse, type NextRequest } from "next/server";

/**
 * Where the sign-in, sign-up and password forms land when the BROWSER submits
 * them itself: on a slow phone before React has taken the page over (the
 * sign-in guard gave up after 20 s, or the forgot-password form), or with no
 * JavaScript at all. The forms are method="post" so the fields travel in the
 * body, never in a URL — and they post HERE because Vercel answers a POST to
 * those pre-rendered pages with 405 (checked live 2026-11-27).
 *
 * The body is never read, stored or logged: signing in only ever happens in
 * the browser, through Supabase. The answer is a 303 back to the form's page
 * with its query (`next`) intact — a fresh load, its scripts fetched again.
 * Same-origin form posts carry the full Referer (Referrer-Policy is
 * strict-origin-when-cross-origin); anything else goes to /login.
 *
 * Under /api on purpose: middleware (session refresh, device cookie) skips it.
 */
const FORM_PAGES = new Set(["/login", "/register", "/forgot-password", "/auth/update-password"]);

/** The answer depends on each request's Referer: never pre-rendered. */
export const dynamic = "force-dynamic";

function formPage(request: NextRequest): URL {
  const origin = request.nextUrl.origin;
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const from = new URL(referer);
      if (from.origin === origin && FORM_PAGES.has(from.pathname)) return new URL(`${from.pathname}${from.search}`, origin);
    } catch {
      // Unreadable Referer: the sign-in page.
    }
  }
  return new URL("/login", origin);
}

export function POST(request: NextRequest) {
  return NextResponse.redirect(formPage(request), 303);
}

/** Opened directly (a bookmark, a refresh of the POST): the sign-in page. */
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin), 307);
}
