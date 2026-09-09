import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";

export const runtime = "nodejs";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

/**
 * Where Supabase sends the student after they click the "confirm your
 * email" link (see emailRedirectTo in RegisterForm.tsx). Exchanges the
 * one-time code for a real session cookie, then redirects into the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // SECURITY: sanitizeRedirectPath forces this to a same-origin relative
  // path — see its own header comment. A raw, unvalidated `next` here was a
  // real, confirmed open redirect (e.g. `next=@evil-phish.com`, which both
  // NextResponse.redirect and the browser parse with evil-phish.com as the
  // actual host once concatenated onto `origin`).
  const next = sanitizeRedirectPath(searchParams.get("next"));

  if (code) {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: CookieToSet[]) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("Auth callback: exchangeCodeForSession failed", error);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
