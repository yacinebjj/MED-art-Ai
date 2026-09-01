import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import type { DemoSectionId } from "@/lib/demo-content";
import type { StudioCourseFull } from "@/types/studio-course";

export const runtime = "nodejs";

/** DemoSectionId (tile id) -> studio_courses column name. "qcm" -> "qcms" is the one mismatch, same as lib/ai/studio-prompts.ts's STUDIO_SECTION_KEYS. */
const SECTION_TO_COLUMN: Record<DemoSectionId, string> = {
  explication: "explication",
  resume: "resume",
  cas_clinique: "cas_clinique",
  qcm: "qcms",
  exemples_analogies: "exemples_analogies",
};

function isValidSection(value: unknown): value is DemoSectionId {
  return typeof value === "string" && Object.keys(SECTION_TO_COLUMN).includes(value);
}

function parseCourseId(rawId: string): number | null {
  const id = Number(rawId);
  return Number.isFinite(id) ? id : null;
}

interface StudioCourseFullRow {
  id: number;
  title: string;
  raw_text: string;
  explication: string | null;
  resume: StudioCourseFull["resume"];
  cas_clinique: StudioCourseFull["casClinique"];
  qcms: StudioCourseFull["qcms"];
  exemples_analogies: string | null;
  source_file_url: string | null;
  updated_at: string | null;
}

function toFullCourse(row: StudioCourseFullRow): StudioCourseFull {
  return {
    id: row.id,
    title: row.title,
    rawText: row.raw_text,
    explication: row.explication,
    resume: row.resume,
    casClinique: row.cas_clinique,
    qcms: row.qcms,
    exemplesAnalogies: row.exemples_analogies,
    sourceFileUrl: row.source_file_url,
    updatedAt: row.updated_at,
  };
}

/** Full detail for one course — called when the student clicks it in the sidebar; everything already generated loads straight from Supabase, nothing regenerated. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const id = parseCourseId(params.id);
  if (id === null) {
    return NextResponse.json({ success: false, error: "Identifiant de cours invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("studio_courses")
    .select("id, title, raw_text, explication, resume, cas_clinique, qcms, exemples_analogies, source_file_url, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[studio/courses/[id]:get] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true, course: toFullCourse(data as StudioCourseFullRow) });
}

/** Saves one tile's freshly generated content — called right after /api/studio/generate succeeds, so a page refresh (or coming back tomorrow) never has to regenerate it. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-courses-patch:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const id = parseCourseId(params.id);
  if (id === null) {
    return NextResponse.json({ success: false, error: "Identifiant de cours invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { section, data: sectionData } = (body ?? {}) as { section?: unknown; data?: unknown };
  if (!isValidSection(section)) {
    return NextResponse.json({ success: false, error: "'section' invalide." }, { status: 400 });
  }
  if (sectionData === undefined || sectionData === null) {
    return NextResponse.json({ success: false, error: "'data' est requis." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const column = SECTION_TO_COLUMN[section];
  const supabase = getSupabaseAdmin();
  // .eq("user_id", ...) on the UPDATE itself (not just a prior SELECT) is what makes
  // this safe against a race — the ownership check and the write happen atomically.
  const { error, count } = await supabase
    .from("studio_courses")
    .update({ [column]: sanitizeForPostgres(sectionData), updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[studio/courses/[id]:patch] Échec update Supabase:", error);
    return NextResponse.json({ success: false, error: `Sauvegarde échouée : ${error.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

/** Deletes one course and everything it holds (all generated Studio sections live as columns on this same row, so a single row delete is a full delete — no child tables to cascade). */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-courses-delete:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const id = parseCourseId(params.id);
  if (id === null) {
    return NextResponse.json({ success: false, error: "Identifiant de cours invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  // .eq("user_id", ...) on the DELETE itself is what stops one student from deleting another's course by guessing an id.
  const { error, count } = await supabase.from("studio_courses").delete({ count: "exact" }).eq("id", id).eq("user_id", user.id);

  if (error) {
    console.error("[studio/courses/[id]:delete] Échec suppression Supabase:", error);
    return NextResponse.json({ success: false, error: `Suppression échouée : ${error.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
