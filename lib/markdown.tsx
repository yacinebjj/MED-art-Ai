import type { Components } from "react-markdown";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Rich, colored @tailwindcss/typography class set shared by every Markdown
 * reader (workspace CenterReader + the static demo page). Kept in one place so
 * the two stay visually identical.
 *
 * Blockquote colors are handled by the custom component below (not here), so
 * this string covers headings, bold, markers, tables and separators. It also
 * strips the plugin's default blockquote quotation marks.
 */
export const PROSE_CLASSES = [
  "prose prose-slate prose-lg max-w-none",
  // Headings — premium, color by importance, gradient-clip for h1/h2
  "prose-headings:font-bold prose-headings:tracking-tight",
  "prose-h1:bg-clip-text prose-h1:text-transparent prose-h1:bg-gradient-to-r prose-h1:from-cyan-600 prose-h1:to-emerald-600",
  "prose-h2:bg-clip-text prose-h2:text-transparent prose-h2:bg-gradient-to-r prose-h2:from-cyan-600 prose-h2:to-emerald-600",
  "prose-h3:text-indigo-600",
  "prose-a:text-blue-600",
  // List markers are replaced by custom icon bullets (see createMarkdownComponents)
  "prose-ul:list-none prose-ul:pl-0 prose-ol:list-none prose-ol:pl-0",
  // Kill the default open-/close-quote glyphs on blockquotes (component colors them)
  "[&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none",
  // Tables
  "prose-th:bg-blue-600 prose-th:text-white prose-th:font-semibold prose-th:p-3 prose-th:text-left",
  "prose-td:p-3 prose-td:border-t prose-td:border-slate-200 prose-td:align-top",
  "[&_tbody_tr:nth-child(even)]:bg-slate-50",
  // Horizontal separators
  "prose-hr:border-t-2 prose-hr:border-blue-100",
].join(" ");

/**
 * Dark-mode counterpart of PROSE_CLASSES for the "Clinical Midnight Aurora"
 * theme — a complete, independent class string (not layered on top of
 * PROSE_CLASSES) so there's no ambiguity in how conflicting utilities like
 * `prose-h2:text-*` resolve.
 */
export const DARK_PROSE_CLASSES = [
  "prose prose-invert prose-lg max-w-none",
  "prose-headings:font-bold prose-headings:tracking-wide",
  "prose-p:leading-relaxed prose-li:leading-relaxed",
  // Gradient headings for a premium, glowing feel against the dark canvas
  "prose-h1:bg-clip-text prose-h1:text-transparent prose-h1:bg-gradient-to-r prose-h1:from-cyan-400 prose-h1:to-emerald-400",
  "prose-h2:bg-clip-text prose-h2:text-transparent prose-h2:bg-gradient-to-r prose-h2:from-cyan-400 prose-h2:to-emerald-400",
  "prose-h3:text-cyan-300",
  "prose-a:text-cyan-400",
  // List markers are replaced by custom icon bullets (see createMarkdownComponents)
  "prose-ul:list-none prose-ul:pl-0 prose-ol:list-none prose-ol:pl-0",
  "[&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none",
  "prose-th:bg-cyan-600/70 prose-th:text-white prose-th:font-semibold prose-th:p-3 prose-th:text-left",
  "prose-td:p-3 prose-td:border-t prose-td:border-white/10 prose-td:align-top",
  "[&_tbody_tr:nth-child(even)]:bg-white/[0.03]",
  "prose-hr:border-t-2 prose-hr:border-white/10",
].join(" ");

/**
 * Turns the shorthand blockquote levels into single-level blockquotes tagged
 * with a colored-circle marker so they can be colored without nested-box bugs:
 *   >   ...  -> blue   (default note / physiopathologie)
 *   >>  ...  -> green  (résumé, point positif)
 *   >>> ...  -> red    (alerte, danger, red flag)
 * The colored circle also stays visible as a structural bullet.
 */
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

/** The four callout "tones" and their full literal Tailwind classes (literal so Tailwind's scanner picks them up). */
type CalloutTone = "blue" | "emerald" | "amber" | "rose";

const CALLOUT_STYLES: Record<CalloutTone, string> = {
  blue: "border-l-4 border-blue-500 bg-blue-50 text-slate-800",
  emerald: "border-l-4 border-emerald-500 bg-emerald-50 text-slate-800",
  amber: "border-l-4 border-amber-500 bg-amber-50 text-slate-800",
  rose: "border-l-4 border-rose-500 bg-rose-50 text-slate-800",
};

/** Same four tones, restyled as translucent glass chips for the dark Aurora theme. */
const DARK_CALLOUT_STYLES: Record<CalloutTone, string> = {
  blue: "border-l-4 border-cyan-400 bg-cyan-500/10 text-slate-100",
  emerald: "border-l-4 border-emerald-400 bg-emerald-500/10 text-slate-100",
  amber: "border-l-4 border-amber-400 bg-amber-500/10 text-slate-100",
  rose: "border-l-4 border-rose-400 bg-rose-500/10 text-slate-100",
};

/** Inline "keyword badge" pill styling for **bold** terms — literal so Tailwind's scanner picks it up. */
const BADGE_CLASSES = {
  light: "mx-0.5 inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-[0.85em] font-bold text-amber-700 align-middle",
  dark: "mx-0.5 inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[0.85em] font-bold text-amber-400 align-middle",
};

/** List-item bullet icon color — literal so Tailwind's scanner picks it up. */
const LIST_ICON_CLASSES = {
  light: "mt-1 h-4 w-4 shrink-0 text-emerald-600",
  dark: "mt-1 h-4 w-4 shrink-0 text-emerald-400",
};

/** Flattens a hast node subtree to its text so a blockquote can be classified by content. */
function hastText(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] } | null;
  if (!n) return "";
  if (n.type === "text") return n.value ?? "";
  if (Array.isArray(n.children)) return n.children.map(hastText).join("");
  return "";
}

/** Picks a callout color from the blockquote's own text — works for the static demo AND live AI output. */
function calloutTone(text: string): CalloutTone {
  if (text.includes("🔴")) return "rose";
  if (text.includes("🟡")) return "amber";
  if (text.includes("🟢")) return "emerald";
  if (text.includes("🔵")) return "blue";
  if (/[؀-ۿ]/.test(text)) return "emerald"; // Arabic memory anchor
  if (/astuce du prof/i.test(text)) return "amber";
  if (/(attention|danger|red\s*flag|jamais|interdit|urgence vitale|mortel|risque vital)/i.test(text)) {
    return "rose";
  }
  return "blue";
}

/**
 * ReactMarkdown element overrides:
 * - blockquote: colored callout box, tone chosen from its content.
 * - table: wrapped in a rounded, horizontally-scrollable container.
 * - strong: rendered as a rounded keyword badge instead of plain bold text.
 * - li: custom check-icon bullet instead of the default list marker.
 * Built by a factory so the light and dark themes share the exact same
 * logic and only differ in their literal Tailwind classes.
 */
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
  };
}

export const MARKDOWN_COMPONENTS: Components = createMarkdownComponents(
  CALLOUT_STYLES,
  "border-slate-200",
  BADGE_CLASSES.light,
  LIST_ICON_CLASSES.light
);

/** Dark-theme counterpart of MARKDOWN_COMPONENTS for the "Clinical Midnight Aurora" theme. */
export const DARK_MARKDOWN_COMPONENTS: Components = createMarkdownComponents(
  DARK_CALLOUT_STYLES,
  "border-white/10",
  BADGE_CLASSES.dark,
  LIST_ICON_CLASSES.dark
);
