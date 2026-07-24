import type { Components } from "react-markdown";

/**
 * Rich, colored @tailwindcss/typography class set shared by every Markdown
 * reader (workspace CenterReader + the static demo page). Kept in one place so
 * the two stay visually identical.
 *
 * Highlights:
 * - Navy/blue premium headings, colored bold text and list markers.
 * - Blockquotes ("L'Astuce du Prof" / "Résumés en Arabe") get a light blue
 *   background, a thick colored left border, and NO default quotation marks
 *   (the last two arbitrary variants strip the plugin's open-/close-quote).
 * - Table cells get real padding, a blue header row, row separators and
 *   zebra striping. Full-width, rounded, shadowed images.
 */
export const PROSE_CLASSES = [
  "prose prose-slate prose-lg max-w-none",
  // Headings — premium navy/blue
  "prose-headings:font-bold prose-headings:tracking-tight",
  "prose-h1:text-slate-900 prose-h2:text-blue-800 prose-h3:text-blue-600",
  // Bold text pops in blue
  "prose-strong:text-blue-700 prose-strong:font-semibold",
  "prose-a:text-blue-600",
  // Bullet / ordered-list markers
  "marker:text-blue-500",
  // Blockquotes — soft background + thick colored left border, quotes removed
  "prose-blockquote:border-l-4 prose-blockquote:border-blue-500 prose-blockquote:bg-blue-50",
  "prose-blockquote:rounded-r-lg prose-blockquote:px-5 prose-blockquote:py-3",
  "prose-blockquote:not-italic prose-blockquote:font-normal prose-blockquote:text-slate-800",
  "[&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none",
  // Tables
  "prose-th:bg-blue-600 prose-th:text-white prose-th:font-semibold prose-th:p-3 prose-th:text-left",
  "prose-td:p-3 prose-td:border-t prose-td:border-slate-200 prose-td:align-top",
  "[&_tbody_tr:nth-child(even)]:bg-slate-50",
  // Images
  "prose-img:w-full prose-img:rounded-xl prose-img:shadow-md prose-img:my-6",
].join(" ");

/**
 * ReactMarkdown element overrides. Wraps every table in a rounded, scrollable
 * container so wide comparison tables never overflow the reader (especially in
 * the narrow non-fullscreen layout) and keep clean rounded corners.
 */
export const MARKDOWN_COMPONENTS: Components = {
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
      <table className="m-0 w-full">{children}</table>
    </div>
  ),
};
