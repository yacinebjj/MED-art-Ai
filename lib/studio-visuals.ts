/**
 * Studio visuals — product order 2026-11-12 ("Code Red: Studio prompts").
 * Besides its text, an Explication may carry two visual aids that cost $0:
 *
 *  - Mermaid flowcharts, as standard ```mermaid fenced blocks (graph TD),
 *    drawn in the browser by components/reader/MermaidDiagram.tsx;
 *  - <FreeMedImage query="…" /> tags: a real picture found by MedArt's free
 *    repository engine (lib/medical-image-engine.ts, no AI, no paid key),
 *    shown by components/studio/FreeMedImage.tsx.
 *
 * Pure, dependency-free helpers shared by the renderer
 * (components/reader/MedicalMarkdown.tsx), the generation pipeline
 * (lib/studio-explication-delta.ts) and the plain-text surfaces that must
 * never show the raw markup (a quiz's concept excerpt, chat citations).
 *
 * Raw HTML is still never rendered: react-markdown drops it, and only the
 * exact FreeMedImage tag is turned into our own component.
 */

/** Longest picture query kept — a search phrase, never a paragraph. */
export const MAX_FREE_MED_IMAGE_QUERY_CHARS = 120;

/**
 * One FreeMedImage tag. The query may sit in straight, single, French or
 * curly quotes, with backslash-escaped straight quotes (a JSON-escaped tag
 * that reached the text undecoded); self-closing or followed by its closing
 * tag.
 */
const TAG_PATTERN = String.raw`<FreeMedImage\b[^>]*?\bquery\s*=\s*(?:\\?"([^"\\<>]{1,200})\\?"|'([^'\\<>]{1,200})'|«\s*([^»<>]{1,200}?)\s*»|“([^”<>]{1,200})”)[^>]*>(?:\s*<\/FreeMedImage\s*>)?`;
const WHOLE_TAG_RE = new RegExp(`^${TAG_PATTERN}$`, "i");
const ANY_TAG_RE = new RegExp(TAG_PATTERN, "gi");
const CLOSING_TAG_RE = /^<\/FreeMedImage\s*>$/i;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

function cleanQuery(raw: string): string | null {
  const query = raw.replace(/\s+/g, " ").trim().slice(0, MAX_FREE_MED_IMAGE_QUERY_CHARS).trim();
  return query.length >= 2 ? query : null;
}

/** The query of `html` when it is exactly one FreeMedImage tag (surrounding whitespace aside), else null. */
export function freeMedImageQuery(html: string): string | null {
  const match = html.trim().match(WHOLE_TAG_RE);
  if (!match) return null;
  return cleanQuery(match[1] ?? match[2] ?? match[3] ?? match[4] ?? "");
}

/**
 * Puts a blank line before and after every line that holds nothing but a
 * FreeMedImage tag (outside code blocks). Markdown only reads a line as its
 * own HTML block after a blank line, and such a block runs on until the next
 * blank line — without this, the text right under a tag would be swallowed
 * into the tag's block and dropped with it. A tag in the middle of a
 * sentence, a table cell or a quote stays where it is (inline). Text without
 * a tag comes back unchanged.
 */
export function isolateFreeMedImageTags(markdown: string): string {
  if (!/<FreeMedImage\b/i.test(markdown)) return markdown;
  const lines = markdown.split("\n");
  const out: string[] = [];
  let fence: { char: string; length: number } | null = null;
  let needBlankAfter = false;
  for (const line of lines) {
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) fence = { char: marker[0], length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length && line.trim() === marker) fence = null;
    }
    const isTagLine = fence === null && !fenceMatch && WHOLE_TAG_RE.test(line.trim());
    if (needBlankAfter && line.trim() !== "") out.push("");
    needBlankAfter = false;
    if (isTagLine) {
      if (out.length > 0 && out[out.length - 1].trim() !== "") out.push("");
      out.push(line);
      needBlankAfter = true;
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

/** A Markdown tree node, as far as the plugin below needs it. */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

function replaceTags(node: MdNode): void {
  if (!Array.isArray(node.children)) return;
  const kept: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "html" && typeof child.value === "string") {
      const value = child.value.trim();
      // A stray closing tag (its opening tag already became a picture): nothing to show.
      if (CLOSING_TAG_RE.test(value)) continue;
      const query = freeMedImageQuery(value);
      if (query) {
        kept.push({ type: "freeMedImage", data: { hName: "freemedimage", hProperties: { query } } });
        continue;
      }
    }
    replaceTags(child);
    kept.push(child);
  }
  node.children = kept;
}

/**
 * remark plugin: every FreeMedImage tag (a block on its own line, or inline)
 * becomes a `freemedimage` element with its `query`, which the renderer maps
 * to <FreeMedImage>. Any other raw HTML is left as it was (react-markdown
 * drops it).
 */
export function remarkFreeMedImage() {
  return (tree: unknown) => {
    replaceTags(tree as MdNode);
  };
}

/** The language of a fenced code block's `className` list ("language-mermaid" → "mermaid"). */
export function isMermaidClassName(className: unknown): boolean {
  const names = Array.isArray(className) ? className : typeof className === "string" ? className.split(/\s+/) : [];
  return names.some((name) => typeof name === "string" && name.toLowerCase() === "language-mermaid");
}

// ─── Mermaid repair ──────────────────────────────────────────────────────

/** Node shapes, longest opener first: opener → closer. */
const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ["((", "))"],
  ["([", "])"],
  ["[[", "]]"],
  ["[(", ")]"],
  ["{{", "}}"],
  ["[", "]"],
  ["(", ")"],
  ["{", "}"],
  [">", "]"],
];
const ARROW_RE = /\s*(?:<?-{2,}>?|<?={2,}>?|-\.+->?|--[ox]|&)\s*/g;
const STATEMENT_RE = /^\s*(?:%%|style\b|classDef\b|class\b|linkStyle\b|click\b|subgraph\b|end\b|direction\b)/i;
/** Characters a bare label can't hold: Mermaid reads them as syntax. */
const LABEL_SYNTAX_RE = /[()[\]{}|;"<>#&]/;

function quoteLabel(label: string): string {
  const trimmed = label.trim();
  if (/^".*"$/.test(trimmed)) return label;
  if (!LABEL_SYNTAX_RE.test(trimmed)) return label;
  return `"${trimmed.replace(/"/g, "'")}"`;
}

/** Quotes the label of the node shape in one statement segment (the text between two arrows, after an edge label if any). */
function quoteNodes(segment: string): string {
  const edgeLabel = segment.match(/^(\s*\|[^|]*\|)([\s\S]*)$/);
  if (edgeLabel) return edgeLabel[1] + quoteNodes(edgeLabel[2]);
  const match = segment.match(/^(\s*[A-Za-z_][A-Za-z0-9_]*)([\s\S]*)$/);
  if (!match) return segment;
  const [, id, rest] = match;
  for (const [opener, closer] of SHAPES) {
    if (!rest.startsWith(opener)) continue;
    const end = rest.lastIndexOf(closer);
    if (end < opener.length) return segment;
    const label = rest.slice(opener.length, end);
    return `${id}${opener}${quoteLabel(label)}${closer}${rest.slice(end + closer.length)}`;
  }
  return segment;
}

/** Quotes an edge label (`-->|label|`) that holds syntax characters. */
function quoteEdgeLabels(line: string): string {
  return line.replace(/\|([^|"]+)\|/g, (whole, label: string) => (/[()[\]{};<>#&]/.test(label) ? `|"${label.trim()}"|` : whole));
}

/**
 * Best-effort fix for the usual ways a model's flowchart fails to parse: a
 * missing "graph TD" header, and node or edge labels holding parentheses,
 * brackets, quotes or other syntax characters (quoted, which Mermaid
 * accepts). Only tried after the original failed to parse
 * (components/reader/MermaidDiagram.tsx).
 */
export function repairMermaid(code: string): string {
  const lines = code.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  if (lines.length === 0) return "";
  const header = /^\s*(?:graph|flowchart)\b/i.test(lines[0]) ? lines.shift()! : "graph TD";
  const body = lines.map((line) => {
    if (line.trim() === "" || STATEMENT_RE.test(line)) return line;
    const withEdges = quoteEdgeLabels(line);
    // Split on arrows, keeping them, and fix each node statement between them.
    const parts = withEdges.split(new RegExp(`(${ARROW_RE.source})`, "g"));
    return parts.map((part, index) => (index % 2 === 0 ? quoteNodes(part) : part)).join("");
  });
  return [header.trim(), ...body].join("\n");
}

// ─── Plain-text surfaces ─────────────────────────────────────────────────

const MERMAID_FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*mermaid\b[^\n]*\n[\s\S]*?^[ \t]{0,3}\1[ \t]*$/gim;

/**
 * The text without its visual markup — every ```mermaid block and every
 * FreeMedImage tag removed — for surfaces that show an excerpt as plain
 * Markdown (a quiz's concept excerpt, chat citations). Text without either
 * comes back unchanged.
 */
export function stripStudioVisuals(markdown: string): string {
  if (!/<FreeMedImage\b|mermaid/i.test(markdown)) return markdown;
  return markdown
    .replace(MERMAID_FENCE_RE, "")
    .replace(ANY_TAG_RE, "")
    .replace(/<\/FreeMedImage\s*>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
}

// ─── Generation safety net ───────────────────────────────────────────────

/**
 * Escapes, in a model's raw JSON answer, the straight quotes the prompt asks
 * it to escape but that it sometimes writes bare: the quotes of a
 * FreeMedImage `query` attribute, and any quote inside a ```mermaid block.
 * Inside a valid JSON string both can only appear escaped, so a bare one is
 * always content, never structure — escaping it turns an unparsable answer
 * back into the JSON the model meant. Already-valid JSON comes back
 * unchanged, and so does any answer without either.
 */
export function repairStudioVisualJson(raw: string): string {
  if (!/<FreeMedImage\b|```mermaid/i.test(raw)) return raw;
  let text = raw.replace(/(<FreeMedImage\b[^>]*?\bquery\s*=\s*)"([^"\\<>]{1,200})"/gi, (_whole, before: string, query: string) => `${before}\\"${query}\\"`);
  // Mermaid blocks: from the opening fence to the next fence, every quote not preceded by a backslash.
  text = text.replace(/```mermaid[\s\S]*?```/gi, (block) => block.replace(/(^|[^\\])"/g, (_whole, before: string) => `${before}\\"`));
  return text;
}
