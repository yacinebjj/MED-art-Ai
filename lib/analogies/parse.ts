/**
 * Structure parser for the Studio "Exemples & Analogies" section.
 *
 * The section is stored as ONE Markdown string (StudioTextSchema — frozen,
 * like its prompt in lib/prompts/public-course-sections.ts). This file
 * recovers the structure that prompt asks the model for, so
 * components/course/workspace/analogies/AnalogyCanvas.tsx can render cards
 * instead of a text dump:
 *
 *   ## 🫁 1. Title            → a section (emoji + number + title)
 *   ### / 🎬 … / "A. …"       → a scenario sub-heading inside a section
 *   "المثال الحي: …"           → a STORY block (the real-world metaphor)
 *   "طبياً: …"                 → a CLINICAL block (the medical translation)
 *   "النتيجة: …"               → a RESULT block (the section's mental anchor)
 *   🚨 … / Piège / QCM         → an exam-trap section
 *   🎯 … / Takeaway / الخلاصة  → the final take-away
 *
 * Nothing is ever dropped or invented: every line of the source ends up in
 * exactly one block, in its original order. Text before the first section
 * becomes an intro block. If no section structure is found at all, the
 * caller falls back to plain Markdown rendering.
 */

export type BlockType = "story" | "clinical" | "body" | "result" | "subheading";
export type SectionKind = "concept" | "trap" | "exam" | "takeaway";

export interface AnalogyBlock {
  type: BlockType;
  /** Markdown with the leading label ("المثال الحي:", "طبياً:", …) removed. */
  markdown: string;
}

export interface AnalogySection {
  id: string;
  number: string | null;
  emoji: string | null;
  title: string;
  kind: SectionKind;
  blocks: AnalogyBlock[];
  /** Text of the section's last RESULT block (shown as its mental anchor), or null — never synthesized. */
  anchor: string | null;
  /** The section's original Markdown (for "copy"). */
  raw: string;
}

export interface ParsedAnalogies {
  intro: string | null;
  sections: AnalogySection[];
  /** Dominant script: Darija (Arabic letters) vs a Latin-script generation (e.g. English). */
  rtl: boolean;
}

const EMOJI_PREFIX = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍(?:\p{Extended_Pictographic}))*\s*)+/u;
const NUMBERED_TITLE = /^(\d{1,2})\s*[.)\-–:]\s*(.+)$/u;

const STORY_LABEL = /^(?:\*\*|__)?\s*(?:المثال\s*الحي|المثال|مثال\s*حي|التشبيه|Analogie|Analogy|Real[-\s]?life\s+example|Exemple\s+concret|Exemple\s+vivant)\s*(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*/iu;
const CLINICAL_LABEL = /^(?:\*\*|__)?\s*(?:طبياً|طبيا|طبّياً|من\s+الناحية\s+الطبية|Médicalement|Medically|Cliniquement|Clinically|En\s+clinique)\s*(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*/iu;
const RESULT_LABEL = /^(?:\*\*|__)?\s*(?:النتيجة|الخلاصة|Résultat|Result|Bottom\s+line|À\s+retenir)\s*(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*/iu;

// 🚨 alone is NOT enough: the reference example also uses it for an ordinary
// definition section ("🚨 2. واش هي La Pleurésie؟"). A trap section names itself.
const TRAP_TITLE = /pi[eè]ge|\bqcm\b|سؤال\s*امتحان|امتحانات|امتحان|فخ|\btrap\b|exam\s+question/iu;
const TAKEAWAY_TITLE = /🎯|takeaway|take-away|à\s+retenir|key\s+message/iu;
const EXAM_TITLE = /🩺|examen\s+clinique|الفحص|clinical\s+exam/iu;

function stripHeadingMarks(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").replace(/^\*\*(.+)\*\*$/, "$1").trim();
}

function splitEmoji(text: string): { emoji: string | null; rest: string } {
  const match = text.match(EMOJI_PREFIX);
  if (!match) return { emoji: null, rest: text };
  return { emoji: match[0].trim(), rest: text.slice(match[0].length).trim() };
}

/** A line that opens a new numbered section: a Markdown heading (levels 1-2), or an emoji + number line. */
function sectionHeading(line: string): { emoji: string | null; number: string | null; title: string } | null {
  const trimmed = line.trim();
  const isHeading = /^#{1,2}\s+\S/.test(trimmed);
  const text = stripHeadingMarks(trimmed);
  const { emoji, rest } = splitEmoji(text);
  const numbered = rest.match(NUMBERED_TITLE);
  if (isHeading) {
    return numbered ? { emoji, number: numbered[1], title: numbered[2].trim() } : { emoji, number: null, title: rest || text };
  }
  // Plain-text section titles (the reference example's own style) must carry
  // an emoji AND a number, so an ordinary "1. item" list line never splits a section.
  if (emoji && numbered && rest.length < 160) return { emoji, number: numbered[1], title: numbered[2].trim() };
  return null;
}

/** A scenario sub-heading inside a section: ### heading, a 🎬-style emoji line, or "A. Title" / "B) Title". */
function isSubheading(line: string): boolean {
  const trimmed = line.trim();
  if (/^#{3,6}\s+\S/.test(trimmed)) return true;
  if (trimmed.length > 140 || /^[-*+]\s/.test(trimmed)) return false;
  const { emoji, rest } = splitEmoji(stripHeadingMarks(trimmed));
  if (emoji && rest.length > 0 && !/[.!؟?]$/.test(rest) && !STORY_LABEL.test(rest) && !CLINICAL_LABEL.test(rest)) return true;
  return /^(?:\*\*)?[A-H]\s*[.)]\s+\S.{0,120}$/u.test(trimmed) && !/[.!؟?]$/.test(trimmed.replace(/\*\*$/, ""));
}

function classifyParagraph(paragraph: string): AnalogyBlock {
  const firstLine = paragraph.trimStart();
  if (STORY_LABEL.test(firstLine)) return { type: "story", markdown: firstLine.replace(STORY_LABEL, "") };
  if (CLINICAL_LABEL.test(firstLine)) return { type: "clinical", markdown: firstLine.replace(CLINICAL_LABEL, "") };
  if (RESULT_LABEL.test(firstLine)) return { type: "result", markdown: firstLine.replace(RESULT_LABEL, "") };
  return { type: "body", markdown: paragraph };
}

// The reference style chains the layers INSIDE one paragraph:
// "المثال الحي: … طبياً: … النتيجة: …". A clinical/result label that opens a
// new sentence starts a new block, so the story, its medical translation and
// the take-away land in their own cards.
const INLINE_LAYER_LABEL = /(?<=[.!?؟…»"”)]\s+)(?=(?:\*\*|__)?\s*(?:طبياً|طبيا|طبّياً|Médicalement|Medically|Cliniquement|Clinically|النتيجة|Résultat|Result|Bottom\s+line)\s*(?:\*\*|__)?\s*[:：])/gu;

function classifyParagraphs(paragraph: string): AnalogyBlock[] {
  // Lists and tables stay whole: their lines must not be cut mid-structure.
  if (/^\s*([-*+]\s|\d+[.)]\s|\|)/m.test(paragraph)) return [classifyParagraph(paragraph)];
  return paragraph
    .split(INLINE_LAYER_LABEL)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(classifyParagraph);
}

/** Splits on blank lines, but keeps a list (or table) together with the paragraph it belongs to. */
function paragraphsOf(lines: string[]): string[] {
  const out: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const text = current.join("\n").trim();
    if (text) out.push(text);
    current = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      const next = lines.slice(i + 1).find((l) => l.trim());
      const continuesBlock = next !== undefined && /^\s*([-*+]\s|\d+[.)]\s|\|)/.test(next) && current.length > 0 && /^\s*([-*+]\s|\d+[.)]\s|\|)/.test(current[current.length - 1]);
      if (!continuesBlock) flush();
      continue;
    }
    // A label at the start of a line always opens its own block.
    if (current.length > 0 && (STORY_LABEL.test(line.trim()) || CLINICAL_LABEL.test(line.trim()) || RESULT_LABEL.test(line.trim()))) flush();
    current.push(line);
  }
  flush();
  return out;
}

function sectionKind(title: string, emoji: string | null, isLast: boolean): SectionKind {
  const probe = `${emoji ?? ""} ${title}`;
  if (TAKEAWAY_TITLE.test(probe) || (isLast && /الخلاصة|synthèse|summary/iu.test(title) && !EXAM_TITLE.test(probe))) return "takeaway";
  if (TRAP_TITLE.test(probe)) return "trap";
  if (EXAM_TITLE.test(probe)) return "exam";
  return "concept";
}

/** Markdown → plain text (for the anchor pill, the table view and "copy"). */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseAnalogies(markdown: string): ParsedAnalogies {
  const source = markdown.replace(/\r\n/g, "\n");
  const arabicLetters = (source.match(/[؀-ۿ]/g) ?? []).length;
  const latinLetters = (source.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  const rtl = arabicLetters > 0 && arabicLetters / Math.max(1, arabicLetters + latinLetters) > 0.3;

  const lines = source.split("\n");
  const introLines: string[] = [];
  const raw: { heading: { emoji: string | null; number: string | null; title: string }; lines: string[]; headingLine: string }[] = [];
  for (const line of lines) {
    const heading = sectionHeading(line);
    if (heading) {
      raw.push({ heading, lines: [], headingLine: line });
      continue;
    }
    if (raw.length === 0) introLines.push(line);
    else raw[raw.length - 1].lines.push(line);
  }

  const sections: AnalogySection[] = raw.map((entry, index) => {
    const blocks: AnalogyBlock[] = [];
    let buffer: string[] = [];
    const flushBuffer = () => {
      for (const paragraph of paragraphsOf(buffer)) blocks.push(...classifyParagraphs(paragraph));
      buffer = [];
    };
    for (const line of entry.lines) {
      if (isSubheading(line)) {
        flushBuffer();
        blocks.push({ type: "subheading", markdown: stripHeadingMarks(line.trim()) });
      } else {
        buffer.push(line);
      }
    }
    flushBuffer();

    // A single result line IS the section's take-away; several (one per
    // scenario, e.g. Transudat vs Exsudat) are parallel facts — none of them
    // summarizes the section, so they all stay inline and no anchor is shown.
    const results = blocks.filter((block) => block.type === "result");
    const lastResult = results.length === 1 ? results[0] : undefined;
    const isLast = index === raw.length - 1;
    return {
      id: `analogy-${index + 1}`,
      number: entry.heading.number,
      emoji: entry.heading.emoji,
      title: entry.heading.title,
      kind: sectionKind(entry.heading.title, entry.heading.emoji, isLast),
      blocks,
      anchor: lastResult ? plainText(lastResult.markdown) : null,
      raw: [entry.headingLine, ...entry.lines].join("\n").trim(),
    };
  });

  const intro = introLines.join("\n").trim();
  return { intro: intro || null, sections, rtl };
}
