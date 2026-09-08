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
/**
 * A client-side timeout on /api/upload/finalize (see lib/upload-client.ts's
 * FINALIZE_TIMEOUT_MS) can fire while this server-side call is still
 * running — Next.js Route Handlers don't observe a client-aborted fetch, so
 * the original request keeps going and still ends up calling this function,
 * while the student (having already seen a timeout error) may have retried
 * the whole upload from scratch. Without this check, that race produces two
 * duplicate studio_courses rows for the same document. Cheap, migration-free
 * guard: if an identical-looking row (same student, same module, same
 * title, same content length) was created in the last 5 minutes, reuse it
 * instead of inserting a second one. A full raw_text equality check is
 * deliberately avoided (large TEXT column, no index) — this heuristic is
 * good enough to catch the real race (an exact duplicate retry) without a
 * meaningful false-positive risk (two genuinely different documents
 * coincidentally sharing title AND exact character count within 5 minutes
 * is vanishingly unlikely for real course material).
 */
async function findRecentDuplicate(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  params: { userId: string; moduleId: number; title: string; rawTextLength: number }
): Promise<StudioCourseRow | null> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("studio_courses")
    .select("id, title, created_at, raw_text")
    .eq("user_id", params.userId)
    .eq("curriculum_module_id", params.moduleId)
    .eq("title", params.title)
    .gte("created_at", fiveMinutesAgo)
    .order("created_at", { ascending: false })
    .limit(5);

  const match = ((data ?? []) as (StudioCourseRow & { raw_text: string | null })[]).find(
    (row) => (row.raw_text?.length ?? -1) === params.rawTextLength
  );
  return match ?? null;
}

export async function createStudioCourse(params: {
  userId: string;
  moduleId: number;
  title: string;
  rawText: string;
  sourceFileUrl?: string | null;
}): Promise<StudioCourseSummary> {
  const supabase = getSupabaseAdmin();
  const sanitizedTitle = sanitizeForPostgres(params.title.trim());
  const sanitizedText = sanitizeForPostgres(params.rawText);

  const duplicate = await findRecentDuplicate(supabase, {
    userId: params.userId,
    moduleId: params.moduleId,
    title: sanitizedTitle,
    rawTextLength: sanitizedText.length,
  });
  if (duplicate) return toSummary(duplicate);

  const { data, error } = await supabase
    .from("studio_courses")
    .insert({
      user_id: params.userId,
      curriculum_module_id: params.moduleId,
      title: sanitizedTitle,
      raw_text: sanitizedText,
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
