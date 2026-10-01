"use client";

import { Component, forwardRef, memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

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

const LIVE_REHYPE_PLUGINS: Options["rehypePlugins"] = [rehypeWordFade];
const REMARK_PLUGINS: Options["remarkPlugins"] = [remarkGfm];

// --- Element overrides ---------------------------------------------------------

// dir="auto" on every block: a single reply commonly mixes French with an
// Arabic/Darija clarification, so each block resolves its OWN direction.
const MARKDOWN_COMPONENTS: Options["components"] = {
  p: ({ children }) => <p dir="auto" className="animate-in fade-in duration-300">{children}</p>,
  li: ({ children }) => <li dir="auto" className="animate-in fade-in duration-300">{children}</li>,
  h1: ({ children }) => <h1 dir="auto" className="animate-in fade-in duration-300">{children}</h1>,
  h2: ({ children }) => <h2 dir="auto" className="animate-in fade-in duration-300">{children}</h2>,
  h3: ({ children }) => <h3 dir="auto" className="animate-in fade-in duration-300">{children}</h3>,
  h4: ({ children }) => <h4 dir="auto" className="animate-in fade-in duration-300">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote dir="auto" className="animate-in fade-in border-l-emerald-400 duration-300 dark:border-l-emerald-500/60">
      {children}
    </blockquote>
  ),
  // The wrapper scrolls, not the page: overscroll-x-contain stops a table
  // swipe from chaining into the thread, and the table itself only widens as
  // far as its columns need (min-w on cells) before the wrapper takes over.
  table: ({ children }) => (
    <div className="my-3 w-full max-w-full animate-in fade-in overflow-x-auto overscroll-x-contain rounded-xl border border-border duration-300">
      <table className="min-w-full border-collapse text-left text-[14.5px] leading-snug">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-emerald-50 dark:bg-emerald-950/40">{children}</thead>,
  th: ({ children }) => (
    <th dir="auto" className="min-w-[7rem] border-b border-border px-3 py-2.5 font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td dir="auto" className="min-w-[7rem] border-b border-border/60 px-3 py-2.5 align-top text-foreground/80 last:border-b-0">
      {children}
    </td>
  ),
  tr: ({ children }) => <tr className="even:bg-muted/40">{children}</tr>,
  pre: ({ children }) => (
    <pre className="my-3 max-w-full overflow-x-auto overscroll-x-contain rounded-xl bg-muted/60 p-3.5 text-[13.5px] leading-relaxed">{children}</pre>
  ),
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
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={live ? LIVE_REHYPE_PLUGINS : undefined} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </MarkdownErrorBoundary>
  );
});

// --- Public component --------------------------------------------------------------

// Sizing notes:
//  - text-[16px] (an arbitrary value, so app/globals.css's mobile bump of
//    `.text-sm`/`.text-base` doesn't apply) with a 1.72 line-height: the
//    comfortable measure for long clinical paragraphs on a phone.
//  - No prose-{size} modifier on purpose — Typography scales headings and
//    spacing in `em` from the container's own font-size, so one font-size
//    here tunes the whole scale at once.
//  - Explicit text colors (slate-800 / zinc-200) instead of text-foreground:
//    that token is a utility-layer class that beats prose's own body color
//    and was overriding prose-invert's calmer dark-mode tone.
//  - break-words (not overflow-wrap:anywhere): `anywhere` shrinks min-content
//    and would squash table columns; break-word only breaks an unbreakable
//    string that would otherwise overflow.
//  - min-w-0/max-w-full/w-full so no long token can ever widen the thread.
const PROSE_CLASSES =
  "prose w-full min-w-0 max-w-full break-words text-[16px] leading-[1.72] text-slate-800 dark:prose-invert dark:text-zinc-200 " +
  "prose-headings:font-heading prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-slate-900 dark:prose-headings:text-zinc-50 " +
  "prose-h1:text-[1.35em] prose-h2:text-[1.2em] prose-h3:mb-2 prose-h3:mt-5 prose-h3:text-[1.08em] prose-h4:mb-1.5 prose-h4:mt-4 prose-h4:text-[1em] " +
  "prose-p:my-2.5 prose-strong:font-semibold prose-strong:text-cyan-700 dark:prose-strong:text-cyan-300 " +
  "prose-ul:my-2.5 prose-ul:space-y-1.5 prose-ol:my-2.5 prose-ol:space-y-1.5 prose-li:pl-1 marker:text-cyan-500 dark:marker:text-cyan-400 " +
  "prose-code:break-words prose-code:text-foreground prose-a:text-emerald-600 dark:prose-a:text-emerald-400 " +
  "dark:[&_strong]:[text-shadow:0_0_14px_rgba(34,211,238,0.35)] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

export const StreamedMarkdown = forwardRef<HTMLDivElement, { content: string; isStreaming?: boolean }>(function StreamedMarkdown(
  { content, isStreaming = false },
  ref
) {
  const blocks = useMemo(() => splitIntoBlocks(content ?? ""), [content]);
  return (
    <div ref={ref} dir="auto" className={PROSE_CLASSES}>
      {blocks.map((block, index) => (
        <MarkdownBlock key={index} text={block} live={isStreaming && index === blocks.length - 1} />
      ))}
    </div>
  );
});
