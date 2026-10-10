import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";

export const runtime = "nodejs";

const RECOVERY_PATH = "/auth/update-password";

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
  const isRecovery = next === RECOVERY_PATH;

  // Password recovery always ends on the update-password page, which knows
  // how to finish every link shape (session in the #fragment for implicit
  // links — the server never sees it and the browser keeps it across this
  // redirect —, a `token_hash`, or an error to explain). Sending it to
  // /login instead is what made "forgot password" loop back on itself.
  if (isRecovery && !code) {
    const target = new URL(RECOVERY_PATH, origin);
    for (const key of ["token_hash", "type", "error", "error_code", "error_description"]) {
      const value = searchParams.get(key);
      if (value) target.searchParams.set(key, value);
    }
    return NextResponse.redirect(target);
  }

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
    // Typically an older PKCE recovery link opened in another browser (no
    // code verifier there): explain it on the recovery page.
    if (isRecovery) {
      return NextResponse.redirect(`${origin}${RECOVERY_PATH}?error_code=${encodeURIComponent(error.code ?? "exchange_failed")}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
