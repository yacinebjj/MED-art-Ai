"use client";

import { type ComponentType } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, BookOpen, Sparkles, Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";
import { DARK_MARKDOWN_COMPONENTS, DARK_PROSE_CLASSES, MARKDOWN_COMPONENTS, PROSE_CLASSES } from "@/lib/markdown";

interface SmartNotesSection {
  heading: string;
  body: string;
}

/**
 * lib/ai/lecture-notes-prompts.ts's LECTURE_NOTES_SYSTEM_PROMPT (locked —
 * never edited by this redesign) always asks for these exact 3 "## " Markdown
 * headings, in this order. Matched here purely to pick an icon/tint per
 * section — an unrecognized or missing heading still renders correctly (see
 * parseSmartNotes below), just with the neutral fallback identity.
 */
const KNOWN_SECTIONS: Record<string, { icon: ComponentType<{ className?: string }>; tint: string; iconTint: string }> = {
  "Résumé du cours": {
    icon: BookOpen,
    tint: "bg-blue-50/80 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-900/40",
    iconTint: "text-blue-600 dark:text-blue-400",
  },
  "Points cliniques clés": {
    icon: Stethoscope,
    tint: "bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-900/40",
    iconTint: "text-emerald-600 dark:text-emerald-400",
  },
  "Indices d'examen": {
    icon: AlertTriangle,
    tint: "bg-amber-50/80 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-900/40",
    iconTint: "text-amber-600 dark:text-amber-400",
  },
};

const FALLBACK_SECTION = {
  icon: Sparkles,
  tint: "bg-muted/60 border-border",
  iconTint: "text-muted-foreground",
};

/**
 * Splits the Smart Notes markdown on its own "## Heading" lines — never
 * assumes the model followed the prompt's 3-heading structure exactly.
 * Zero "## " headings found (a real format drift, however rare) falls back
 * to one single section with no heading at all, so the content is still
 * shown in full — never silently dropped for not matching the expected
 * shape.
 */
function parseSmartNotes(markdown: string): SmartNotesSection[] {
  const lines = markdown.split("\n");
  const sections: { heading: string | null; body: string[] }[] = [];

  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      sections.push({ heading: match[1].trim(), body: [] });
    } else if (sections.length > 0) {
      sections[sections.length - 1].body.push(line);
    } else {
      sections.push({ heading: null, body: [line] });
    }
  }

  return sections
    .map((s) => ({ heading: s.heading ?? "", body: s.body.join("\n").trim() }))
    .filter((s) => s.body.length > 0 || s.heading);
}

export function SmartNotesView({ markdown, isDark }: { markdown: string; isDark: boolean }) {
  const sections = parseSmartNotes(markdown);

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section, i) => {
        const meta = (section.heading && KNOWN_SECTIONS[section.heading]) || FALLBACK_SECTION;
        const Icon = meta.icon;
        return (
          <div
            key={i}
            className={cn(
              "animate-fade-in rounded-2xl border p-5 shadow-soft transition-all duration-300",
              meta.tint
            )}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            {section.heading && (
              <div className="mb-3 flex items-center gap-2">
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background/70 shadow-sm dark:bg-background/30", meta.iconTint)}>
                  <Icon className="h-4 w-4" />
                </span>
                <h3 className="text-sm font-bold text-foreground">{section.heading}</h3>
              </div>
            )}
            <article dir="auto" className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "max-w-none")}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}>
                {section.body}
              </ReactMarkdown>
            </article>
          </div>
        );
      })}
    </div>
  );
}
