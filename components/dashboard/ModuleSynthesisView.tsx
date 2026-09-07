"use client";

import { type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DARK_MARKDOWN_COMPONENTS, DARK_PROSE_CLASSES, MARKDOWN_COMPONENTS, PROSE_CLASSES, normalizeCallouts } from "@/lib/markdown";

interface SynthesisSection {
  heading: string;
  body: string;
  isCrossCourse: boolean;
}

/**
 * lib/module-synthesis.ts's stitchSummaryChunks joins each SELECTED COURSE's
 * own "## [emoji] Titre du cours" chunk with a "\n\n---\n\n" separator
 * (global_summary and medical_dictionary both go through it), then appends
 * one final "### 🔗 Synthèse Transversale..." cross-course section
 * (buildCrossCourseSynthesis). keywords_table instead stitches one single
 * combined Markdown TABLE with no "## " headings at all (stitchKeywordsTable)
 * — none of this is edited by this redesign, only read/parsed for display.
 *
 * Splits on any level-2 ("## ") or level-3 ("### ") heading line so both
 * shapes render correctly: a per-course-chapter result gets one distinct
 * card per course (the real "séparateurs de chapitres" the redesign asked
 * for) while a headerless table (keywords_table, or any future format
 * drift) safely falls back to a single unheaded section — real content is
 * never dropped for not matching the expected shape.
 */
function parseSynthesis(markdown: string): SynthesisSection[] {
  const lines = markdown.split("\n");
  const sections: { heading: string | null; body: string[] }[] = [];

  for (const line of lines) {
    const match = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (match) {
      sections.push({ heading: match[1].trim(), body: [] });
    } else if (sections.length > 0) {
      sections[sections.length - 1].body.push(line);
    } else {
      sections.push({ heading: null, body: [line] });
    }
  }

  return sections
    .map((s) => ({
      heading: s.heading ?? "",
      body: s.body.join("\n").trim(),
      isCrossCourse: /synthèse transversale|🔗/i.test(s.heading ?? ""),
    }))
    .filter((s) => s.body.length > 0 || s.heading);
}

/** One tint per "chapter" card, cycling by index — course titles (and thus headings) are only known at generation time, never a fixed known set like Audio to Smart Notes' 3 headings, so identity here is purely positional, not name-matched. */
const CHAPTER_TINTS = [
  "bg-teal-50/80 dark:bg-teal-950/20 border-teal-200/50 dark:border-teal-900/40",
  "bg-blue-50/80 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-900/40",
  "bg-amber-50/80 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-900/40",
  "bg-rose-50/80 dark:bg-rose-950/20 border-rose-200/50 dark:border-rose-900/40",
  "bg-cyan-50/80 dark:bg-cyan-950/20 border-cyan-200/50 dark:border-cyan-900/40",
];

const CROSS_COURSE_TINT = "bg-violet-50/80 dark:bg-violet-950/20 border-violet-300/60 dark:border-violet-800/60";

const TABLE_BORDER_OVERRIDES_LIGHT = "prose-table:border-collapse prose-th:border prose-th:border-slate-300 prose-td:border prose-th:text-center";
const TABLE_BORDER_OVERRIDES_DARK = "prose-table:border-collapse prose-th:border prose-th:border-white/10 prose-td:border prose-th:text-center";

const MARKDOWN_TABLE_COMPONENTS = {
  table: ({ ...props }: { children?: ReactNode }) => (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  ),
  // Dictionnaire Médical's 3rd column (الشرح بالعربية) is genuine Arabic text
  // sitting in an otherwise LTR table — dir="auto" lets each cell resolve
  // its own direction from its own content instead of inheriting the page's.
  td: ({ ...props }: { children?: ReactNode }) => <td dir="auto" {...props} />,
  th: ({ ...props }: { children?: ReactNode }) => <th dir="auto" {...props} />,
};

export function ModuleSynthesisView({ markdown, isDark }: { markdown: string; isDark: boolean }) {
  const sections = parseSynthesis(markdown);
  const proseClasses = isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES;
  const tableOverrides = isDark ? TABLE_BORDER_OVERRIDES_DARK : TABLE_BORDER_OVERRIDES_LIGHT;
  const markdownComponents = { ...(isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS), ...MARKDOWN_TABLE_COMPONENTS };

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section, i) => {
        const tint = section.isCrossCourse ? CROSS_COURSE_TINT : CHAPTER_TINTS[i % CHAPTER_TINTS.length];
        return (
          <div
            key={i}
            className={cn(
              section.heading && "animate-fade-in rounded-2xl border p-5 shadow-soft transition-all duration-300",
              section.heading && tint
            )}
            style={section.heading ? { animationDelay: `${i * 90}ms` } : undefined}
          >
            {section.isCrossCourse && (
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background/70 text-violet-600 shadow-sm dark:bg-background/30 dark:text-violet-400">
                  <Link2 className="h-4 w-4" />
                </span>
                <h3 className="text-sm font-bold text-foreground">{section.heading}</h3>
              </div>
            )}
            <article dir="auto" className={cn(proseClasses, tableOverrides, "max-w-none")}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {section.isCrossCourse
                  ? normalizeCallouts(section.body)
                  : normalizeCallouts(section.heading ? `## ${section.heading}\n\n${section.body}` : section.body)}
              </ReactMarkdown>
            </article>
          </div>
        );
      })}
    </div>
  );
}
