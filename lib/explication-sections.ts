import { slugifyHeading } from "@/lib/heading-slug";

/**
 * Splits an Explication's Markdown into one entry per `##` chapter — the
 * single shared implementation used both for search indexing
 * (lib/search/chunking.ts) and for the post-QCM "Voir le concept" modal
 * (lib/weakness-matching.ts), so the two features can never drift into
 * different chapter boundaries for the same course.
 */
export interface ExplicationSection {
  /** The heading's own text, e.g. "Chapitre III : Le tapis roulant de mucus". */
  headingText: string;
  slug: string;
  /** The heading line itself plus everything up to (not including) the next `##`. */
  content: string;
}

const HEADING_PATTERN = /^##\s+(.+)$/m;

export function splitExplicationByChapter(explicationMarkdown: string): ExplicationSection[] {
  const parts = explicationMarkdown.split(/(?=^##\s+.+$)/m).filter((part) => part.trim().length > 0);

  return parts
    .map((part) => {
      const headingMatch = part.match(HEADING_PATTERN);
      if (!headingMatch) return null;
      return { headingText: headingMatch[1].trim(), slug: slugifyHeading(headingMatch[1]), content: part.trim() };
    })
    .filter((section): section is ExplicationSection => section !== null);
}
