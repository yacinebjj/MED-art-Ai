import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { REFERENCE_DATA_CACHE_CONTROL } from "@/lib/reference-data-cache";
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
  // An empty list is what a failure looks like here too: never cached.
  return NextResponse.json({ specialties }, specialties.length > 0 ? { headers: { "Cache-Control": REFERENCE_DATA_CACHE_CONTROL } } : undefined);
}
