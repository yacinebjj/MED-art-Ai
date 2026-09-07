import { splitExplicationByChapter } from "@/lib/explication-sections";

/**
 * Splits one course's real, already-generated content into small, embeddable
 * chunks for semantic search (see app/api/search/route.ts). Every chunk here
 * is real course text — nothing is fabricated or summarized by this file.
 */

export interface CourseChunk {
  sectionLabel: string;
  content: string;
}

export interface ChunkableCourse {
  slug: string;
  explication: string | null;
  /** Raw jsonb from the `resumé` column (may arrive as a string on some rows — see parseMaybeJson). */
  resume: unknown;
  casClinique: unknown;
  qcms: unknown;
  exemplesAnalogies: string | null;
}

/** Same jsonb-vs-text tolerance as app/api/courses/slug/[slug]/route.ts's parseJsonColumn — some rows store these columns as a JSON string instead of native jsonb. */
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
 * Recursively collects every string leaf of a JSON value into one blob.
 * Good enough for search relevance without hand-writing a dedicated
 * flattener for every one of the resumé/cas_clinique JSON schemas (see
 * lib/prompts/public-course-sections.ts) — those are deeply nested and
 * change shape per "mode", so a generic walk is the maintainable choice.
 * Skips very short strings (icon/color/enum codes like "cyan", "id").
 */
function flattenJsonText(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (value.trim().length > 3) out.push(value.trim());
  } else if (Array.isArray(value)) {
    for (const item of value) flattenJsonText(item, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) flattenJsonText(v, out);
  }
  return out;
}

/** Splits the Explication markdown into one chunk per `##` chapter (shared with lib/weakness-matching.ts) — falls back to the whole text as a single chunk when no heading is found. */
function chunkExplication(explication: string): CourseChunk[] {
  const sections = splitExplicationByChapter(explication);
  if (sections.length === 0) {
    return explication.trim() ? [{ sectionLabel: "Explication", content: explication.trim() }] : [];
  }
  return sections.map((section) => ({ sectionLabel: "Explication", content: section.content }));
}

interface QcmLike {
  question?: string;
  options?: { text?: string }[];
  explication?: { globale?: string };
}

interface QrocLike {
  question?: string;
  reponseOfficielle?: string;
}

function chunkQcms(qcmsRaw: unknown): CourseChunk[] {
  const qcms = parseMaybeJson(qcmsRaw) as { qcms?: QcmLike[]; qrocs?: QrocLike[] } | null;
  if (!qcms) return [];

  const chunks: CourseChunk[] = [];
  for (const qcm of qcms.qcms ?? []) {
    const text = [qcm.question, ...(qcm.options ?? []).map((o) => o.text), qcm.explication?.globale]
      .filter(Boolean)
      .join(" — ");
    if (text.trim()) chunks.push({ sectionLabel: "QCM", content: text.trim() });
  }
  for (const qroc of qcms.qrocs ?? []) {
    const text = [qroc.question, qroc.reponseOfficielle].filter(Boolean).join(" — ");
    if (text.trim()) chunks.push({ sectionLabel: "QROC", content: text.trim() });
  }
  return chunks;
}

function chunkStructuredJson(raw: unknown, sectionLabel: string): CourseChunk[] {
  const parsed = parseMaybeJson(raw);
  if (!parsed) return [];
  const text = flattenJsonText(parsed).join(" ");
  return text.trim() ? [{ sectionLabel, content: text.trim() }] : [];
}

export function buildCourseChunks(course: ChunkableCourse): CourseChunk[] {
  const chunks: CourseChunk[] = [];

  if (course.explication) chunks.push(...chunkExplication(course.explication));
  chunks.push(...chunkStructuredJson(course.resume, "Résumé"));
  chunks.push(...chunkStructuredJson(course.casClinique, "Cas Clinique"));
  chunks.push(...chunkQcms(course.qcms));
  if (course.exemplesAnalogies?.trim()) {
    chunks.push({ sectionLabel: "Exemples & Analogies", content: course.exemplesAnalogies.trim() });
  }

  return chunks;
}
