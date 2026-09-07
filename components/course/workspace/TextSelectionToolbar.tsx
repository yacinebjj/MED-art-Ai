"use client";

import { forwardRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Eraser, Highlighter, Languages, Loader2, MessageCircleQuestion, NotebookPen, Search, X } from "lucide-react";
import { computeOffsets, escapeHtml, getSelectionMarkAncestor, removeHighlight, wrapRangeInMark, HIGHLIGHT_COLORS } from "@/lib/highlight";
import { useToast } from "@/components/ui/Toast";
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
  /** The reading container the selection lives in — offsets are captured relative to THIS element (see lib/highlight.ts's computeOffsets), never the whole page. */
  container?: HTMLDivElement | null;
}

export const TextSelectionToolbar = forwardRef<HTMLDivElement, TextSelectionToolbarProps>(
  function TextSelectionToolbar({ selection, onAsk, onTranslate, onHighlightChange, moduleId, courseTitle, courseSlug, container }, ref) {
    const { toast } = useToast();
    const [isSavingNote, setIsSavingNote] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    // "Add Note" used to navigate straight to /dashboard/notes, yanking the
    // student out of whatever they were reading mid-selection. Now it opens
    // a small inline draft, right here in this same floating toolbar — save
    // still hits POST /api/notes exactly as before, it just never leaves
    // the Workspace. `null` = toolbar row showing; a string = the draft
    // form is open, pre-filled with the selected text.
    const [noteDraft, setNoteDraft] = useState<string | null>(null);

    useEffect(() => {
      setDismissed(false);
      setPickerOpen(false);
      setNoteDraft(null);
    }, [selection]);

    if (typeof document === "undefined" || dismissed) return null;

    const markAncestor = getSelectionMarkAncestor();

    function handleAddNote() {
      setNoteDraft(selection.text);
    }

    async function handleSaveNoteDraft() {
      if (noteDraft === null || !noteDraft.trim()) return;
      setIsSavingNote(true);
      try {
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Note ajoutée depuis une sélection",
            content: escapeHtml(noteDraft),
            ...(moduleId != null ? { moduleId, courseTitle } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.success) {
          toast({ variant: "success", title: "Note enregistrée" });
          setDismissed(true);
        } else {
          toast({ variant: "error", title: "Échec de l'enregistrement", description: data?.error ?? "Réessaie." });
        }
      } catch {
        toast({ variant: "error", title: "Échec de l'enregistrement", description: "Impossible de contacter le serveur." });
      } finally {
        setIsSavingNote(false);
      }
    }

    async function handleUnhighlight() {
      if (markAncestor) {
        const highlightId = markAncestor.dataset.highlightId;
        removeHighlight(markAncestor);

        // Real persistence: the highlight only stops coming back on the
        // next visit if its row is actually deleted server-side, not just
        // unwrapped from THIS render of the DOM.
        if (highlightId) {
          fetch(`/api/highlights?id=${encodeURIComponent(highlightId)}`, { method: "DELETE" }).catch(() => {
            // Best-effort: the DOM is already updated: a failed delete just
            // means this highlight may reappear on the next visit, not a
            // broken UI right now.
          });
        }
      }
      setDismissed(true);
      onHighlightChange?.();
    }

    async function handlePickColor(color: (typeof HIGHLIGHT_COLORS)[number]) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);

      // Captured BEFORE the DOM mutation below — surroundContents/
      // extractContents change the tree, which would invalidate range
      // offsets computed afterward.
      const offsets = container ? computeOffsets(container, range) : null;

      const mark = wrapRangeInMark(range, color.markClass);
      sel.removeAllRanges();
      if (!mark) {
        setDismissed(true);
        onHighlightChange?.();
        return;
      }

      setDismissed(true);
      onHighlightChange?.();

      if (!courseSlug) return;
      try {
        const res = await fetch("/api/highlights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: courseSlug,
            selectedText: selection.text,
            color: color.id,
            startOffset: offsets?.startOffset,
            endOffset: offsets?.endOffset,
          }),
        });
        const data = await res.json().catch(() => null);
        // Tag the live mark with its real row id so a later unhighlight can
        // delete the exact persisted row, not just search by text.
        if (data?.highlight?.id !== undefined) mark.dataset.highlightId = String(data.highlight.id);
      } catch {
        // The highlight still looks applied locally; it just won't survive
        // a reload if this save failed. Consistent with this route's
        // existing fire-and-forget error handling elsewhere.
      }
    }

    if (noteDraft !== null) {
      return createPortal(
        <div
          ref={ref}
          style={{ top: selection.top, left: selection.left }}
          className="fixed z-[99999] w-72 -translate-x-1/2 rounded-lg bg-gray-900 p-2.5 shadow-xl"
        >
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={4}
            autoFocus
            className="w-full resize-none rounded-md bg-white/10 p-2 text-sm text-white outline-none placeholder:text-white/40 focus-visible:ring-1 focus-visible:ring-white/40"
            placeholder="Écris ta note..."
          />
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setNoteDraft(null)}
              disabled={isSavingNote}
              className={BUTTON_CLASSES}
            >
              <X className="h-3.5 w-3.5" />
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSaveNoteDraft}
              disabled={isSavingNote || !noteDraft.trim()}
              className={BUTTON_CLASSES}
            >
              {isSavingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Enregistrer
            </button>
          </div>
        </div>,
        document.body
      );
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
        <button type="button" onClick={handleAddNote} className={BUTTON_CLASSES}>
          <NotebookPen className="h-3.5 w-3.5" />
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