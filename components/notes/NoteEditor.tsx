"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { EditorToolbar } from "./EditorToolbar";

interface NoteEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  className?: string;
}

/** Rich-text note body (accepts colors/tables from the AI organize feature, same as before) plus a floating formatting toolbar wired via document.execCommand. */
export function NoteEditor({ value, onChange, disabled, className }: NoteEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  function handleCommand(command: string, commandValue?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    onChange(editorRef.current?.innerHTML ?? "");
  }

  return (
    <div className={cn("mt-3 flex min-h-0 flex-1 flex-col gap-2", className)}>
      <EditorToolbar onCommand={handleCommand} disabled={disabled} />
      <div
        ref={editorRef}
        contentEditable={!disabled}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        className={cn(
          // Sized for comfortable long-session reading: a 16px base with generous
          // line-height and padding reads far better over a full study session
          // than a cramped text-sm/p-4 — study notes are re-read for minutes at a
          // time, not skimmed like UI chrome.
          "h-full min-h-[300px] w-full min-w-0 flex-1 overflow-y-auto rounded-xl border border-border bg-transparent p-5 text-base leading-[1.8] outline-none transition-opacity sm:p-6",
          "selection:bg-primary-100 selection:text-foreground caret-primary-500 dark:selection:bg-primary-900/50",
          "prose dark:prose-invert max-w-none", // lets AI-generated headings/tables render already-styled
          "prose-table:w-full prose-table:border-collapse prose-td:border prose-td:border-border prose-td:p-2 prose-th:border prose-th:border-border prose-th:bg-muted prose-th:p-2",
          disabled && "cursor-not-allowed opacity-50"
        )}
      />
    </div>
  );
}
