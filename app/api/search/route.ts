import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { rateLimit, RATE_LIMITS, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Search over the signed-in student's OWN Studio courses — REWRITTEN
 * (product direction, after a real cross-account data-leak report): this
 * used to query the now-retired `courses` table (the old "cours
 * indépendant" pipeline, see git history) via pgvector semantic search, with
 * NO user scoping anywhere in the query — `ensureCoursesIndexed` read every
 * course platform-wide, and `match_course_chunks` had no user/module filter
 * at all. Any student searching any word could see any OTHER student's
 * uploaded course content. That whole embedding/pgvector index
 * (course_chunks, match_course_chunks) was built for that retired table and
 * is not reused here.
 *
 * STRICT ISOLATION: the only query below is `.eq("user_id", user.id")` on
 * `studio_courses` — every row a student can ever create is already scoped
 * to a curriculum module THEY THEMSELVES opened (there is no "upload to
 * someone else's module" path anywhere in this app), so this single filter
 * guarantees both "only my courses" and "only my modules" — no separate
 * enrollment table exists or is needed.
 *
 * Deliberately plain substring matching (no embeddings, no new pgvector
 * index) — a single student's own course set is small (dozens, not
 * thousands), so a full per-user row scan is cheap, and building a whole new
 * semantic index for `studio_courses` is real, separate work this fix does
 * not attempt. Matching happens in application code (not a PostgREST
 * `.ilike` filter) because `resume`/`cas_clinique`/`qcms` are jsonb columns,
 * not text — PostgREST can't ilike-filter those directly without a cast this
 * query builder can't express, so each row is fetched once (already scoped
 * to this user, so this is not an isolation risk) and matched here instead.
 */

const MAX_RESULTS = 20;
const EXCERPT_RADIUS = 120;

interface StudioCourseSearchRow {
  id: number;
  title: string;
  curriculum_module_id: number;
  explication: string | null;
  resume: unknown;
  cas_clinique: unknown;
  qcms: unknown;
  exemples_analogies: string | null;
}

/** Flattens any section value (plain string or jsonb object) into a searchable/excerptable string. */
function sectionText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/** A short, centered window of context around the first match — never the raw JSON blob a jsonb section would otherwise produce. */
function excerptAround(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.replace(/\s+/g, " ").trim().slice(0, EXCERPT_RADIUS * 2);
  const start = Math.max(0, idx - EXCERPT_RADIUS);
  const end = Math.min(text.length, idx + query.length + EXCERPT_RADIUS);
  const slice = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${slice}${end < text.length ? "…" : ""}`;
}

const SECTION_LABELS: Record<string, string> = {
  explication: "Explication",
  resume: "Résumé",
  cas_clinique: "Cas Clinique",
  qcms: "QCM",
  exemples_analogies: "Exemples & Analogies",
};

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
  const q = query.trim();
  const qLower = q.toLowerCase();

  const supabase = getSupabaseAdmin();

  const { data: rows, error: rowsError } = await supabase
    .from("studio_courses")
    .select("id, title, curriculum_module_id, explication, resume, cas_clinique, qcms, exemples_analogies")
    .eq("user_id", user.id)
    .returns<StudioCourseSearchRow[]>();

  if (rowsError) {
    console.error("[search] Échec lecture studio_courses:", rowsError.message);
    return NextResponse.json({ error: "La recherche a échoué." }, { status: 500 });
  }

  type Hit = { courseId: number; courseTitle: string; moduleId: number; sectionLabel: string; excerpt: string };
  const hits: Hit[] = [];

  for (const course of rows ?? []) {
    const sections: [string, unknown][] = [
      ["explication", course.explication],
      ["resume", course.resume],
      ["cas_clinique", course.cas_clinique],
      ["qcms", course.qcms],
      ["exemples_analogies", course.exemples_analogies],
    ];

    const titleMatches = course.title.toLowerCase().includes(qLower);

    for (const [sectionKey, rawValue] of sections) {
      const text = sectionText(rawValue);
      if (!text) continue;
      if (!titleMatches && !text.toLowerCase().includes(qLower)) continue;

      hits.push({
        courseId: course.id,
        courseTitle: course.title,
        moduleId: course.curriculum_module_id,
        sectionLabel: SECTION_LABELS[sectionKey] ?? sectionKey,
        excerpt: titleMatches && !text.toLowerCase().includes(qLower) ? text.replace(/\s+/g, " ").trim().slice(0, EXCERPT_RADIUS * 2) : excerptAround(text, q),
      });

      if (hits.length >= MAX_RESULTS) break;
    }
    if (hits.length >= MAX_RESULTS) break;
  }

  console.log(`[search] user=${user.id} query="${q}" -> ${hits.length} résultat(s) (studio_courses, scopé à cet utilisateur)`);

  const moduleIds = Array.from(new Set(hits.map((h) => h.moduleId)));
  const { data: moduleRows, error: moduleRowsError } = moduleIds.length
    ? await supabase.from("curriculum_modules").select("id, title").in("id", moduleIds)
    : { data: [] as { id: number; title: string }[], error: null };
  if (moduleRowsError) {
    console.error("[search] Échec lecture curriculum_modules (enrichissement noms de module):", moduleRowsError.message);
  }
  const moduleTitleById = new Map((moduleRows ?? []).map((m: { id: number; title: string }) => [m.id, m.title]));

  const results = hits.map((h) => ({
    courseId: h.courseId,
    courseTitle: h.courseTitle,
    moduleId: h.moduleId,
    moduleName: moduleTitleById.get(h.moduleId) ?? null,
    sectionLabel: h.sectionLabel,
    excerpt: h.excerpt,
  }));

  return NextResponse.json({ results });
}
