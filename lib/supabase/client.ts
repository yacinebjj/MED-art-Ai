import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client, authenticated with the public anon key.
 * Safe to use in "use client" components — this is what powers real
 * sign up / sign in / sign out (see providers/AuthProvider.tsx).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
