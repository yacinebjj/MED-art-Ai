"use client";

import type { ComponentType } from "react";
import { Bold, Eraser, Heading2, Heading3, Highlighter, Italic, List, ListOrdered, Quote, Redo2, Strikethrough, Underline, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { tNotes } from "@/lib/translations/notes";

export interface EditorToolbarProps {
  onCommand: (command: string, value?: string) => void;
  disabled?: boolean;
}

export const HIGHLIGHT_COLOR = "#fef08a";

export interface ToolbarAction {
  id: string;
  icon: ComponentType<{ className?: string }>;
  command: string;
  value?: string;
  label: string;
}

const EXTRA_LABELS: Record<Language, Record<"strike" | "quote" | "clear" | "undo" | "redo", string>> = {
  fr: { strike: "Barré", quote: "Citation", clear: "Effacer la mise en forme", undo: "Annuler", redo: "Rétablir" },
  en: { strike: "Strikethrough", quote: "Quote", clear: "Clear formatting", undo: "Undo", redo: "Redo" },
};

/** Every formatting action, in toolbar order. `inline` ones are also offered by the floating selection bar. */
export function getToolbarActions(language: Language): { blocks: ToolbarAction[][]; inline: ToolbarAction[] } {
  const extra = EXTRA_LABELS[language];
  const bold: ToolbarAction = { id: "bold", icon: Bold, command: "bold", label: tNotes("toolbarBold", language) };
  const italic: ToolbarAction = { id: "italic", icon: Italic, command: "italic", label: tNotes("toolbarItalic", language) };
  const underline: ToolbarAction = { id: "underline", icon: Underline, command: "underline", label: tNotes("toolbarUnderline", language) };
  const strike: ToolbarAction = { id: "strike", icon: Strikethrough, command: "strikeThrough", label: extra.strike };
  const highlight: ToolbarAction = { id: "highlight", icon: Highlighter, command: "hiliteColor", value: HIGHLIGHT_COLOR, label: tNotes("toolbarHighlight", language) };
  const h2: ToolbarAction = { id: "h2", icon: Heading2, command: "formatBlock", value: "h2", label: tNotes("toolbarHeading2", language) };
  const h3: ToolbarAction = { id: "h3", icon: Heading3, command: "formatBlock", value: "h3", label: tNotes("toolbarHeading3", language) };
  const ul: ToolbarAction = { id: "ul", icon: List, command: "insertUnorderedList", label: tNotes("toolbarBulletList", language) };
  const ol: ToolbarAction = { id: "ol", icon: ListOrdered, command: "insertOrderedList", label: tNotes("toolbarNumberedList", language) };
  const quote: ToolbarAction = { id: "quote", icon: Quote, command: "formatBlock", value: "blockquote", label: extra.quote };
  const clear: ToolbarAction = { id: "clear", icon: Eraser, command: "removeFormat", label: extra.clear };
  const undo: ToolbarAction = { id: "undo", icon: Undo2, command: "undo", label: extra.undo };
  const redo: ToolbarAction = { id: "redo", icon: Redo2, command: "redo", label: extra.redo };
  return {
    blocks: [
      [undo, redo],
      [bold, italic, underline, strike, highlight],
      [h2, h3, quote],
      [ul, ol],
      [clear],
    ],
    inline: [bold, italic, underline, strike, highlight, h2, clear],
  };
}

/**
 * Formatting toolbar over the contentEditable note body (document.execCommand
 * — deprecated but universally supported for contentEditable, and a working
 * WYSIWYG with zero new dependency). `onMouseDown` preventDefault keeps the
 * editor's selection alive across the click.
 */
export function EditorToolbar({ onCommand, disabled }: EditorToolbarProps) {
  const { language } = useLanguage();
  const { blocks } = getToolbarActions(language);

  return (
    <div className="cyber-scrollbar sticky top-0 z-10 flex items-center gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/80 p-1 md:bg-slate-900/60 md:backdrop-blur-xl">
      {blocks.map((group, groupIndex) => (
        <div key={groupIndex} className={cn("flex shrink-0 items-center gap-0.5", groupIndex > 0 && "border-l border-white/10 pl-1")}>
          {group.map(({ id, icon: Icon, command, value, label }) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onCommand(command, value)}
              title={label}
              aria-label={label}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-cyan-400/10 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
