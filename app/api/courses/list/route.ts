import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Without this, Next.js treats this no-argument GET Route Handler as fully
// static and caches its one response — a freshly uploaded course would never
// appear in the list until the cache happened to invalidate.
export const dynamic = "force-dynamic";

/**
 * Public, unauthenticated list of every hand-authored showcase course in the
 * `courses` table (slug + title only) — powers the dynamic course list in
 * the dashboard/Sidebar, so a newly inserted row appears on refresh without
 * any code change.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ courses: [] });
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("courses")
    .select("slug, title")
    .order("created_at", { ascending: true });

  if (error || !data) {
    return NextResponse.json({ courses: [] });
  }

  return NextResponse.json({ courses: data });
}
