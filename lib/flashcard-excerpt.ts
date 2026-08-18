const MIN_EXCERPT_CHARS = 800;
const MAX_EXCERPT_CHARS = 2000;

/**
 * Picks a random contiguous window of paragraphs from a course's
 * `explication` markdown — a genuinely different slice on every call, so
 * repeated flashcard-generation requests naturally surface different
 * material without needing to track which parts of the course were already
 * used. Heading/table lines are excluded from the paragraph pool so the AI
 * is never handed a bare "## Chapitre III" with nothing to ask a question
 * about.
 */
export function pickRandomExcerpt(markdown: string): string {
  const paragraphs = markdown
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith("#") && !p.startsWith("|") && !p.startsWith(">"));

  if (paragraphs.length === 0) return markdown.slice(0, MAX_EXCERPT_CHARS);

  const startIndex = Math.floor(Math.random() * paragraphs.length);
  let excerpt = "";
  let i = startIndex;

  for (let steps = 0; steps < paragraphs.length && excerpt.length < MIN_EXCERPT_CHARS; steps++) {
    excerpt += (excerpt ? "\n\n" : "") + paragraphs[i];
    i = (i + 1) % paragraphs.length;
  }

  return excerpt.slice(0, MAX_EXCERPT_CHARS);
}
