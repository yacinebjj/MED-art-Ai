import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import type { StudentCurriculumProfile } from "@/types/academic";

/**
 * The student's real curriculum choice (specialty_id / academic_year_id on
 * `profiles`) — distinct from the name/université fields, which still live
 * in auth.users.user_metadata (see lib/auth.ts) and are untouched by this
 * route. Auth required for both verbs: this is personal profile data, not
 * shared reference data like /api/curriculum/*.
 */

interface ProfileRow {
  specialty_id: number | null;
  academic_year_id: number | null;
  curriculum_specialties: { id: number; name: string } | null;
  curriculum_academic_years: { id: number; specialty_id: number; level: number; name: string } | null;
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profiles")
    .select("specialty_id, academic_year_id, curriculum_specialties(id, name), curriculum_academic_years(id, specialty_id, level, name)")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const profile: StudentCurriculumProfile = {
    specialtyId: data?.specialty_id ?? null,
    academicYearId: data?.academic_year_id ?? null,
    specialty: data?.curriculum_specialties ? { id: data.curriculum_specialties.id, name: data.curriculum_specialties.name } : null,
    academicYear: data?.curriculum_academic_years
      ? {
          id: data.curriculum_academic_years.id,
          specialtyId: data.curriculum_academic_years.specialty_id,
          level: data.curriculum_academic_years.level,
          name: data.curriculum_academic_years.name,
        }
      : null,
  };

  return NextResponse.json({ profile });
}

/** Body: { specialtyId: number, academicYearId: number }. Both required together — an année only makes sense paired with its filière. */
export async function PATCH(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`profile-update:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { specialtyId, academicYearId } = (body ?? {}) as { specialtyId?: unknown; academicYearId?: unknown };
  if (!Number.isInteger(specialtyId) || !Number.isInteger(academicYearId)) {
    return NextResponse.json({ error: "'specialtyId' et 'academicYearId' sont requis (nombres entiers)." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Belt-and-suspenders against a stale client sending an année that no
  // longer belongs to the chosen filière (e.g. two tabs open, one on an old
  // specialty) — the FK alone wouldn't catch a *mismatched pair*, only a
  // nonexistent id.
  const { data: yearRow, error: yearError } = await supabase
    .from("curriculum_academic_years")
    .select("id, specialty_id")
    .eq("id", academicYearId)
    .maybeSingle();

  if (yearError) {
    return NextResponse.json({ error: yearError.message }, { status: 500 });
  }
  if (!yearRow || yearRow.specialty_id !== specialtyId) {
    return NextResponse.json({ error: "Cette année ne correspond pas à la spécialité choisie." }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ specialty_id: specialtyId, academic_year_id: academicYearId })
    .eq("id", user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
