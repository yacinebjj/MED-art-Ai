import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import type { AcademicYear, CurriculumModule, CurriculumYearData, TeachingUnit } from "@/types/academic";

/**
 * Public, unauthenticated lookup of one academic year's official curriculum
 * (its teaching units with sub-modules, plus its independent modules) — the
 * program structure is shared reference data, not personal student data, so
 * unlike /api/modules this needs no auth.
 *
 * GET /api/curriculum?specialty=M%C3%A9decine&level=2
 */
export async function GET(request: NextRequest) {
  const specialty = request.nextUrl.searchParams.get("specialty");
  const levelParam = request.nextUrl.searchParams.get("level");
  const level = levelParam ? Number(levelParam) : NaN;

  if (!specialty || !Number.isInteger(level)) {
    return NextResponse.json({ error: "Les paramètres 'specialty' et 'level' sont requis." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n'est pas configuré." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: specialtyRow, error: specialtyError } = await supabase
    .from("curriculum_specialties")
    .select("id, name")
    .eq("name", specialty)
    .maybeSingle();

  if (specialtyError) {
    return NextResponse.json({ error: specialtyError.message }, { status: 500 });
  }
  if (!specialtyRow) {
    return NextResponse.json({ error: "Filière introuvable." }, { status: 404 });
  }

  const { data: yearRow, error: yearError } = await supabase
    .from("curriculum_academic_years")
    .select("id, specialty_id, level, name")
    .eq("specialty_id", specialtyRow.id)
    .eq("level", level)
    .maybeSingle();

  if (yearError) {
    return NextResponse.json({ error: yearError.message }, { status: 500 });
  }
  if (!yearRow) {
    return NextResponse.json({ error: "Année introuvable pour cette filière." }, { status: 404 });
  }

  // Column names below (unit_order / module_order) match the live schema as
  // actually deployed — not display_order, which is what the original
  // migration draft proposed before it was adjusted at execution time. The
  // TS-facing field stays `displayOrder` either way; only this mapping layer
  // needs to know the real column names.
  const [unitsResult, modulesResult] = await Promise.all([
    supabase
      .from("curriculum_teaching_units")
      .select("id, year_id, title, unit_order")
      .eq("year_id", yearRow.id)
      .order("unit_order", { ascending: true }),
    supabase
      .from("curriculum_modules")
      .select("id, year_id, teaching_unit_id, title, module_order")
      .eq("year_id", yearRow.id)
      .order("module_order", { ascending: true }),
  ]);

  if (unitsResult.error) {
    return NextResponse.json({ error: unitsResult.error.message }, { status: 500 });
  }
  if (modulesResult.error) {
    return NextResponse.json({ error: modulesResult.error.message }, { status: 500 });
  }

  const units: TeachingUnit[] = (unitsResult.data ?? []).map((u) => ({
    id: u.id,
    yearId: u.year_id,
    title: u.title,
    displayOrder: u.unit_order,
  }));

  const modules: CurriculumModule[] = (modulesResult.data ?? []).map((m) => ({
    id: m.id,
    yearId: m.year_id,
    teachingUnitId: m.teaching_unit_id,
    title: m.title,
    displayOrder: m.module_order,
  }));

  const year: AcademicYear = {
    id: yearRow.id,
    specialtyId: yearRow.specialty_id,
    level: yearRow.level,
    name: yearRow.name,
  };

  const payload: CurriculumYearData = {
    year,
    teachingUnits: units.map((unit) => ({
      ...unit,
      modules: modules.filter((m) => m.teachingUnitId === unit.id),
    })),
    independentModules: modules.filter((m) => m.teachingUnitId === null),
  };

  return NextResponse.json(payload);
}
