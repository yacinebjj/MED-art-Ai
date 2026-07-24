import type { Components } from "react-markdown";

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
  // Headings — premium, color by importance
  "prose-headings:font-bold prose-headings:tracking-tight",
  "prose-h1:text-slate-900 prose-h2:text-blue-800 prose-h3:text-indigo-600",
  // Bold text pops in blue
  "prose-strong:text-blue-700 prose-strong:font-semibold",
  "prose-a:text-blue-600",
  // Bullet / ordered-list markers
  "marker:text-blue-500",
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
 */
export const MARKDOWN_COMPONENTS: Components = {
  blockquote: ({ node, children }) => {
    const tone = calloutTone(hastText(node));
    return (
      <blockquote
        className={`my-5 rounded-r-lg px-5 py-3 font-normal not-italic shadow-sm ${CALLOUT_STYLES[tone]}`}
      >
        {children}
      </blockquote>
    );
  },
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
      <table className="m-0 w-full">{children}</table>
    </div>
  ),
};
