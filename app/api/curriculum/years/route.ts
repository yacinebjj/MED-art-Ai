import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import type { AcademicYear } from "@/types/academic";

/**
 * Public, unauthenticated list of a specialty's academic years, ordered by
 * level — this is the exact query the Settings page's "Année" select was
 * missing: it used to build its options from a hardcoded client-side list
 * (lib/constants.ts) that never touched curriculum_academic_years at all.
 *
 * GET /api/curriculum/years?specialtyId=1
 */
export async function GET(request: NextRequest) {
  const specialtyIdParam = request.nextUrl.searchParams.get("specialtyId");
  const specialtyId = specialtyIdParam ? Number(specialtyIdParam) : NaN;

  if (!Number.isInteger(specialtyId)) {
    return NextResponse.json({ error: "Le paramètre 'specialtyId' est requis." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ years: [] });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("curriculum_academic_years")
    .select("id, specialty_id, level, name")
    .eq("specialty_id", specialtyId)
    .order("level", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const years: AcademicYear[] = (data ?? []).map((row) => ({
    id: row.id,
    specialtyId: row.specialty_id,
    level: row.level,
    name: row.name,
  }));

  return NextResponse.json({ years });
}
