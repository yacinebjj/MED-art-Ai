"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  NotebookPen,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { cn } from "@/lib/utils";
import { stripHtmlToText } from "@/lib/highlight";
import { useLanguage } from "@/providers/LanguageProvider";
import { tNotes } from "@/lib/translations/notes";
import { NoteCard } from "@/components/notes/NoteCard";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { NoteSummaryButton } from "@/components/notes/NoteSummaryButton";
import type { UserNote } from "@/types/user-notes";

const SIDEBAR_WIDTH = 300;

function NotesPageContent() {
  const { toast } = useToast();
  const { language } = useLanguage();
  const searchParams = useSearchParams();
  const deepLinkedNoteId = searchParams.get("noteId");
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Drives the persistent save-status pill in the editor header (see the
  // "Saved / Saving / Unsaved / Error" indicator below) — a toast alone
  // disappears after a few seconds, so a student who glances back at the
  // page thirty seconds later would have no way to tell whether their last
  // edit actually made it to the server. This state, combined with
  // `isDirty`, keeps that answer always on screen.
  const [saveError, setSaveError] = useState(false);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingNote, setRenamingNote] = useState<UserNote | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [confirmDeleteNote, setConfirmDeleteNote] = useState<UserNote | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Gates the "auto-open the first note" bootstrap default below — on
  // mobile, the list and the editor share one view (see the master-detail
  // comment on the grid), so auto-selecting would skip straight past the
  // list a student needs to see first. A deep link (?noteId=) still opens
  // directly regardless of viewport — that's an explicit navigation, not a
  // default.
  const isDesktopOrTablet = useMediaQuery("(min-width: 768px)");
  // The bootstrap effect below reads this inside an async fetch().then() —
  // by the time that resolves, `isDesktopOrTablet` itself has long since
  // updated via useMediaQuery's own effect, but the bootstrap effect's OWN
  // closure (deps: []) is frozen at whatever it was on the very first
  // render, which is ALWAYS false (useMediaQuery defaults to false until
  // its own effect runs, and effects from the same mount commit apply their
  // state updates only after the whole commit, not mid-effect) — so the
  // bootstrap callback would read a permanently-stale `false` regardless of
  // real screen size, and desktop would never auto-select the first note.
  // A ref sidesteps this: always current, never a stale closure.
  const isDesktopOrTabletRef = useRef(isDesktopOrTablet);
  useEffect(() => {
    isDesktopOrTabletRef.current = isDesktopOrTablet;
  }, [isDesktopOrTablet]);
  // Real visualViewport height on iOS Safari, which shrinks when the virtual
  // keyboard opens while `window.innerHeight`/the shell's `h-dvh` do not —
  // Android already gets this for free from the `interactiveWidget:
  // "resizes-content"` viewport meta in app/layout.tsx, but iOS Safari
  // ignores that property. Same pattern as app/dashboard/(shell)/assistant/page.tsx:
  // applied as extra bottom padding on this page's own flex column so the
  // "Sauvegarder" bar (pinned at the bottom of that column) stays above the
  // keyboard instead of sliding out of view behind it.
  const keyboardInset = useKeyboardInset();

  useEffect(() => {
    if (!isFullscreen) return;
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setIsFullscreen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notes")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const loaded: UserNote[] = data?.success ? data.notes ?? [] : [];
        setNotes(loaded);

        const deepLinked = deepLinkedNoteId ? loaded.find((n) => n.id === deepLinkedNoteId) : undefined;
        // On mobile with no explicit deep link, leave `initial` undefined so
        // the student sees the notes list first instead of jumping straight
        // into whichever note happens to be first.
        const initial = deepLinked ?? (isDesktopOrTabletRef.current ? loaded[0] : undefined);
        if (initial) {
          setSelectedId(initial.id);
          setDraftTitle(initial.title);
          setDraftContent(initial.content); // keeps rich HTML (colors/tables) as-is
        }
      })
      .catch(() => setNotes([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // Runs once on mount to resume/deep-link into a note — `language` is read
    // for its value at that moment only, not a reason to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;
  const selectedOriginalContent = selectedNote ? selectedNote.content : "";
  const isDirty = selectedNote ? draftTitle !== selectedNote.title || draftContent !== selectedOriginalContent : false;

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => n.title.toLowerCase().includes(q) || stripHtmlToText(n.content).toLowerCase().includes(q));
  }, [notes, searchQuery]);

  function selectNote(note: UserNote) {
    setSelectedId(note.id);
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setIsFullscreen(false);
    setSaveError(false);
  }

  async function handleCreate() {
    setIsCreating(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Nouvelle note", content: "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "La création de la note a échoué.");

      const created: UserNote = data.note;
      setNotes((prev) => [created, ...prev]);
      selectNote(created);
    } catch (error) {
      toast({ variant: "error", title: tNotes("toastErrorTitle", language), description: error instanceof Error ? error.message : tNotes("toastErrorUnknown", language) });
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSave() {
    if (!selectedNote) return;
    setIsSaving(true);
    setSaveError(false);
    try {
      const res = await fetch(`/api/notes/${selectedNote.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draftTitle, content: draftContent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "L'enregistrement a échoué.");

      const finalTitle = draftTitle.trim() || "Note sans titre";
      const updatedAt: string = data.updatedAt ?? new Date().toISOString();
      setNotes((prev) => prev.map((n) => (n.id === selectedNote.id ? { ...n, title: finalTitle, content: draftContent, updatedAt } : n)));
      setDraftTitle(finalTitle);
      toast({ variant: "success", title: tNotes("toastNoteSaved", language) });
    } catch (error) {
      setSaveError(true);
      toast({ variant: "error", title: tNotes("toastErrorTitle", language), description: error instanceof Error ? error.message : tNotes("toastErrorUnknown", language) });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleOrganizeByAI() {
    const rawText = stripHtmlToText(draftContent).trim();
    if (!rawText) return;

    setIsOrganizing(true);
    try {
      const res = await fetch("/api/notes/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: rawText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "L'organisation par l'IA a échoué.");

      setDraftContent(data.organizedContent);
      toast({ variant: "success", title: `✨ ${tNotes("organizeSuccessToast", language)}` });
    } catch (error) {
      toast({ variant: "error", title: tNotes("toastErrorTitle", language), description: error instanceof Error ? error.message : tNotes("toastErrorUnknown", language) });
    } finally {
      setIsOrganizing(false);
    }
  }

  async function handleDeleteNoteById(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "La suppression a échoué.");

      const remaining = notes.filter((n) => n.id !== id);
      setNotes(remaining);
      if (selectedId === id) {
        if (remaining.length > 0) {
          selectNote(remaining[0]);
        } else {
          setSelectedId(null);
          setDraftTitle("");
          setDraftContent("");
          setIsFullscreen(false);
          setSaveError(false);
        }
      }
      toast({ variant: "success", title: tNotes("toastNoteDeleted", language) });
    } catch (error) {
      toast({ variant: "error", title: tNotes("toastErrorTitle", language), description: error instanceof Error ? error.message : tNotes("toastErrorUnknown", language) });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDeleteNote) return;
    const id = confirmDeleteNote.id;
    setConfirmDeleteNote(null);
    await handleDeleteNoteById(id);
  }

  function openRenameDialog(note: UserNote) {
    setRenamingNote(note);
    setRenameValue(note.title);
  }

  async function handleRenameSubmit() {
    if (!renamingNote || renameValue.trim().length === 0) return;
    const nextTitle = renameValue.trim();
    setIsRenaming(true);
    try {
      const res = await fetch(`/api/notes/${renamingNote.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle, content: renamingNote.content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "Le renommage a échoué.");

      const updatedAt: string = data.updatedAt ?? new Date().toISOString();
      setNotes((prev) => prev.map((n) => (n.id === renamingNote.id ? { ...n, title: nextTitle, updatedAt } : n)));
      if (selectedId === renamingNote.id) setDraftTitle(nextTitle);
      setRenamingNote(null);
      toast({ variant: "success", title: tNotes("toastNoteRenamed", language) });
    } catch (error) {
      toast({ variant: "error", title: tNotes("toastErrorTitle", language), description: error instanceof Error ? error.message : tNotes("toastErrorUnknown", language) });
    } finally {
      setIsRenaming(false);
    }
  }

  return (
    <div
      className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden"
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
    >
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{tNotes("pageTitle", language)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tNotes("pageSubtitle", language)}</p>
      </div>

      {/*
        Master-detail: on mobile (< md) the grid is a single column with no
        row sizing, so the list and the editor used to compete for the same
        shared height and both rendered squashed/unusable at once. Below
        `md`, show exactly one pane at a time instead — the list when no
        note is selected, the editor (with its own "back" button) once one
        is. From `md:` up, both panes render side by side; the sidebar's own
        width is animated (not the grid track) so collapsing it to a slim
        rail doesn't require a second, discontinuous layout.
      */}
      <div className="mt-6 flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <motion.div
          initial={false}
          animate={isDesktopOrTablet ? { width: isSidebarCollapsed ? 0 : SIDEBAR_WIDTH } : { width: "100%" }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className={cn("min-h-0 w-full shrink-0 overflow-hidden", selectedId ? "hidden md:block" : "block")}
        >
          <div
            className="glass-card flex h-full min-h-0 w-full flex-col rounded-2xl border border-border p-3 shadow-glass dark:shadow-glass-dark"
            style={isDesktopOrTablet ? { width: SIDEBAR_WIDTH } : undefined}
          >
            <div className="flex items-center gap-1.5">
              <Button size="sm" className="w-full flex-1 rounded-xl" onClick={handleCreate} disabled={isCreating}>
                {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {tNotes("newNote", language)}
              </Button>
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed(true)}
                aria-label={tNotes("collapseSidebarAriaLabel", language)}
                className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:flex"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>

            <div className="relative mt-3 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={tNotes("searchPlaceholder", language)}
                className="h-10 w-full rounded-xl border border-border bg-transparent pl-9 pr-8 text-sm outline-none transition-colors focus:border-primary/40"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label={tNotes("cancel", language)}
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <BrandLoader className="h-6 w-6" />
                  {tNotes("loading", language)}
                </div>
              ) : notes.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                    <NotebookPen className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{tNotes("notebookEmpty", language)}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tNotes("emptySelectionBodyNoNotes", language)}</p>
                  </div>
                </div>
              ) : filteredNotes.length === 0 ? (
                <p className="px-3 py-10 text-center text-xs text-muted-foreground">{tNotes("noSearchResults", language)}</p>
              ) : (
                <AnimatePresence initial={false}>
                  {filteredNotes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      preview={stripHtmlToText(note.content).trim().slice(0, 90)}
                      isSelected={note.id === selectedId}
                      hasUnsavedEdits={note.id === selectedId && isDirty}
                      isDeleting={deletingId === note.id}
                      onSelect={() => selectNote(note)}
                      onRename={() => openRenameDialog(note)}
                      onDeleteRequest={() => setConfirmDeleteNote(note)}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>
        </motion.div>

        {isSidebarCollapsed && isDesktopOrTablet && (
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed(false)}
            aria-label={tNotes("expandSidebarAriaLabel", language)}
            className="glass-card flex h-10 w-10 shrink-0 items-center justify-center self-start rounded-xl border border-border shadow-glass dark:shadow-glass-dark"
          >
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        )}

        <div
          className={cn(
            "glass-card min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-border shadow-glass dark:shadow-glass-dark",
            !selectedId && "hidden md:flex",
            selectedId && "flex",
            isFullscreen ? "fixed inset-0 z-50 h-dvh w-screen overflow-y-auto rounded-none border-none p-4 sm:p-8" : "h-full overflow-y-auto p-5"
          )}
          // The fullscreen note editor is `fixed inset-0` — it fully escapes
          // this page's own outer keyboardInset-aware wrapper (see that
          // div's own style prop above), so without this, the "Sauvegarder"
          // button at the bottom of the form can end up hidden behind the
          // on-screen keyboard with no scroll room left to reach it. Adds
          // that same reserved space back, scoped to fullscreen only (the
          // non-fullscreen path already gets keyboard clearance from the
          // outer wrapper it never escapes).
          style={isFullscreen && keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
        >
          {!selectedNote ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 shadow-soft dark:bg-primary-900/30 dark:text-primary-400">
                <NotebookPen className="h-7 w-7" />
              </div>
              <div className="max-w-xs">
                <p className="text-sm font-medium text-foreground">
                  {notes.length === 0 ? tNotes("notebookEmpty", language) : tNotes("emptySelectionTitleWithNotes", language)}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {notes.length === 0 ? tNotes("emptySelectionBodyNoNotes", language) : tNotes("emptySelectionBodyWithNotes", language)}
                </p>
              </div>
              <Button size="sm" onClick={handleCreate} disabled={isCreating} className="mt-1 rounded-xl">
                {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {notes.length === 0 ? tNotes("createFirstNote", language) : tNotes("newNote", language)}
              </Button>
            </div>
          ) : (
            <motion.div
              key={selectedNote.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={tNotes("backToListAriaLabel", language)}
                  onClick={() => setSelectedId(null)}
                  className="h-11 w-11 shrink-0 md:hidden md:h-9 md:w-9"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1">
                  <Input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder={tNotes("titlePlaceholder", language)}
                    className="border-none bg-transparent px-0 text-lg font-semibold shadow-none focus:ring-0"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={isFullscreen ? tNotes("exitFullscreenAriaLabel", language) : tNotes("fullscreenAriaLabel", language)}
                  onClick={() => setIsFullscreen((v) => !v)}
                  className="h-11 w-11 md:h-9 md:w-9"
                >
                  {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={tNotes("deleteNoteAriaLabel", language)}
                  onClick={() => setConfirmDeleteNote(selectedNote)}
                  disabled={deletingId === selectedNote.id}
                  className="h-11 w-11 md:h-9 md:w-9"
                >
                  {deletingId === selectedNote.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                </Button>
              </div>

              {/*
                Persistent save-status pill — never a transient toast alone.
                A student re-reading a note five minutes after typing should
                never have to wonder "did that save?"; this always reflects
                the true current state (saving / just-saved / unsaved edits
                pending / last attempt failed), driven by `isDirty` (draft vs.
                the last known server content) plus the saving/error flags.
              */}
              <div className="mt-1 flex items-center gap-1.5 text-sm font-medium" aria-live="polite" role="status">
                {isSaving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground">{tNotes("savingLabel", language)}</span>
                  </>
                ) : saveError ? (
                  <>
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    <span className="text-destructive">{tNotes("saveErrorLabel", language)}</span>
                  </>
                ) : isDirty ? (
                  <>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    <span className="text-amber-600 dark:text-amber-400">{tNotes("unsavedChanges", language)}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400">{tNotes("savedLabel", language)}</span>
                  </>
                )}
              </div>

              <NoteEditor value={draftContent} onChange={setDraftContent} disabled={isOrganizing} />

              {/* Point 1 fix — a direct, unconditional pb-28 on mobile (on
                  top of the keyboardInset padding already applied to the
                  fullscreen wrapper above): guarantees the Save button
                  always clears the fixed bottom nav bar's real footprint,
                  instead of relying only on the shell's generic page-level
                  padding or the keyboard-open-only inset. sm:pb-0 — desktop
                  has no bottom nav to clear, so this would just be dead
                  space there. */}
              <div className="mt-4 flex shrink-0 flex-col gap-2 pb-28 sm:flex-row sm:items-center sm:justify-between sm:pb-0">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleOrganizeByAI}
                    disabled={isOrganizing || stripHtmlToText(draftContent).trim().length === 0}
                    className="h-10 w-full border-purple-500/30 text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-950/30 sm:h-8 sm:w-auto"
                  >
                    {isOrganizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {isOrganizing ? tNotes("organizingLabel", language) : tNotes("organizeButton", language)}
                  </Button>
                  <NoteSummaryButton getPlainText={() => stripHtmlToText(draftContent)} />
                </div>

                <Button size="sm" onClick={handleSave} disabled={isSaving || !isDirty} className="h-10 w-full sm:h-8 sm:w-auto">
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {tNotes("saveButton", language)}
                </Button>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <Dialog open={renamingNote !== null} onOpenChange={(open) => !open && setRenamingNote(null)}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{tNotes("renameDialogTitle", language)}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
            }}
            placeholder={tNotes("titlePlaceholder", language)}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRenamingNote(null)}>
              {tNotes("cancel", language)}
            </Button>
            <Button size="sm" onClick={handleRenameSubmit} disabled={isRenaming || renameValue.trim().length === 0}>
              {isRenaming && <Loader2 className="h-4 w-4 animate-spin" />}
              {tNotes("rename", language)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteNote !== null} onOpenChange={(open) => !open && setConfirmDeleteNote(null)}>
        <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{tNotes("deleteDialogTitle", language)}</DialogTitle>
            <DialogDescription>
              « {confirmDeleteNote?.title} » {tNotes("deleteDialogBodySuffix", language)}
              {confirmDeleteNote && selectedId === confirmDeleteNote.id && isDirty ? tNotes("deleteDialogBodyUnsavedSuffix", language) : ""}
              {tNotes("deleteDialogBodyEnd", language)}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmDeleteNote(null)}>
              {tNotes("cancel", language)}
            </Button>
            <Button type="button" variant="danger" onClick={handleConfirmDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              {tNotes("delete", language)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function NotesPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl py-20 text-center text-sm text-muted-foreground">Chargement...</div>}>
      <NotesPageContent />
    </Suspense>
  );
}
