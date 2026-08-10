import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Specialty } from "@/types/academic";

/**
 * Public, unauthenticated list of every filière (Médecine, Pharmacie,
 * Dentaire) — powers the "Spécialité" select on the Settings page. Reference
 * data, not personal data, so no auth is required (same reasoning as
 * /api/curriculum).
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ specialties: [] });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("curriculum_specialties").select("id, name").order("name", { ascending: true });

  if (error || !data) {
    return NextResponse.json({ specialties: [] });
  }

  const specialties: Specialty[] = data.map((row) => ({ id: row.id, name: row.name }));
  return NextResponse.json({ specialties });
}
