"use client";

import type { ComponentType } from "react";
import { Bold, Heading2, Heading3, Highlighter, Italic, List, ListOrdered, Underline } from "lucide-react";
import { useLanguage } from "@/providers/LanguageProvider";
import { NOTES_TRANSLATIONS, tNotes } from "@/lib/translations/notes";

interface EditorToolbarProps {
  onCommand: (command: string, value?: string) => void;
  disabled?: boolean;
}

const HIGHLIGHT_COLOR = "#fef08a";

/**
 * Floating formatting toolbar over the contentEditable note body. Uses
 * document.execCommand — deprecated but still universally supported for
 * contentEditable formatting, and a real, working WYSIWYG toolbar with zero
 * new dependency beats pulling in a full rich-text editor library for this.
 * `onMouseDown` preventDefault on every button keeps the editor's own text
 * selection alive across the click (a plain onClick alone would blur the
 * contentEditable and collapse the selection before execCommand ever runs).
 */
export function EditorToolbar({ onCommand, disabled }: EditorToolbarProps) {
  const { language } = useLanguage();

  const buttons: { icon: ComponentType<{ className?: string }>; command: string; value?: string; labelKey: keyof typeof NOTES_TRANSLATIONS }[] = [
    { icon: Bold, command: "bold", labelKey: "toolbarBold" },
    { icon: Italic, command: "italic", labelKey: "toolbarItalic" },
    { icon: Underline, command: "underline", labelKey: "toolbarUnderline" },
    { icon: Heading2, command: "formatBlock", value: "h2", labelKey: "toolbarHeading2" },
    { icon: Heading3, command: "formatBlock", value: "h3", labelKey: "toolbarHeading3" },
    { icon: List, command: "insertUnorderedList", labelKey: "toolbarBulletList" },
    { icon: ListOrdered, command: "insertOrderedList", labelKey: "toolbarNumberedList" },
    { icon: Highlighter, command: "hiliteColor", value: HIGHLIGHT_COLOR, labelKey: "toolbarHighlight" },
  ];

  return (
    <div className="glass-card sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-2xl border border-border/60 p-1 shadow-glass dark:shadow-glass-dark">
      {buttons.map(({ icon: Icon, command, value, labelKey }) => {
        const label = tNotes(labelKey, language);
        return (
          <button
            key={labelKey}
            type="button"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onCommand(command, value)}
            title={label}
            aria-label={label}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
