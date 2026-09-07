import { splitExplicationByChapter, type ExplicationSection } from "@/lib/explication-sections";

/**
 * Heuristic keyword-overlap matcher — there is no "concept" tag on QCM items
 * anywhere in this app (see lib/prompts/public-course-sections.ts), so a
 * failed question can't be linked to a course chapter with certainty. This
 * picks the `##` chapter that shares the most meaningful words with the
 * question + its explanation, which is honest best-effort, not a claim of
 * precise AI-tagged linking. Returns null rather than a low-confidence guess
 * when no chapter clears the minimum overlap — the caller (InteractiveQuiz's
 * "Voir le concept" modal) falls back to the QCM's own explanation text.
 */

const FRENCH_STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "à", "au", "aux",
  "est", "sont", "être", "avoir", "en", "dans", "sur", "pour", "par", "avec",
  "ce", "cet", "cette", "ces", "qui", "que", "quoi", "dont", "où", "quel", "quelle",
  "il", "elle", "ils", "elles", "on", "nous", "vous", "je", "tu", "se", "son", "sa", "ses",
  "pas", "plus", "ne", "n", "d", "l", "s", "y", "a",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-zà-ÿ0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !FRENCH_STOPWORDS.has(word))
  );
}

/** Minimum shared keywords required before we trust a match at all. */
const MIN_OVERLAP = 1;

export function findBestMatchingSection(explicationMarkdown: string, queryText: string): ExplicationSection | null {
  const sections = splitExplicationByChapter(explicationMarkdown);
  if (sections.length === 0) return null;

  const queryWords = tokenize(queryText);
  let best: { section: ExplicationSection; score: number } | null = null;

  for (const section of sections) {
    const headingWords = tokenize(section.headingText);
    let score = 0;
    for (const word of headingWords) {
      if (queryWords.has(word)) score += 1;
    }
    if (score >= MIN_OVERLAP && (!best || score > best.score)) {
      best = { section, score };
    }
  }

  return best?.section ?? null;
}
