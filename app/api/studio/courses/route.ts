import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import type { StudioCourseSummary } from "@/types/studio-course";

export const runtime = "nodejs";

/**
 * Multi-course Studio persistence (Golden Standard Part 2 — Auto-Save).
 * One row per uploaded course, per student, per curriculum module —
 * table `studio_courses` (RLS-enabled, migration run manually in the
 * Supabase SQL editor; writes go through the admin client with an explicit
 * `user_id` check in every query, matching this app's established pattern
 * for qcm_attempts/course_chat_history).
 */

interface StudioCourseRow {
  id: number;
  title: string;
  created_at: string;
}

function toSummary(row: StudioCourseRow): StudioCourseSummary {
  return { id: row.id, title: row.title, createdAt: row.created_at };
}

/** Sidebar list for one module — oldest first, so a newly added course appears at the bottom (the "empilement visuel" the client asked for). */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const moduleIdParam = request.nextUrl.searchParams.get("moduleId");
  const moduleId = moduleIdParam ? Number(moduleIdParam) : NaN;
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ success: false, error: "'moduleId' est requis et doit être un nombre." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("studio_courses")
    .select("id, title, created_at")
    .eq("user_id", user.id)
    .eq("curriculum_module_id", moduleId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[studio/courses:list] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  const courses: StudioCourseSummary[] = ((data ?? []) as StudioCourseRow[]).map(toSummary);
  return NextResponse.json({ success: true, courses });
}

/** Creates a new course row right after /api/upload extracts its text — every section starts null, filled in lazily as the student opens each Studio tab. */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-courses-create:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { moduleId, title, rawText } = (body ?? {}) as { moduleId?: unknown; title?: unknown; rawText?: unknown };

  if (typeof moduleId !== "number" || !Number.isFinite(moduleId)) {
    return NextResponse.json({ success: false, error: "'moduleId' est requis et doit être un nombre." }, { status: 400 });
  }
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ success: false, error: "'title' est requis." }, { status: 400 });
  }
  if (typeof rawText !== "string" || rawText.trim().length < 50) {
    return NextResponse.json({ success: false, error: "'rawText' est requis (≥ 50 caractères)." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("studio_courses")
    .insert({
      user_id: user.id,
      curriculum_module_id: moduleId,
      title: sanitizeForPostgres(title.trim()),
      raw_text: sanitizeForPostgres(rawText),
    })
    .select("id, title, created_at")
    .single();

  if (error) {
    console.error("[studio/courses:create] Échec insertion Supabase:", error);
    return NextResponse.json({ success: false, error: `Création échouée : ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, course: toSummary(data as StudioCourseRow) });
}
