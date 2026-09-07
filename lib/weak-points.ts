import { findBestMatchingSection } from "@/lib/weakness-matching";

/** One row from the `course_weak_qcms` SQL function (see app/api/srs/course-weak-points/route.ts). */
export interface WeakQcmRow {
  qcm_id: string;
  is_correct: boolean;
  leitner_box: number;
  attempted_at: string;
}

export interface WeakChapter {
  label: string;
  count: number;
}

interface QcmLike {
  id: number;
  question: string;
  explication?: { globale?: string };
}

interface QrocLike {
  id: number;
  question: string;
}

/** Same jsonb-vs-text tolerance used throughout the app (see app/api/courses/slug/[slug]/route.ts's parseJsonColumn). */
function parseMaybeJson(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value ?? null;
}

/**
 * Resolves raw weak-attempt rows (qcm_id only — e.g. "qcm-3") back into
 * human-readable chapter labels, by looking up each question's real text in
 * the course's qcms JSON and running the same heuristic chapter-matcher
 * "Voir le concept" already uses (lib/weakness-matching.ts) — reusing that
 * exact logic keeps both features consistent about which chapter a given
 * question belongs to, rather than inventing a second, possibly-conflicting
 * matching rule.
 *
 * Returns `null` when the course's own QCM content can't be parsed at all
 * (e.g. the hardcoded legacy Appendicite course, which has no `courses` row
 * and thus nothing for `/api/courses/slug/[slug]` to return) — the caller
 * then falls back to a simpler, question-text-free summary instead of
 * silently showing nothing.
 */
export function resolveWeakChapters(
  weakQcms: WeakQcmRow[],
  courseQcmsRaw: unknown,
  explicationMarkdown: string | null
): WeakChapter[] | null {
  const parsed = parseMaybeJson(courseQcmsRaw) as { qcms?: QcmLike[]; qrocs?: QrocLike[] } | null;
  if (!parsed) return null;

  const counts = new Map<string, number>();

  for (const weak of weakQcms) {
    const match = weak.qcm_id.match(/^(qcm|qroc)-(\d+)$/);
    if (!match) continue;
    const [, kind, idStr] = match;
    const id = Number(idStr);

    const item = kind === "qcm" ? parsed.qcms?.find((q) => q.id === id) : parsed.qrocs?.find((q) => q.id === id);
    if (!item) continue;

    const queryText =
      kind === "qcm" ? `${item.question} ${(item as QcmLike).explication?.globale ?? ""}` : item.question;
    const label = explicationMarkdown ? findBestMatchingSection(explicationMarkdown, queryText)?.headingText : undefined;
    const key = label ?? "Notions générales";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}
