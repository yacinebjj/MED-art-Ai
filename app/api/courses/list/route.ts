import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Without this, Next.js treats this no-argument GET Route Handler as fully
// static and caches its one response — a freshly uploaded course would never
// appear in the list until the cache happened to invalidate.
export const dynamic = "force-dynamic";

/**
 * List of the SIGNED-IN STUDENT'S OWN "cours indépendants" (id, slug, title,
 * module_id) — powers the dashboard's "Mes cours indépendants (Historique)"
 * section, which is explicitly framed as personal upload history, not a
 * shared/public course catalog.
 *
 * Was previously "public, unauthenticated... every course in the `courses`
 * table" — no auth check, no user_id filter (the column didn't even exist).
 * That meant every student's dashboard showed literally every course ever
 * uploaded by every other student on the platform, unconditionally: a real
 * cross-account data-isolation bug, not a cosmetic one, found while
 * preparing a clean-state demo recording. courses.user_id is nullable (an
 * admin/seed-loaded showcase course has no uploader) — this endpoint
 * excludes those `null` rows too, since they belong to the separate public
 * demo pipeline (app/dashboard/demo/[slug]), never to "Mes cours
 * indépendants". Confirmed the only caller of this endpoint is
 * app/dashboard/(shell)/page.tsx, so scoping it this strictly cannot break
 * any other feature.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ courses: [] });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ courses: [] });
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("courses")
    .select("id, slug, title, module_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error || !data) {
    return NextResponse.json({ courses: [] });
  }

  return NextResponse.json({ courses: data });
}
