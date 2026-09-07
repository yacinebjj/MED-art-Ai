import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import type { CurriculumModule } from "@/types/academic";

/**
 * Public, unauthenticated lookup of a single curriculum module by id — powers
 * the module workspace page (app/dashboard/module/[id]/page.tsx), which needs
 * only the real title to render its header; reference data, same reasoning
 * as the rest of /api/curriculum/*.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Identifiant de module invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n'est pas configuré." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("curriculum_modules")
    .select("id, year_id, teaching_unit_id, title, module_order")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Module introuvable." }, { status: 404 });
  }

  const module_: CurriculumModule = {
    id: data.id,
    yearId: data.year_id,
    teachingUnitId: data.teaching_unit_id,
    title: data.title,
    displayOrder: data.module_order,
  };

  return NextResponse.json({ module: module_ });
}
