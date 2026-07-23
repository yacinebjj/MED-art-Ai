import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

function createSessionClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // middleware.ts already refreshes the session cookie on every
            // request — a failure to re-set it here is never fatal.
          }
        },
      },
    }
  );
}

/**
 * The trusted user for the current request, derived from the session
 * cookie. Every API route must use this instead of trusting a client-
 * supplied userId in the request body/query string — otherwise anyone could
 * pass someone else's id and act on their behalf (spend their quota, read
 * their courses, etc).
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  const supabase = createSessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
