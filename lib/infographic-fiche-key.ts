/**
 * Studio "Infographie / Fiche de Synthèse" (product order 2026-11-09) — the
 * identifiers shared by its routes (app/api/studio/infographic/*), the course
 * loader (app/api/studio/courses/[id]) and the workspace. No server import:
 * safe in client code. The content hash itself lives in
 * lib/ai/infographic-sheet.ts (it needs Node's crypto).
 */

/**
 * Version of the sheet. Part of every key it writes — the shared image cache,
 * the stored file and the generation ledger — so the feature never serves an
 * image of the shelved Infographie / Mindmap (keyed by the bare text hash),
 * and a later version regenerates cleanly.
 */
export const FICHE_SYNTHESE_VERSION = "fiche-synthese-v1";

/** Folder of the sheets in the public "studio-infographics" bucket. */
export const FICHE_STORAGE_FOLDER = "fiche-synthese";

/** True for a stored sheet (…/studio-infographics/fiche-synthese/…); false for an image of the shelved Infographie / Mindmap, which the Studio no longer shows. */
export function isFicheSyntheseUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("http") && url.includes(`/${FICHE_STORAGE_FOLDER}/`);
}

/** The course text a sheet is made from: the Explication when it has content (≥ 50 characters), else the course's own text; null when neither does. Same basis as every Studio section. */
export function ficheSourceText(course: { explication: string | null; raw_text: string | null }): string | null {
  const text = course.explication && course.explication.trim().length >= 50 ? course.explication : course.raw_text;
  return text && text.trim().length >= 50 ? text : null;
}

/** The plan of a sheet as the workspace receives it (app/api/studio/infographic/prompt) — shown while the image is drawn. */
export interface FichePlanView {
  title: string;
  topics: { heading: string; details: string }[];
}

/** Shape check for a plan received over the network. */
export function isFichePlanView(value: unknown): value is FichePlanView {
  if (!value || typeof value !== "object") return false;
  const { title, topics } = value as { title?: unknown; topics?: unknown };
  return (
    typeof title === "string" &&
    Array.isArray(topics) &&
    topics.every((topic) => {
      if (!topic || typeof topic !== "object") return false;
      const { heading, details } = topic as { heading?: unknown; details?: unknown };
      return typeof heading === "string" && typeof details === "string";
    })
  );
}
