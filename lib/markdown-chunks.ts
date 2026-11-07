/**
 * Splits a long Markdown document into chunks that can each be rendered on
 * their own (components/reader/MedicalMarkdown.tsx renders a long lesson a
 * few chunks at a time instead of in one main-thread-blocking pass).
 *
 * Chunks only ever start at an ATX heading line (`#`…`######`) outside a
 * fenced code block. A heading always opens a new block in Markdown — no
 * paragraph, list or blockquote continues across it — so rendering the chunks
 * one after another gives exactly the HTML of the whole document. Sections
 * are then packed together up to about `targetChars`, and the chunks joined
 * with "\n" give back the original text, character for character.
 *
 * Pure (no imports), so it can be unit-tested on its own.
 */

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/;

export function splitMarkdownChunks(markdown: string, targetChars: number): string[] {
  if (!markdown) return [markdown];
  const lines = markdown.split("\n");
  const sections: string[] = [];
  let current: string[] = [];
  let fence: { char: string; length: number } | null = null;

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = { char: marker[0], length: marker.length };
      } else if (marker[0] === fence.char && marker.length >= fence.length && line.trim() === marker) {
        // A closing fence: same character, at least as long, nothing after it.
        fence = null;
      }
    } else if (fence === null && HEADING_RE.test(line) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  sections.push(current.join("\n"));

  const chunks: string[] = [];
  let buffer: string | null = null;
  for (const section of sections) {
    if (buffer === null) {
      buffer = section;
    } else if (buffer.length + 1 + section.length > targetChars) {
      chunks.push(buffer);
      buffer = section;
    } else {
      buffer = `${buffer}\n${section}`;
    }
  }
  if (buffer !== null) chunks.push(buffer);
  return chunks;
}
