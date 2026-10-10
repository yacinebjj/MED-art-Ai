import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
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

  const result = await loadCurriculumCached(specialty, level);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.payload, {
    // Shared reference data, identical for every student of a year: the CDN
    // and the browser serve it without reaching Supabase. It was fetched
    // fresh (3 sequential queries) on every dashboard open.
    headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" },
  });
}

type CurriculumResult = { payload: CurriculumYearData } | { error: string; status: number };

/** Server-side cache of the same data (1 h): a CDN miss still skips the database. Errors are never cached. */
async function loadCurriculumCached(specialty: string, level: number): Promise<CurriculumResult> {
  try {
    return { payload: await cachedCurriculum(specialty, level) };
  } catch (error) {
    if (error instanceof CurriculumLookupError) return { error: error.message, status: error.status };
    return { error: error instanceof Error ? error.message : "Erreur inconnue.", status: 500 };
  }
}

class CurriculumLookupError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const cachedCurriculum = unstable_cache(loadCurriculum, ["curriculum-year-v1"], { revalidate: 3600, tags: ["curriculum"] });

async function loadCurriculum(specialty: string, level: number): Promise<CurriculumYearData> {
  const supabase = getSupabaseAdmin();

  const { data: specialtyRow, error: specialtyError } = await supabase
    .from("curriculum_specialties")
    .select("id, name")
    .eq("name", specialty)
    .maybeSingle();

  if (specialtyError) {
    throw new CurriculumLookupError(specialtyError.message, 500);
  }
  if (!specialtyRow) {
    throw new CurriculumLookupError("Filière introuvable.", 404);
  }

  const { data: yearRow, error: yearError } = await supabase
    .from("curriculum_academic_years")
    .select("id, specialty_id, level, name")
    .eq("specialty_id", specialtyRow.id)
    .eq("level", level)
    .maybeSingle();

  if (yearError) {
    throw new CurriculumLookupError(yearError.message, 500);
  }
  if (!yearRow) {
    throw new CurriculumLookupError("Année introuvable pour cette filière.", 404);
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
    throw new CurriculumLookupError(unitsResult.error.message, 500);
  }
  if (modulesResult.error) {
    throw new CurriculumLookupError(modulesResult.error.message, 500);
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

  return payload;
}
