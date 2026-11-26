/**
 * Cache-Control of the public curriculum lookups (app/api/curriculum/**):
 * shared reference data, identical for every student and not personal, so
 * the browser keeps it 5 minutes and Vercel's CDN an hour (then serves it
 * stale for up to a day while refreshing it) — most requests never reach
 * the function or Supabase. Sent only with a real answer: never on an error
 * or on an empty list that may stand for one.
 */
export const REFERENCE_DATA_CACHE_CONTROL = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
