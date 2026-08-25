"use client";

import { forwardRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Eraser, Highlighter, Languages, Loader2, MessageCircleQuestion, NotebookPen, Search } from "lucide-react";
import { applyHighlight, escapeHtml, getSelectionMarkAncestor, removeHighlight, HIGHLIGHT_COLORS } from "@/lib/highlight";
import type { TextSelectionState } from "@/hooks/useTextSelection";

const BUTTON_CLASSES =
  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-60";

function openWebSearch(text: string) {
  window.open(`https://www.google.com/search?q=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

interface TextSelectionToolbarProps {
  selection: TextSelectionState;
  onAsk: (text: string) => void;
  onTranslate: (text: string) => void;
  onHighlightChange?: () => void;
  moduleId?: number;
  courseTitle?: string;
  courseSlug?: string;
}

export const TextSelectionToolbar = forwardRef<HTMLDivElement, TextSelectionToolbarProps>(
  function TextSelectionToolbar({ selection, onAsk, onTranslate, onHighlightChange, moduleId, courseTitle, courseSlug }, ref) {
    const router = useRouter();
    const [isSavingNote, setIsSavingNote] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
      setDismissed(false);
      setPickerOpen(false);
    }, [selection]);

    if (typeof document === "undefined" || dismissed) return null;

    const markAncestor = getSelectionMarkAncestor();

    async function handleAddNote() {
      setIsSavingNote(true);
      try {
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Note ajoutée depuis une sélection",
            content: escapeHtml(selection.text),
            ...(moduleId != null ? { moduleId, courseTitle } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.success && data.note?.id) {
          router.push(`/dashboard/notes?noteId=${data.note.id}`);
        }
      } finally {
        setIsSavingNote(false);
      }
    }

    function handleUnhighlight() {
      if (markAncestor) {
        const textToRemove = markAncestor.textContent || "";
        removeHighlight(markAncestor);
        
        // حذف الهايلايت من LocalStorage إذا كان مخزن هناك
        if (courseSlug) {
          const key = `medart_highlights_${courseSlug}`;
          const saved = JSON.parse(localStorage.getItem(key) || "[]");
          const filtered = saved.filter((item: string) => item !== textToRemove);
          localStorage.setItem(key, JSON.stringify(filtered));
        }
      }
      setDismissed(true);
      onHighlightChange?.();
    }

    // 👈 الحل النهائي والسريع: حفظ الهايلايت في LocalStorage محلياً ودائماً
    function handlePickColor(color: (typeof HIGHLIGHT_COLORS)[number]) {
      applyHighlight(color);

      if (courseSlug) {
        const key = `medart_highlights_${courseSlug}`;
        const saved = JSON.parse(localStorage.getItem(key) || "[]");
        if (!saved.includes(selection.text)) {
          saved.push(selection.text);
          localStorage.setItem(key, JSON.stringify(saved));
        }
      }

      setDismissed(true);
      onHighlightChange?.();
    }

    return createPortal(
      <div
        ref={ref}
        style={{ top: selection.top, left: selection.left }}
        className="fixed z-[99999] flex -translate-x-1/2 flex-wrap items-center gap-1 rounded-lg bg-gray-900 p-2 shadow-xl"
      >
        <button type="button" onClick={() => onAsk(selection.text)} className={BUTTON_CLASSES}>
          <MessageCircleQuestion className="h-3.5 w-3.5" />
          Ask MedArt
        </button>
        <div className="w-px bg-white/20" />
        <button type="button" onClick={() => onTranslate(selection.text)} className={BUTTON_CLASSES}>
          <Languages className="h-3.5 w-3.5" />
          Translate
        </button>
        <div className="w-px bg-white/20" />
        <button type="button" onClick={() => openWebSearch(selection.text)} className={BUTTON_CLASSES}>
          <Search className="h-3.5 w-3.5" />
          Search Web
        </button>
        <div className="w-px bg-white/20" />
        <button type="button" onClick={handleAddNote} disabled={isSavingNote} className={BUTTON_CLASSES}>
          {isSavingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <NotebookPen className="h-3.5 w-3.5" />}
          Add Note
        </button>
        <div className="w-px bg-white/20" />

        {markAncestor ? (
          <button type="button" onClick={handleUnhighlight} className={BUTTON_CLASSES}>
            <Eraser className="h-3.5 w-3.5" />
            Retirer le surlignage
          </button>
        ) : pickerOpen ? (
          <div className="flex items-center gap-1.5 px-1">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                onClick={() => handlePickColor(color)}
                aria-label={color.label}
                title={color.label}
                className={`h-5 w-5 rounded-full ring-1 ring-white/40 transition-transform hover:scale-110 ${color.dotClass}`}
              />
            ))}
          </div>
        ) : (
          <button type="button" onClick={() => setPickerOpen(true)} className={BUTTON_CLASSES}>
            <Highlighter className="h-3.5 w-3.5 text-yellow-400" />
            Highlight
          </button>
        )}
      </div>,
      document.body
    );
  }
);