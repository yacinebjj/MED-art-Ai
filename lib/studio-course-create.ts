import { getSupabaseAdmin } from "@/lib/supabase/server";
import { sanitizeForPostgres } from "@/lib/course-generation-shared";
import { indexStudioCourseChunksForChat } from "@/lib/studio-explication-delta";
import type { StudioCourseSummary } from "@/types/studio-course";

interface StudioCourseRow {
  id: number;
  title: string;
  created_at: string;
}

function toSummary(row: StudioCourseRow): StudioCourseSummary {
  return { id: row.id, title: row.title, createdAt: row.created_at };
}

/**
 * The real studio_courses insert + fire-and-forget chat-indexing, shared by
 * POST /api/studio/courses (the "Texte direct" paste flow, which calls this
 * directly) and POST /api/upload/finalize (the file-upload flow, which
 * creates the row itself right after extracting text — see that route's own
 * comment for why: sending the extracted text of a large document BACK to
 * the browser only for it to immediately POST the exact same text to a
 * SEPARATE route would reintroduce the same request-body-size problem this
 * whole pipeline exists to avoid, just one hop later). Extracted here so
 * neither caller duplicates the insert/indexing logic.
 */
export async function createStudioCourse(params: {
  userId: string;
  moduleId: number;
  title: string;
  rawText: string;
  sourceFileUrl?: string | null;
}): Promise<StudioCourseSummary> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("studio_courses")
    .insert({
      user_id: params.userId,
      curriculum_module_id: params.moduleId,
      title: sanitizeForPostgres(params.title.trim()),
      raw_text: sanitizeForPostgres(params.rawText),
      source_file_url: params.sourceFileUrl ?? null,
    })
    .select("id, title, created_at")
    .single();

  if (error || !data) {
    throw new Error(error ? `Création échouée : ${error.message}` : "Création échouée.");
  }

  const createdCourse = data as StudioCourseRow;

  // Same fire-and-forget, non-blocking indexing as before — never awaited,
  // failure is logged and swallowed (see /api/studio/courses' own original
  // comment on why: chat RAG falls back to general knowledge without it).
  void indexStudioCourseChunksForChat(createdCourse.id, params.rawText, params.userId).catch((indexError) =>
    console.error("[studio-course-create] Échec indexation en arrière-plan (non bloquant):", indexError instanceof Error ? indexError.message : indexError)
  );

  return toSummary(createdCourse);
}
