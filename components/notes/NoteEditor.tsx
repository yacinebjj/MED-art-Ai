"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import { EditorToolbar, getToolbarActions } from "./EditorToolbar";

interface NoteEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  className?: string;
}

interface FloatingPosition {
  /** Distance from the wrapper's bottom edge to just above the selection. */
  bottom: number;
  left: number;
}

/**
 * Rich-text note body (keeps the colors/tables the AI organize feature
 * produces) with a sticky toolbar AND a smart floating toolbar that pops up
 * right above any text selection inside the note.
 */
export function NoteEditor({ value, onChange, disabled, className }: NoteEditorProps) {
  const { language } = useLanguage();
  const editorRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState<FloatingPosition | null>(null);
  const { inline } = getToolbarActions(language);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  // Track the selection (rAF-throttled) to place the floating bar above it.
  useEffect(() => {
    let frame = 0;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = document.getSelection();
        const editor = editorRef.current;
        const wrap = wrapRef.current;
        if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !editor || !wrap) {
          setFloating(null);
          return;
        }
        const range = selection.getRangeAt(0);
        if (!editor.contains(range.commonAncestorContainer)) {
          setFloating(null);
          return;
        }
        const rect = range.getBoundingClientRect();
        const box = wrap.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          setFloating(null);
          return;
        }
        const half = 150;
        const left = Math.min(Math.max(rect.left - box.left + rect.width / 2, half), Math.max(half, box.width - half));
        setFloating({ bottom: Math.min(box.height - (rect.top - box.top) + 10, box.height - 48), left });
      });
    }
    document.addEventListener("selectionchange", update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
    };
  }, []);

  function handleCommand(command: string, commandValue?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    onChange(editorRef.current?.innerHTML ?? "");
  }

  return (
    <div ref={wrapRef} className={cn("relative mt-3 flex min-h-0 flex-1 flex-col gap-2", className)}>
      <EditorToolbar onCommand={handleCommand} disabled={disabled} />

      <AnimatePresence>
        {floating && !disabled && (
          <motion.div
            key="floating-toolbar"
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.14 }}
            // Horizontal centering lives in `x`: framer-motion owns this element's transform.
            style={{ bottom: floating.bottom, left: floating.left, x: "-50%" }}
            className="absolute z-20 flex items-center gap-0.5 rounded-2xl border border-cyan-400/30 bg-slate-950/95 p-1 shadow-[0_12px_40px_-10px_rgba(34,211,238,0.5)]"
            role="toolbar"
            aria-label="Mise en forme de la sélection"
          >
            {inline.map(({ id, icon: Icon, command, value: commandValue, label }) => (
              <button
                key={id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleCommand(command, commandValue)}
                title={label}
                aria-label={label}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-cyan-400/15 hover:text-cyan-100"
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={editorRef}
        contentEditable={!disabled}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        onScroll={() => setFloating(null)}
        className={cn(
          // 16px base + generous line-height: notes are re-read for minutes at a time.
          "cyber-scrollbar h-full min-h-[300px] w-full min-w-0 flex-1 overflow-y-auto rounded-2xl border border-white/[0.08] bg-slate-950/40 p-5 text-base leading-[1.8] text-slate-100 outline-none transition-[opacity,border-color,box-shadow] focus:border-cyan-400/40 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.08)] sm:p-7",
          "caret-cyan-300 selection:bg-cyan-400/30 selection:text-white",
          "prose prose-invert max-w-none [&_[style*='rgb(254,_240,_138)']]:text-slate-900 prose-headings:text-white prose-strong:text-white prose-blockquote:border-l-cyan-400 prose-blockquote:text-slate-300 prose-mark:bg-yellow-200",
          "prose-table:w-full prose-table:border-collapse prose-td:border prose-td:border-white/10 prose-td:p-2 prose-th:border prose-th:border-white/10 prose-th:bg-white/5 prose-th:p-2",
          disabled && "cursor-not-allowed opacity-50"
        )}
      />
    </div>
  );
}
