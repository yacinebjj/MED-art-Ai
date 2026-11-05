"use client";

import { Component, forwardRef, memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cleanAssistantMarkdown, tidyLiveBlock } from "@/lib/assistant-markdown";
import { dominantDirection } from "@/lib/text-direction";

/**
 * Markdown renderer for assistant replies, built for streaming.
 *
 * Two things make a long, still-arriving answer cheap and lively:
 *
 * 1. BLOCK MEMOIZATION. The reply is split into top-level blocks (paragraphs,
 *    lists, tables, fenced code) and each block is its own memoized
 *    <ReactMarkdown>. While streaming, only the LAST block's text changes, so
 *    every earlier block skips parsing and rendering entirely instead of the
 *    whole answer being re-parsed on every frame.
 * 2. WORD FADE. Words of the live (last) block are wrapped in spans that fade
 *    in. React keys those spans by position, so a span that already exists is
 *    never re-mounted — only words that just arrived mount, and only they
 *    play the animation. Finished blocks render plain (no spans).
 */

// --- Block splitting ---------------------------------------------------------

/**
 * Splits markdown at blank lines that are OUTSIDE a fenced code block and
 * whose next line is not indented (an indented line after a blank is a
 * continuation of a list item or an indented block, and splitting there
 * would change how it parses). Trailing whitespace is trimmed from each
 * block so a finished block's string never changes again — which is what
 * lets React.memo skip it.
 */
export function splitIntoBlocks(text: string): string[] {
  if (!text.trim()) return [];
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fenceChar: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (fenceChar === null) fenceChar = fence[1][0];
      else if (fence[1][0] === fenceChar) fenceChar = null;
    }
    current.push(line);

    if (fenceChar === null && line.trim() === "") {
      let next = i + 1;
      while (next < lines.length && lines[next].trim() === "") next++;
      if (next < lines.length && !/^\s/.test(lines[next]) && current.some((l) => l.trim() !== "")) {
        blocks.push(current.join("\n").replace(/\s+$/, ""));
        current = [];
      }
    }
  }
  const rest = current.join("\n").replace(/\s+$/, "");
  if (rest) blocks.push(rest);
  return blocks;
}

// --- Word fade plugin ---------------------------------------------------------

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function wrapWords(node: HastNode, counter: { index: number }) {
  if (!node.children) return;
  // Code is shown as written — never wrapped or animated.
  if (node.type === "element" && (node.tagName === "pre" || node.tagName === "code")) return;

  const next: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value && /\S/.test(child.value)) {
      for (const part of child.value.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          next.push({ type: "text", value: part });
          continue;
        }
        // Small positional stagger so a burst of words arriving in one network
        // chunk ripples in rather than popping together. Existing spans never
        // re-run it (they keep their React identity), so it only affects new words.
        const delayMs = (counter.index++ % 8) * 22;
        next.push({
          type: "element",
          tagName: "span",
          properties: { className: ["stream-word"], style: `animation-delay:${delayMs}ms` },
          children: [{ type: "text", value: part }],
        });
      }
    } else {
      wrapWords(child, counter);
      next.push(child);
    }
  }
  node.children = next;
}

type RehypePlugin = NonNullable<Options["rehypePlugins"]>[number];

const rehypeWordFade: RehypePlugin = () => (tree: unknown) => {
  wrapWords(tree as HastNode, { index: 0 });
};

// --- Reading direction ---------------------------------------------------------

/** Blocks that get their own direction (lists and tables too, so their markers and columns follow). */
const DIRECTED_TAGS = new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "th", "td", "ul", "ol", "table"]);

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

function setDirections(node: HastNode) {
  for (const child of node.children ?? []) {
    if (child.type === "element" && child.tagName && DIRECTED_TAGS.has(child.tagName)) {
      const dir = dominantDirection(textOf(child));
      if (dir) child.properties = { ...(child.properties ?? {}), dir };
    }
    setDirections(child);
  }
}

/** Each block reads the way most of its letters do (lib/text-direction.ts): Arabic right to left, French left to right, whatever word it opens on. */
const rehypeDirection: RehypePlugin = () => (tree: unknown) => {
  setDirections(tree as HastNode);
};

const REHYPE_PLUGINS: Options["rehypePlugins"] = [rehypeDirection];
const LIVE_REHYPE_PLUGINS: Options["rehypePlugins"] = [rehypeDirection, rehypeWordFade];
const REMARK_PLUGINS: Options["remarkPlugins"] = [remarkGfm];

// --- Element overrides ---------------------------------------------------------

// Every block gets its own direction (rehypeDirection above): a single reply
// commonly mixes French with an Arabic/Darija clarification. dir="auto" is
// only the fallback for a block with no letters.
const MARKDOWN_COMPONENTS: Options["components"] = {
  p: ({ children, dir }) => <p dir={dir ?? "auto"} className="animate-in fade-in duration-300">{children}</p>,
  li: ({ children, dir }) => <li dir={dir ?? "auto"} className="animate-in fade-in duration-300">{children}</li>,
  h1: ({ children, dir }) => <h1 dir={dir ?? "auto"} className="animate-in fade-in duration-300">{children}</h1>,
  h2: ({ children, dir }) => <h2 dir={dir ?? "auto"} className="animate-in fade-in duration-300">{children}</h2>,
  h3: ({ children, dir }) => <h3 dir={dir ?? "auto"} className="animate-in fade-in duration-300">{children}</h3>,
  h4: ({ children, dir }) => <h4 dir={dir ?? "auto"} className="animate-in fade-in duration-300">{children}</h4>,
  // A quiet callout rather than a quotation: no italics, no added quote marks.
  // Logical sides, so an Arabic block puts its rule on the right.
  blockquote: ({ children, dir }) => (
    <blockquote
      dir={dir ?? "auto"}
      className="my-[0.7em] animate-in fade-in rounded-e-xl border-s-2 border-s-sky-400/80 bg-sky-500/[0.05] py-[0.4em] pe-[0.9em] ps-[1em] font-normal not-italic text-slate-700 duration-300 dark:border-s-sky-400/60 dark:bg-sky-400/[0.06] dark:text-zinc-300 [&>p:first-of-type]:before:content-none [&>p:last-of-type]:after:content-none [&>p]:my-[0.25em]"
    >
      {children}
    </blockquote>
  ),
  // The wrapper scrolls, not the page: overscroll-x-contain stops a table
  // swipe from chaining into the thread, and the table itself only widens as
  // far as its columns need (min-w on cells) before the wrapper takes over.
  table: ({ children, dir }) => (
    <div dir={dir} className="my-[0.75em] w-full max-w-full animate-in fade-in overflow-x-auto overscroll-x-contain rounded-xl border border-black/[0.07] duration-300 dark:border-white/[0.08]">
      <table className="my-0 min-w-full border-collapse text-start text-[13.5px] leading-[1.45] [font-variant-numeric:tabular-nums] [&_tbody>tr:last-child>td]:border-b-0">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-sky-50/80 dark:bg-sky-400/[0.06]">{children}</thead>,
  th: ({ children, dir }) => (
    <th dir={dir ?? "auto"} className="min-w-[7rem] border-b border-black/[0.07] px-3 py-2 text-[12.5px] font-semibold text-slate-900 dark:border-white/[0.08] dark:text-white">
      {children}
    </th>
  ),
  td: ({ children, dir }) => (
    <td dir={dir ?? "auto"} className="min-w-[7rem] border-b border-black/[0.05] px-3 py-2 align-top text-slate-700 dark:border-white/[0.06] dark:text-zinc-300">
      {children}
    </td>
  ),
  tr: ({ children }) => <tr className="even:bg-black/[0.025] dark:even:bg-white/[0.03]">{children}</tr>,
  pre: ({ node, children }) => {
    // Display formulas (```medart-formula, written by lib/assistant-markdown.ts) are a centred card, not code.
    const code = (node as unknown as HastNode | undefined)?.children?.[0];
    const classes = code?.properties?.className;
    if (Array.isArray(classes) && classes.includes("language-medart-formula")) {
      const formula = (code?.children ?? []).map((child) => child.value ?? "").join("").replace(/\n+$/, "");
      return (
        <div
          dir="ltr"
          className="my-[0.7em] overflow-x-auto overscroll-x-contain whitespace-pre-line rounded-xl border border-sky-500/15 bg-sky-500/[0.05] px-4 py-2.5 text-center text-[1em] font-medium leading-relaxed text-slate-900 [font-variant-numeric:tabular-nums] dark:border-sky-400/15 dark:bg-sky-400/[0.06] dark:text-white"
        >
          {formula}
        </div>
      );
    }
    return (
      <pre dir="ltr" className="my-[0.7em] max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-black/[0.06] bg-slate-50 p-3.5 text-[0.8125rem] leading-relaxed text-slate-800 dark:border-white/[0.07] dark:bg-white/[0.04] dark:text-zinc-200">
        {children}
      </pre>
    );
  },
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-words">
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} className="h-auto max-w-full rounded-lg" loading="lazy" />
  ),
};

// --- Error containment -----------------------------------------------------------

/**
 * Streaming a PARTIAL markdown chunk (an unclosed fence, a half-written table
 * row) can, on rare intermediate states, throw inside the parser itself — not
 * something this app's own code can prevent with null checks. A class Error
 * Boundary (React has no hook equivalent) catches that render exception and
 * falls back to the block's RAW text instead of taking the whole page down;
 * it retries automatically on the next chunk (getDerivedStateFromProps),
 * since the construct is very often valid again one token later. Now scoped
 * PER BLOCK, so one bad block no longer degrades the entire answer.
 */
class MarkdownErrorBoundary extends Component<{ content: string; children: ReactNode }, { hasError: boolean; lastContent: string }> {
  state = { hasError: false, lastContent: this.props.content };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  static getDerivedStateFromProps(props: { content: string }, state: { hasError: boolean; lastContent: string }) {
    if (props.content !== state.lastContent) return { hasError: false, lastContent: props.content };
    return null;
  }

  componentDidCatch(error: unknown) {
    console.error("[assistant] Rendu Markdown échoué sur ce bloc — repli sur texte brut (non bloquant) :", error);
  }

  render() {
    if (this.state.hasError) return <p dir="auto" className="whitespace-pre-wrap">{this.props.content}</p>;
    return this.props.children;
  }
}

const MarkdownBlock = memo(function MarkdownBlock({ text, live }: { text: string; live: boolean }) {
  return (
    <MarkdownErrorBoundary content={text}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={live ? LIVE_REHYPE_PLUGINS : REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </MarkdownErrorBoundary>
  );
});

// --- Public component --------------------------------------------------------------

// Sizing notes:
//  - 15px on phones and 16px from sm, with a 1.55 line-height: Gemini's
//    compact, dense measure. Written in rem (text-[0.9375rem]), not px:
//    app/globals.css's phone type scale lifts text-[15px] (and text-sm /
//    text-base) a step below md, which would undo the smaller size.
//  - No prose-{size} modifier on purpose — Typography scales headings and
//    spacing in `em` from the container's own font-size, so one font-size
//    here tunes the whole scale at once, and every gap below is in em too.
//  - Explicit text colors (slate-700 / zinc-300 for the body, slate-900 /
//    white for headings and key terms) instead of text-foreground: that token
//    is a utility-layer class that beats prose's own body color.
//  - Key terms are a calm semibold in the heading colour — no tint, no glow:
//    the replies bold a lot, and coloured, glowing bold made a page shout.
//  - Inline code loses the Typography plugin's literal backticks.
//  - break-words (not overflow-wrap:anywhere): `anywhere` shrinks min-content
//    and would squash table columns; break-word only breaks an unbreakable
//    string that would otherwise overflow.
//  - min-w-0/max-w-full/w-full so no long token can ever widen the thread.
const PROSE_CLASSES =
  "prose w-full min-w-0 max-w-full break-words text-[0.9375rem] leading-[1.55] text-slate-700 dark:prose-invert dark:text-zinc-300 sm:text-[16px] " +
  // Headings introduce, they don't shout: one weight, a little air above, almost none below.
  "prose-headings:text-balance prose-headings:font-semibold prose-headings:tracking-[-0.011em] prose-headings:text-slate-900 dark:prose-headings:text-white " +
  "prose-h1:mb-[0.4em] prose-h1:mt-[1.15em] prose-h1:text-[1.25em] prose-h1:leading-[1.3] " +
  "prose-h2:mb-[0.35em] prose-h2:mt-[1.1em] prose-h2:text-[1.15em] prose-h2:leading-[1.3] " +
  "prose-h3:mb-[0.3em] prose-h3:mt-[1em] prose-h3:text-[1.05em] prose-h3:leading-[1.35] " +
  "prose-h4:mb-[0.25em] prose-h4:mt-[0.9em] prose-h4:text-[1em] prose-h4:leading-[1.4] " +
  // Paragraphs and lists share one tight, even rhythm, and no line ends on an orphan word.
  "prose-p:my-[0.55em] prose-p:text-pretty prose-li:text-pretty " +
  "prose-ul:my-[0.5em] prose-ul:ps-[1.25em] prose-ol:my-[0.5em] prose-ol:ps-[1.4em] prose-li:my-[0.15em] prose-li:ps-[0.25em] " +
  "[&_li>p]:my-[0.15em] [&_li>ol]:my-[0.2em] [&_li>ul]:my-[0.2em] " +
  "marker:text-sky-500 dark:marker:text-sky-400 [&_ol>li]:marker:font-semibold " +
  "prose-strong:font-semibold prose-strong:text-slate-900 prose-em:text-inherit dark:prose-strong:text-white " +
  "prose-code:rounded-md prose-code:bg-black/[0.05] prose-code:px-[0.38em] prose-code:py-[0.12em] prose-code:text-[0.86em] prose-code:font-medium prose-code:text-slate-800 prose-code:before:content-none prose-code:after:content-none dark:prose-code:bg-white/[0.08] dark:prose-code:text-zinc-100 " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[1em] [&_pre_code]:font-normal " +
  "prose-a:font-medium prose-a:text-sky-600 prose-a:decoration-sky-500/40 prose-a:underline-offset-[3px] dark:prose-a:text-sky-400 " +
  "prose-hr:my-[1.1em] prose-hr:border-black/[0.07] dark:prose-hr:border-white/[0.08] " +
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

export const StreamedMarkdown = forwardRef<HTMLDivElement, { content: string; isStreaming?: boolean }>(function StreamedMarkdown(
  { content, isStreaming = false },
  ref
) {
  // LaTeX, stray HTML and near-miss Markdown made readable before anything is parsed (lib/assistant-markdown.ts).
  const cleaned = useMemo(() => cleanAssistantMarkdown(content ?? ""), [content]);
  const blocks = useMemo(() => splitIntoBlocks(cleaned), [cleaned]);
  const direction = useMemo(() => dominantDirection(cleaned) ?? "auto", [cleaned]);
  return (
    <div ref={ref} dir={direction} className={PROSE_CLASSES}>
      {blocks.map((block, index) => {
        const live = isStreaming && index === blocks.length - 1;
        return <MarkdownBlock key={index} text={live ? tidyLiveBlock(block) : block} live={live} />;
      })}
    </div>
  );
});
