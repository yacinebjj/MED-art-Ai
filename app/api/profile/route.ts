import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import type { StudentCurriculumProfile } from "@/types/academic";
import { isMissingColumnError } from "@/lib/group-chat";
import { isFlashcardPushInterval, normalizeFlashcardPushInterval } from "@/lib/push/cadence";

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

  // Reminder settings (Paramètres → Rappels). Read separately and tolerantly:
  // the cadence column only exists once 20261004_flashcard_push_cadence.sql ran.
  const reminders = await readReminderSettings(supabase, user.id);

  return NextResponse.json({ profile, reminders });
}

interface PushDevice {
  endpoint: string;
  platform: string;
}

/** Human label for a Web Push endpoint's push service (the only device info a subscription carries). */
function pushPlatformLabel(endpoint: string): string {
  try {
    const host = new URL(endpoint).hostname;
    if (host.endsWith("push.apple.com")) return "Safari (iPhone, iPad ou Mac)";
    if (host.endsWith("googleapis.com")) return "Chrome / Android";
    if (host.endsWith("mozilla.com")) return "Firefox";
    if (host.endsWith("notify.windows.com")) return "Edge / Windows";
    return host;
  } catch {
    return "Appareil inconnu";
  }
}

async function readReminderSettings(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string
): Promise<{ intervalMinutes: number; cadenceAvailable: boolean; devices: PushDevice[] }> {
  let cadenceAvailable = true;
  let { data, error } = await supabase
    .from("profiles")
    .select("push_subscriptions, flashcard_push_interval_minutes")
    .eq("id", userId)
    .maybeSingle<{ push_subscriptions: { endpoint: string }[] | null; flashcard_push_interval_minutes?: number | null }>();
  if (isMissingColumnError(error)) {
    cadenceAvailable = false;
    ({ data, error } = await supabase
      .from("profiles")
      .select("push_subscriptions")
      .eq("id", userId)
      .maybeSingle<{ push_subscriptions: { endpoint: string }[] | null; flashcard_push_interval_minutes?: number | null }>());
  }
  const devices = (data?.push_subscriptions ?? [])
    .filter((sub) => typeof sub?.endpoint === "string")
    .map((sub) => ({ endpoint: sub.endpoint, platform: pushPlatformLabel(sub.endpoint) }));
  return { intervalMinutes: normalizeFlashcardPushInterval(data?.flashcard_push_interval_minutes), cadenceAvailable: cadenceAvailable && !error, devices };
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

  const { specialtyId, academicYearId, flashcardPushIntervalMinutes } = (body ?? {}) as {
    specialtyId?: unknown;
    academicYearId?: unknown;
    flashcardPushIntervalMinutes?: unknown;
  };

  // Reminder cadence only (Paramètres → Rappels): 60, 120 or 240 minutes.
  if (flashcardPushIntervalMinutes !== undefined && specialtyId === undefined && academicYearId === undefined) {
    if (!isFlashcardPushInterval(flashcardPushIntervalMinutes)) {
      return NextResponse.json({ error: "'flashcardPushIntervalMinutes' doit valoir 60, 120 ou 240." }, { status: 400 });
    }
    const { error: cadenceError } = await getSupabaseAdmin()
      .from("profiles")
      .update({ flashcard_push_interval_minutes: flashcardPushIntervalMinutes })
      .eq("id", user.id);
    if (cadenceError) {
      if (isMissingColumnError(cadenceError)) {
        return NextResponse.json({ error: "Le choix de la fréquence sera disponible après la prochaine mise à jour du serveur. En attendant : 1 rappel par heure." }, { status: 409 });
      }
      return NextResponse.json({ error: cadenceError.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, flashcardPushIntervalMinutes });
  }

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
