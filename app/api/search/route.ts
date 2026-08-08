import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getEmbedding } from "@/lib/ai/embeddings";
import { buildCourseChunks } from "@/lib/search/chunking";
import { rateLimit, RATE_LIMITS, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real semantic search (embeddings + pgvector cosine similarity) over every
 * public course's Explication/Résumé/Cas Clinique/QCM content — see
 * lib/search/chunking.ts for how a course is split into chunks, and
 * supabase/schema.sql for the `course_chunks` table + `match_course_chunks`
 * function this depends on.
 *
 * Self-healing index: any course that has never been chunked gets indexed
 * right here, on the first search that runs after it, instead of hooking
 * into every content-generation route (explication/resume/cas-clinique/qcm)
 * separately. Bounded per request (MAX_COURSES_TO_INDEX × capped chunk
 * count) so one search can't trigger an unbounded embedding bill or a
 * request that hangs for minutes — the tradeoff is that a brand-new course
 * may need a couple of searches before it's fully indexed, not one.
 */

const MAX_COURSES_TO_INDEX_PER_REQUEST = 2;
const MAX_CHUNKS_PER_REQUEST = 40;
const MATCH_COUNT = 10;

async function ensureCoursesIndexed(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const { data: indexedRows } = await supabase.from("course_chunks").select("course_slug");
  const indexedSlugs = new Set((indexedRows ?? []).map((r: { course_slug: string }) => r.course_slug));

  const { data: allCourses } = await supabase.from("courses").select("slug");
  const missingSlugs = (allCourses ?? [])
    .map((c: { slug: string }) => c.slug)
    .filter((slug: string) => !indexedSlugs.has(slug))
    .slice(0, MAX_COURSES_TO_INDEX_PER_REQUEST);

  if (missingSlugs.length === 0) return;

  // The DB column is named "resumé" (French accent) and aliased to "resume"
  // here — same workaround as app/api/courses/slug/[slug]/route.ts's
  // parseJsonColumn comment: supabase-js's compile-time select-string parser
  // can't statically parse the accented column name, so the result is cast.
  interface CourseToIndex {
    slug: string;
    module_id: number | null;
    explication: string | null;
    resume: unknown;
    cas_clinique: unknown;
    qcms: unknown;
    exemples_analogies: string | null;
  }

  const { data: coursesToIndex } = (await supabase
    .from("courses")
    .select("slug, module_id, explication, resume:resumé, cas_clinique, qcms, exemples_analogies")
    .in("slug", missingSlugs)) as unknown as { data: CourseToIndex[] | null };

  let chunksIndexedSoFar = 0;
  for (const course of coursesToIndex ?? []) {
    if (chunksIndexedSoFar >= MAX_CHUNKS_PER_REQUEST) break;

    const chunks = buildCourseChunks({
      slug: course.slug,
      explication: course.explication,
      resume: course.resume,
      casClinique: course.cas_clinique,
      qcms: course.qcms,
      exemplesAnalogies: course.exemples_analogies,
    }).slice(0, MAX_CHUNKS_PER_REQUEST - chunksIndexedSoFar);

    if (chunks.length === 0) continue;

    const embeddings = await Promise.all(chunks.map((chunk) => getEmbedding(chunk.content)));
    const rows = chunks.map((chunk, i) => ({
      course_slug: course.slug,
      module_id: course.module_id,
      section_label: chunk.sectionLabel,
      chunk_index: i,
      content: chunk.content,
      embedding: embeddings[i],
    }));

    await supabase.from("course_chunks").upsert(rows, { onConflict: "course_slug,section_label,chunk_index" });
    chunksIndexedSoFar += chunks.length;
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`search:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Trop de recherches — réessaie dans un instant." },
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

  const { query } = (body ?? {}) as { query?: unknown };
  if (typeof query !== "string" || !query.trim()) {
    return NextResponse.json({ error: "Le champ 'query' est requis." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureCoursesIndexed(supabase);
  } catch (error) {
    console.error("[search] Échec de l'indexation à la volée:", errorMessage(error));
    // Indexing failures never block the search itself — courses already
    // indexed from a prior request still return real results.
  }

  let queryEmbedding: number[];
  try {
    queryEmbedding = await getEmbedding(query.trim());
  } catch (error) {
    return NextResponse.json({ error: `Échec de la recherche : ${errorMessage(error)}` }, { status: 500 });
  }

  const { data: matches, error: matchError } = await supabase.rpc("match_course_chunks", {
    query_embedding: queryEmbedding,
    match_count: MATCH_COUNT,
  });

  if (matchError) {
    console.error("[search] Échec de match_course_chunks:", { code: matchError.code, message: matchError.message });
    return NextResponse.json({ error: "La recherche a échoué." }, { status: 500 });
  }

  const rows = (matches ?? []) as { course_slug: string; section_label: string; content: string; similarity: number }[];
  const uniqueSlugs = Array.from(new Set(rows.map((r) => r.course_slug)));

  const { data: courseRows } = await supabase.from("courses").select("slug, title, module_id").in("slug", uniqueSlugs);
  const moduleIds = Array.from(new Set((courseRows ?? []).map((c: { module_id: number | null }) => c.module_id).filter((id: number | null): id is number => id != null)));
  const { data: moduleRows } = moduleIds.length
    ? await supabase.from("modules").select("id, name").in("id", moduleIds)
    : { data: [] as { id: number; name: string }[] };

  const courseBySlug = new Map((courseRows ?? []).map((c: { slug: string; title: string; module_id: number | null }) => [c.slug, c]));
  const moduleById = new Map((moduleRows ?? []).map((m: { id: number; name: string }) => [m.id, m.name]));

  const results = rows.map((row) => {
    const course = courseBySlug.get(row.course_slug);
    const moduleName = course?.module_id != null ? moduleById.get(course.module_id) ?? null : null;
    return {
      courseSlug: row.course_slug,
      courseTitle: course?.title ?? row.course_slug,
      moduleName,
      sectionLabel: row.section_label,
      excerpt: row.content.slice(0, 240),
      similarity: row.similarity,
    };
  });

  return NextResponse.json({ results });
}
