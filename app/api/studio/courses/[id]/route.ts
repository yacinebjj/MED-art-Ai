import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { resolveStudioSchema } from "@/lib/ai/studio-schemas";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { lookupStudioInfographicCache } from "@/lib/studio-infographic-cache";
import { lookupStudioPodcastCache } from "@/lib/studio-podcast-cache";
import type { JsonSectionId } from "@/lib/demo-content";
import type { StudioCourseFull } from "@/types/studio-course";

export const runtime = "nodejs";

/** JsonSectionId (tile id) -> studio_courses column name — "infographic"/"audio" are deliberately excluded, see lib/demo-content.ts's own comment on JsonSectionId. "qcm" -> "qcms" is the one mismatch, same as lib/ai/studio-prompts.ts's STUDIO_SECTION_KEYS. */
const SECTION_TO_COLUMN: Record<JsonSectionId, string> = {
  explication: "explication",
  resume: "resume",
  cas_clinique: "cas_clinique",
  qcm: "qcms",
  exemples_analogies: "exemples_analogies",
};

function isValidSection(value: unknown): value is JsonSectionId {
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

/** studio_courses.infographic_url / audio_url — added by a MANUAL migration (see supabase/schema.sql), so a database may not have them yet. Read separately from the main row on purpose: see the GET handler. */
interface StudioCourseMediaRow {
  infographic_url: string | null;
  audio_url: string | null;
}

function toFullCourse(
  row: StudioCourseFullRow,
  infographicUrl: string | null,
  audioUrl: string | null,
  qcmRegenerateCount?: number
): StudioCourseFull {
  return {
    ...(qcmRegenerateCount !== undefined ? { qcmRegenerateCount } : {}),
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
    infographicUrl,
    audioUrl,
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
  // Two queries, run in parallel, deliberately NOT one: the media columns
  // (infographic_url/audio_url) come from a manual migration. When they were
  // folded into this main select and the migration hadn't been applied yet,
  // Postgres rejected the WHOLE query — every course load failed with
  // "Lecture échouée", which also broke "Afficher le cours" (PDF/PPTX
  // viewer) since it loads the course first. The media query below is
  // allowed to fail on its own; the course itself must always load.
  const [{ data, error }, { data: mediaRow, error: mediaError }, { data: regenRow, error: regenError }] = await Promise.all([
    supabase
      .from("studio_courses")
      .select("id, title, raw_text, explication, resume, cas_clinique, qcms, exemples_analogies, source_file_url, updated_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("studio_courses")
      .select("infographic_url, audio_url")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle<StudioCourseMediaRow>(),
    // Own query on purpose, same reasoning as the media columns above: if the
    // qcm_regenerate_count migration isn't applied yet, only the counter is lost.
    supabase
      .from("studio_courses")
      .select("qcm_regenerate_count")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle<{ qcm_regenerate_count: number | null }>(),
  ]);

  if (regenError) {
    console.warn("[studio/courses/[id]:get] qcm_regenerate_count illisible (migration non appliquée ?):", regenError.message);
  }

  if (mediaError) {
    console.warn(
      "[studio/courses/[id]:get] infographic_url/audio_url illisibles (migration supabase/schema.sql non appliquée ?) — repli sur le cache:",
      mediaError.message
    );
  }

  if (error) {
    console.error("[studio/courses/[id]:get] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: "Lecture échouée. Réessaie." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  const row = data as StudioCourseFullRow;

  // SOURCE OF TRUTH: the URL persisted directly on this student's own row
  // (studio_courses.infographic_url / audio_url — see their own comment in
  // supabase/schema.sql). Written for EVERY variant on every successful
  // generation, so a refresh reloads them deterministically — this is the
  // real fix for the reported "Infographie/Podcast disappears on reload,
  // inconsistently" bug. The previous approach re-derived a content hash and
  // looked them up in the cross-student caches, which structurally could not
  // find a non-default variant (the read path has no idea which the student
  // picked) and broke whenever the hash basis (explication ?? raw_text)
  // changed after generation.
  // null when the columns don't exist yet (mediaError above) — the legacy
  // cache fallback below then behaves exactly as it did before them.
  let infographicUrl = mediaError ? null : mediaRow?.infographic_url ?? null;
  let audioUrl = mediaError ? null : mediaRow?.audio_url ?? null;

  // LEGACY FALLBACK, only for a column still null — a course whose media was
  // generated before infographic_url/audio_url existed. Mirrors the exact
  // explication ?? raw_text hash basis those older cache writes used, and
  // only runs the lookup for whichever URL isn't already on the row.
  if (infographicUrl === null || audioUrl === null) {
    const sourceText = row.explication && row.explication.trim().length >= 50 ? row.explication : row.raw_text;
    const contentHash = sourceText && sourceText.trim().length >= 50 ? sha256(normalizeText(sourceText)) : null;
    if (contentHash) {
      const [cachedInfographic, cachedAudio] = await Promise.all([
        infographicUrl === null ? lookupStudioInfographicCache(contentHash) : Promise.resolve(null),
        audioUrl === null ? lookupStudioPodcastCache(contentHash) : Promise.resolve(null),
      ]);
      infographicUrl = infographicUrl ?? cachedInfographic;
      audioUrl = audioUrl ?? cachedAudio;
    }
  }

  return NextResponse.json({ success: true, course: toFullCourse(row, infographicUrl, audioUrl, regenError ? undefined : (regenRow?.qcm_regenerate_count ?? 0)) });
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

  const { section, data: sectionData, studyYear: studyYearRaw } = (body ?? {}) as {
    section?: unknown;
    data?: unknown;
    studyYear?: unknown;
  };
  if (!isValidSection(section)) {
    return NextResponse.json({ success: false, error: "'section' invalide." }, { status: 400 });
  }
  if (sectionData === undefined || sectionData === null) {
    return NextResponse.json({ success: false, error: "'data' est requis." }, { status: 400 });
  }

  // SECURITY/INTEGRITY: this route used to write `sectionData` straight into
  // the column with no shape validation at all — sanitizeForPostgres only
  // strips control characters, it doesn't check shape/size. Unlike
  // /api/studio/generate and /api/studio/regenerate (which both reject a
  // malformed AI response via this exact schema before ever persisting), a
  // client sending an arbitrarily-shaped `data` here would corrupt the
  // column and crash the section's own renderer next time the student
  // opens this course. studyYear mirrors those two routes' own gating —
  // only actionType "cas_clinique" is affected, everything else ignores it.
  const studyYear = typeof studyYearRaw === "number" && Number.isFinite(studyYearRaw) ? studyYearRaw : null;
  const validation = resolveStudioSchema(section, studyYear).safeParse(sectionData);
  if (!validation.success) {
    console.error(`[studio/courses/[id]:patch] Validation zod échouée pour la section "${section}":`, validation.error.flatten().fieldErrors);
    return NextResponse.json({ success: false, error: "Le contenu fourni ne correspond pas au format attendu pour cette section." }, { status: 400 });
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
    .update({ [column]: sanitizeForPostgres(validation.data), updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[studio/courses/[id]:patch] Échec update Supabase:", error);
    return NextResponse.json({ success: false, error: "Sauvegarde échouée. Réessaie." }, { status: 500 });
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
    return NextResponse.json({ success: false, error: "Suppression échouée. Réessaie." }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
