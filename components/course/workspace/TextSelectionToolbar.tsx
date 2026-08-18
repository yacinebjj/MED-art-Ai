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
  /** Highlight/Unhighlight mutate the DOM directly (range.insertNode/removeChild), which never fires a native `input` event — a caller with React state mirroring that DOM (the "Mes notes" contentEditable editor) needs this to know when to re-read `innerHTML` and re-sync. Optional: omitted by every other (ephemeral, non-persisted) call site. */
  onHighlightChange?: () => void;
  /** When set (only by module/[id]/page.tsx's workspace, the one surface with a real curriculum module in scope), "Add Note" aggregates into that module's single note instead of always creating a new one — see /api/notes route.ts's POST handler. `courseTitle` tags which source an appended excerpt came from. */
  moduleId?: number;
  courseTitle?: string;
}

/**
 * Floating selection toolbar — Ask MedArt / Translate / Search Web / Add Note
 * / Highlight (with a 4-color picker) or Unhighlight, shown right above
 * whatever native HTML text the student just selected (StudioPanel's
 * opened-section detail view, ChatDocumentPanel's message bubbles, the demo
 * reading view, and the "Mes notes" contentEditable editor). Deliberately
 * never wired inside FileViewerModal's iframe: `window.getSelection()` cannot
 * see across an iframe boundary at all (a same-origin restriction with no
 * workaround), so a selection made inside an embedded PDF/Office viewer is
 * structurally invisible to this component.
 *
 * Portaled straight into `document.body` for the same reason as this
 * component's predecessor (SelectionTooltip) — see useTextSelection.ts's own
 * comment: a `position: fixed` descendant of any ancestor with its own
 * transform/filter/will-change (several of which this workspace's panel-shell
 * transition classes apply) gets trapped relative to that ancestor instead of
 * the real viewport.
 */
export const TextSelectionToolbar = forwardRef<HTMLDivElement, TextSelectionToolbarProps>(
  function TextSelectionToolbar({ selection, onAsk, onTranslate, onHighlightChange, moduleId, courseTitle }, ref) {
    const router = useRouter();
    const [isSavingNote, setIsSavingNote] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    // Hides the toolbar the instant a highlight/unhighlight action fires —
    // the underlying `selection` prop stays the same object until the
    // student makes a NEW selection elsewhere (see useTextSelection.ts), so
    // without this the toolbar would otherwise linger showing stale
    // Highlight/Unhighlight state after acting on it. Reset the moment a
    // fresh selection arrives.
    const [dismissed, setDismissed] = useState(false);
    useEffect(() => {
      setDismissed(false);
      setPickerOpen(false);
    }, [selection]);

    if (typeof document === "undefined" || dismissed) return null;

    // Re-checked on every render — a render only happens here when
    // `selection` changes (a fresh mouseup), so this always reflects
    // whether THAT selection currently lives inside a <mark>.
    const markAncestor = getSelectionMarkAncestor();

    /** "Add Note" — creates the note server-side immediately (so its id exists to deep-link to), then navigates to the dedicated notes page with that note pre-selected, its content already filled in. Escaped: the note's content field is rendered as HTML by the notes editor (see Feature 2), so raw "<"/">"/"&" in the selected text must not be interpreted as markup. */
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
      if (markAncestor) removeHighlight(markAncestor);
      setDismissed(true);
      onHighlightChange?.();
    }

    function handlePickColor(color: (typeof HIGHLIGHT_COLORS)[number]) {
      applyHighlight(color);
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
