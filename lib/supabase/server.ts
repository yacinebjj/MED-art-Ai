import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the service-role key. Never import this
 * from a "use client" component or expose SUPABASE_SERVICE_ROLE_KEY to the
 * browser — it bypasses Row Level Security entirely.
 *
 * Typed loosely (`any` schema) rather than against generated Supabase types —
 * this project doesn't run `supabase gen types` yet. If you add that later,
 * swap the `any`s here for the generated `Database` type.
 */
let client: SupabaseClient<any, any, any> | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseAdmin(): SupabaseClient<any, any, any> {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server."
    );
  }

  client = createClient<any, any, any>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return client;
}
