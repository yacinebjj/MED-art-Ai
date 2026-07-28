import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Without this, Next.js treats this GET Route Handler as static and caches
// its response per-path — a freshly-generated section would keep showing
// as null after a page refresh until the cache happened to invalidate.
export const dynamic = "force-dynamic";

/**
 * Parses a jsonb-or-text Supabase column defensively: some environments
 * store these as native jsonb (already an object when read back), others
 * as plain text (a JSON string) — this works for either.
 */
function parseJsonColumn(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value ?? null;
}

/**
 * Public, unauthenticated lookup of a hand-authored showcase course (e.g.
 * "gastrite") by slug, from the `courses` table — distinct from the
 * per-user `user_courses` table. Powers app/dashboard/demo/[slug]/page.tsx's
 * Mode Visuel / Résumé / Cas Clinique / QCM Studio tabs.
 */
export async function GET(request: NextRequest, { params }: { params: { slug: string } }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n'est pas configuré." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  interface RawCourseRow {
    slug: string;
    title: string;
    explication: string;
    mode_visuel: unknown;
    resume: unknown;
    cas_clinique: unknown;
    qcms: unknown;
  }

  // The DB column is named "resumé" (with the French accent) and aliased to
  // "resume" here so the JSON response and frontend types can use plain
  // ASCII. supabase-js's compile-time select-string parser can't statically
  // parse the accented column name, so the query result is cast by hand.
  const selectColumns = "slug, title, explication, mode_visuel, resume:resumé, cas_clinique, qcms";

  const { data, error } = (await supabase
    .from("courses")
    .select(selectColumns)
    .eq("slug", params.slug)
    .maybeSingle()) as unknown as { data: RawCourseRow | null; error: unknown };

  if (error || !data) {
    return NextResponse.json({ error: "Cours introuvable." }, { status: 404 });
  }

  return NextResponse.json({
    slug: data.slug,
    title: data.title,
    explication: data.explication,
    mode_visuel: parseJsonColumn(data.mode_visuel),
    resume: parseJsonColumn(data.resume),
    cas_clinique: parseJsonColumn(data.cas_clinique),
    qcms: parseJsonColumn(data.qcms),
  });
}
