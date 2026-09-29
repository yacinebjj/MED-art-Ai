import type { Components } from "react-markdown";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Medium-article treatment (product ask: AI-generated long-form content —
 * Explication, Exemples & Analogies, chat replies — read as "one big ass
 * article" that overwhelms students, especially on a phone). Two structural
 * changes from the previous "flashy gradient hero text, full-bleed width"
 * look, on top of the same sans-serif (Inter, via `font-sans` — never
 * inherited by accident, stated explicitly here) this app already uses
 * everywhere:
 *  1. A real reading measure: `max-w-none` on mobile (a narrow phone screen
 *     already IS a comfortable line length, no constraint needed) but capped
 *     to ~75 characters/line from `md:` up — the previous `max-w-none` at
 *     every breakpoint let a line stretch the FULL width of a wide desktop
 *     Studio panel, which is the single biggest reason dense prose reads as
 *     an intimidating wall of text rather than a real article.
 *  2. Formal, SMALL, single-color titles instead of a large rainbow
 *     gradient-clipped h1/h2 — h2 additionally gets a left accent bar + a
 *     top rule + real top margin, so every new "## Chapitre" reads as a
 *     genuine new section a student can visually latch onto while
 *     scrolling/skimming, not just another paragraph in an undifferentiated
 *     scroll.
 */
export const PROSE_CLASSES = [
  "prose prose-slate font-sans prose-lg md:prose-xl max-w-none md:max-w-[75ch] md:mx-auto",
  "prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-slate-900",
  "prose-h1:text-2xl prose-h1:font-bold prose-h1:pb-4 prose-h1:mb-8 prose-h1:border-b prose-h1:border-b-slate-200",
  "prose-h2:text-xl prose-h2:mt-14 prose-h2:border-t prose-h2:border-t-slate-200 prose-h2:pt-8 prose-h2:pl-4 prose-h2:border-l-4 prose-h2:border-l-emerald-500",
  "prose-h3:text-lg prose-h3:text-indigo-600 prose-h3:mt-8",
  "prose-a:text-blue-600",
  "prose-p:leading-[1.85] prose-li:leading-[1.85] prose-p:my-5",
  "prose-ul:list-none prose-ul:pl-0 prose-ol:list-none prose-ol:pl-0",
  "[&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none",
  "prose-th:bg-blue-600 prose-th:text-white prose-th:font-semibold prose-th:p-3 prose-th:text-left",
  "prose-td:p-3 prose-td:border-t prose-td:border-slate-200 prose-td:align-top",
  "[&_tbody_tr:nth-child(even)]:bg-slate-50",
  "prose-hr:border-t-2 prose-hr:border-blue-100",
].join(" ");

export const DARK_PROSE_CLASSES = [
  "prose prose-invert font-sans prose-lg md:prose-xl max-w-none md:max-w-[75ch] md:mx-auto",
  "prose-headings:font-semibold prose-headings:tracking-tight",
  "prose-p:leading-[1.85] prose-li:leading-[1.85] prose-p:my-5",
  "prose-h1:text-2xl prose-h1:font-bold prose-h1:pb-4 prose-h1:mb-8 prose-h1:border-b prose-h1:border-b-white/10",
  "prose-h2:text-xl prose-h2:mt-14 prose-h2:border-t prose-h2:border-t-white/10 prose-h2:pt-8 prose-h2:pl-4 prose-h2:border-l-4 prose-h2:border-l-emerald-400",
  "prose-h3:text-lg prose-h3:text-cyan-300 prose-h3:mt-8",
  "prose-a:text-cyan-400",
  "prose-ul:list-none prose-ul:pl-0 prose-ol:list-none prose-ol:pl-0",
  "[&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none",
  "prose-th:bg-cyan-600/70 prose-th:text-white prose-th:font-semibold prose-th:p-3 prose-th:text-left",
  "prose-td:p-3 prose-td:border-t prose-td:border-white/10 prose-td:align-top",
  "[&_tbody_tr:nth-child(even)]:bg-white/[0.03]",
  "prose-hr:border-t-2 prose-hr:border-white/10",
].join(" ");

export function normalizeCallouts(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*)(>{1,3})\s?(.*)$/);
      if (!m) return line;
      const [, indent, level, rest] = m;
      if (level.length === 3) return `${indent}> 🔴 ${rest}`;
      if (level.length === 2) return `${indent}> 🟢 ${rest}`;
      return `${indent}> ${rest}`;
    })
    .join("\n");
}

type CalloutTone = "blue" | "emerald" | "amber" | "rose";

const CALLOUT_STYLES: Record<CalloutTone, string> = {
  blue: "border-l-4 border-blue-500 bg-blue-50 text-slate-800",
  emerald: "border-l-4 border-emerald-500 bg-emerald-50 text-slate-800",
  amber: "border-l-4 border-amber-500 bg-amber-50 text-slate-800",
  rose: "border-l-4 border-rose-500 bg-rose-50 text-slate-800",
};

const DARK_CALLOUT_STYLES: Record<CalloutTone, string> = {
  blue: "border-l-4 border-cyan-400 bg-cyan-500/10 text-slate-100",
  emerald: "border-l-4 border-emerald-400 bg-emerald-500/10 text-slate-100",
  amber: "border-l-4 border-amber-400 bg-amber-500/10 text-slate-100",
  rose: "border-l-4 border-rose-400 bg-rose-500/10 text-slate-100",
};

const BADGE_CLASSES = {
  light: "font-bold text-primary-700",
  dark: "font-bold text-primary-400",
};

const LIST_ICON_CLASSES = {
  light: "mt-1 h-4 w-4 shrink-0 text-emerald-600",
  dark: "mt-1 h-4 w-4 shrink-0 text-emerald-400",
};

function hastText(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] } | null;
  if (!n) return "";
  if (n.type === "text") return n.value ?? "";
  if (Array.isArray(n.children)) return n.children.map(hastText).join("");
  return "";
}

function calloutTone(text: string): CalloutTone {
  if (text.includes("🔴")) return "rose";
  if (text.includes("🟡")) return "amber";
  if (text.includes("🟢")) return "emerald";
  if (text.includes("🔵")) return "blue";
  if (/[؀-ۿ]/.test(text)) return "emerald";
  if (/astuce du prof/i.test(text)) return "amber";
  if (/(attention|danger|red\s*flag|jamais|interdit|urgence vitale|mortel|risque vital)/i.test(text)) {
    return "rose";
  }
  return "blue";
}

function createMarkdownComponents(
  calloutStyles: Record<CalloutTone, string>,
  tableWrapperClass: string,
  badgeClass: string,
  listIconClass: string
): Components {
  return {
    blockquote: ({ node, children }) => {
      const tone = calloutTone(hastText(node));
      return (
        <blockquote
          className={`my-5 rounded-r-lg px-5 py-3 font-normal not-italic shadow-sm ${calloutStyles[tone]}`}
        >
          {children}
        </blockquote>
      );
    },
    table: ({ children }) => (
      <div className={cn("my-6 overflow-x-auto rounded-lg border shadow-sm", tableWrapperClass)}>
        <table className="m-0 w-full">{children}</table>
      </div>
    ),
    strong: ({ children }) => <strong className={badgeClass}>{children}</strong>,
    li: ({ children }) => (
      <li className="flex items-start gap-2 py-1">
        <CheckCircle2 className={listIconClass} />
        <span className="min-w-0">{children}</span>
      </li>
    ),
    // Highlights are rehydrated once, imperatively, against the real DOM by
    // StudioPanel's own effect (lib/highlight.ts's rangeFromOffsets/
    // restoreHighlightBySubstring) — NOT here. This renderer used to also
    // re-highlight matching substrings on every single paragraph render by
    // reading localStorage mid-render (impure, and reading
    // window.location.pathname to guess the slug), which raced/duplicated
    // against that DOM-level pass and could wrap the same phrase twice.
    p: ({ children }) => <p className="leading-relaxed my-6">{children}</p>,
  };
}

export const MARKDOWN_COMPONENTS: Components = createMarkdownComponents(
  CALLOUT_STYLES,
  "border-slate-200",
  BADGE_CLASSES.light,
  LIST_ICON_CLASSES.light
);

export const DARK_MARKDOWN_COMPONENTS: Components = createMarkdownComponents(
  DARK_CALLOUT_STYLES,
  "border-white/10",
  BADGE_CLASSES.dark,
  LIST_ICON_CLASSES.dark
);

/**
 * Lighter-weight prose for the CHAT surface only — same Inter (`font-sans`),
 * but tuned to read as a clean, compact CONVERSATION instead of the long-form
 * "medical journal" treatment PROSE_CLASSES gives Explication/Studio. The
 * journal look (a 75-character measure that centers a narrow column inside
 * the chat, oversized `## ` section headings with a top rule + left accent
 * bar + `mt-14`, and `my-6` paragraph gaps) is exactly what made a chat reply
 * read as a dense wall of blocks rather than a message. Here: full width,
 * modest headings, tight-but-airy vertical rhythm, and normal list bullets
 * (not the forced ✓-icon-per-item study styling). Callouts/tables/bold keep
 * their identity via CHAT_MARKDOWN_COMPONENTS below.
 */
export const CHAT_PROSE_CLASSES = [
  "prose prose-slate font-sans prose-sm md:prose-base max-w-none",
  "prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-slate-900",
  "prose-h1:text-lg prose-h1:mt-0 prose-h1:mb-2",
  "prose-h2:text-base prose-h2:mt-5 prose-h2:mb-2",
  "prose-h3:text-sm prose-h3:mt-4 prose-h3:mb-1.5 prose-h3:text-slate-700",
  "prose-p:my-2.5 prose-p:leading-[1.7]",
  "prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-li:leading-[1.7]",
  "prose-a:font-medium prose-a:text-blue-600",
  "prose-strong:font-semibold prose-strong:text-slate-900",
  "prose-hr:my-4 prose-hr:border-slate-200",
  "prose-th:bg-slate-100 prose-th:text-slate-900 prose-th:font-semibold prose-th:p-2 prose-th:text-left",
  "prose-td:p-2 prose-td:border-t prose-td:border-slate-200 prose-td:align-top",
].join(" ");

export const DARK_CHAT_PROSE_CLASSES = [
  "prose prose-invert font-sans prose-sm md:prose-base max-w-none",
  "prose-headings:font-semibold prose-headings:tracking-tight",
  "prose-h1:text-lg prose-h1:mt-0 prose-h1:mb-2",
  "prose-h2:text-base prose-h2:mt-5 prose-h2:mb-2",
  "prose-h3:text-sm prose-h3:mt-4 prose-h3:mb-1.5 prose-h3:text-cyan-300",
  "prose-p:my-2.5 prose-p:leading-[1.7]",
  "prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-li:leading-[1.7]",
  "prose-a:font-medium prose-a:text-cyan-400",
  "prose-strong:font-semibold",
  "prose-hr:my-4 prose-hr:border-white/10",
  "prose-th:bg-white/10 prose-th:font-semibold prose-th:p-2 prose-th:text-left",
  "prose-td:p-2 prose-td:border-t prose-td:border-white/10 prose-td:align-top",
].join(" ");

/**
 * Chat's own markdown renderers: keep the colored callout blockquotes, table
 * frame and bold-term badges (real signal in a medical reply), but DROP the
 * per-list-item ✓ icon and the heavy `my-6` paragraph override that
 * createMarkdownComponents forces — those belong to the long-form study
 * surfaces, not a conversation. Everything else falls through to
 * CHAT_PROSE_CLASSES' own compact spacing (normal bullets included).
 */
function createChatMarkdownComponents(
  calloutStyles: Record<CalloutTone, string>,
  tableWrapperClass: string,
  badgeClass: string
): Components {
  return {
    blockquote: ({ node, children }) => {
      const tone = calloutTone(hastText(node));
      return (
        <blockquote className={`my-3 rounded-r-lg px-4 py-2.5 font-normal not-italic shadow-sm ${calloutStyles[tone]}`}>
          {children}
        </blockquote>
      );
    },
    table: ({ children }) => (
      <div className={cn("my-4 overflow-x-auto rounded-lg border shadow-sm", tableWrapperClass)}>
        <table className="m-0 w-full text-sm">{children}</table>
      </div>
    ),
    strong: ({ children }) => <strong className={badgeClass}>{children}</strong>,
  };
}

export const CHAT_MARKDOWN_COMPONENTS: Components = createChatMarkdownComponents(
  CALLOUT_STYLES,
  "border-slate-200",
  BADGE_CLASSES.light
);

export const DARK_CHAT_MARKDOWN_COMPONENTS: Components = createChatMarkdownComponents(
  DARK_CALLOUT_STYLES,
  "border-white/10",
  BADGE_CLASSES.dark
);