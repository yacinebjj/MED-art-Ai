"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Maximize2,
  Minimize2,
  MoreVertical,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { cn } from "@/lib/utils";
import { stripHtmlToText } from "@/lib/highlight";
import { useLanguage } from "@/providers/LanguageProvider";
import { tNotes } from "@/lib/translations/notes";
import type { UserNote } from "@/types/user-notes";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

// محرر النصوص الذكي اللي يقبل الألوان والجداول من الذكاء الاصطناعي ديريكت
function HtmlEditor({ value, onChange, disabled }: { value: string; onChange: (val: string) => void; disabled: boolean }) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  return (
    <div
      ref={editorRef}
      contentEditable={!disabled}
      onInput={(e) => onChange(e.currentTarget.innerHTML)}
      className={cn(
        // Sized for comfortable long-session reading: a 16px base with generous
        // line-height and padding reads far better over a full study session
        // than the previous cramped text-sm/p-4 — study notes are re-read for
        // minutes at a time, not skimmed like UI chrome.
        "mt-3 h-full min-h-[300px] w-full min-w-0 flex-1 overflow-y-auto rounded-xl border border-border bg-transparent p-5 text-base leading-[1.8] outline-none transition-opacity sm:p-6",
        "selection:bg-primary-100 selection:text-foreground caret-primary-500 dark:selection:bg-primary-900/50",
        "prose dark:prose-invert max-w-none", // هذي اللي ترد الجداول والعناوين شابين أوتوماتيكيا
        "prose-table:w-full prose-table:border-collapse prose-td:border prose-td:border-border prose-td:p-2 prose-th:border prose-th:border-border prose-th:bg-muted prose-th:p-2", // ستايل الجداول
        disabled && "opacity-50 cursor-not-allowed"
      )}
    />
  );
}

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
        const initial = deepLinked ?? (isDesktopOrTablet ? loaded[0] : undefined);
        if (initial) {
          setSelectedId(initial.id);
          setDraftTitle(initial.title);
          setDraftContent(initial.content); // خلينا المحتوى بالألوان والجداول تاعو
        }
      })
      .catch(() => setNotes([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;
  const selectedOriginalContent = selectedNote ? selectedNote.content : "";
  const isDirty = selectedNote ? draftTitle !== selectedNote.title || draftContent !== selectedOriginalContent : false;

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
      setNotes((prev) => prev.map((n) => (n.id === selectedNote.id ? { ...n, title: finalTitle, content: draftContent } : n)));
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
    // نعتمدو على النص الخام باش نبعثوه للـ AI
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
      toast({ variant: "success", title: "✨ Note organisée avec succès ! N'oublie pas de sauvegarder." });
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

      setNotes((prev) => prev.map((n) => (n.id === renamingNote.id ? { ...n, title: nextTitle } : n)));
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
        <p className="mt-1 text-sm text-muted-foreground">Tes notes personnelles, indépendantes de tes cours.</p>
      </div>

      {/*
        Master-detail: on mobile (< md) the grid is a single column with no
        row sizing, so the list and the editor used to compete for the same
        shared height and both rendered squashed/unusable at once. Below
        `md`, show exactly one pane at a time instead — the list when no
        note is selected, the editor (with its own "back" button) once one
        is. From `md:` up, both panes render side by side exactly as before.
      */}
      <div className="mt-6 min-h-0 flex-1 grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
        <Card className={cn("h-full min-h-0 flex-col p-3", selectedId ? "hidden md:flex" : "flex")}>
          <Button size="sm" className="w-full rounded-xl" onClick={handleCreate} disabled={isCreating}>
            {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {tNotes("newNote", language)}
          </Button>

          <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <BrandLoader className="h-6 w-6" />
                Chargement...
              </div>
            ) : notes.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                  <NotebookPen className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{tNotes("notebookEmpty", language)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Note un résumé, une astuce ou une idée à retenir — elle sera toujours là.
                  </p>
                </div>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {notes.map((note) => {
                  const preview = stripHtmlToText(note.content).trim();
                  const isSelected = note.id === selectedId;
                  const hasUnsavedEdits = isSelected && isDirty;
                  return (
                    <motion.div
                      key={note.id}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      className={cn(
                        "flex items-center gap-2 rounded-xl transition-colors duration-200",
                        isSelected ? "bg-primary-50 dark:bg-primary-900/30" : "hover:bg-accent"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => selectNote(note)}
                        className="min-w-0 flex-1 px-3 py-2.5 text-left transition-transform duration-200 hover:translate-x-0.5"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-foreground">{note.title}</span>
                          {hasUnsavedEdits && (
                            <span
                              aria-label={tNotes("unsavedChanges", language)}
                              title={tNotes("unsavedChanges", language)}
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                            />
                          )}
                        </span>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {formatDate(note.createdAt)} {preview ? `· ${preview.slice(0, 40)}` : ""}
                        </p>
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label="Options de la note"
                            onClick={(e) => e.stopPropagation()}
                            className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            {deletingId === note.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openRenameDialog(note)}>
                            <Pencil className="h-4 w-4" />
                            Renommer
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setConfirmDeleteNote(note)} className="text-destructive focus:text-destructive">
                            <Trash2 className="h-4 w-4" />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </Card>

        <Card
          className={cn(
            "min-h-0 min-w-0 flex-col",
            !selectedId && "hidden md:flex",
            selectedId && "flex",
            isFullscreen ? "fixed inset-0 z-50 h-dvh w-screen overflow-y-auto rounded-none bg-background p-4 sm:p-8" : "h-full p-5"
          )}
        >
          {!selectedNote ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 shadow-soft dark:bg-primary-900/30 dark:text-primary-400">
                <NotebookPen className="h-7 w-7" />
              </div>
              <div className="max-w-xs">
                <p className="text-sm font-medium text-foreground">
                  {notes.length === 0 ? tNotes("notebookEmpty", language) : "Choisis une note à ouvrir"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {notes.length === 0
                    ? "Note un résumé, une astuce ou une idée à retenir — elle sera toujours là."
                    : "Sélectionne une note dans la liste à gauche, ou lance-en une nouvelle."}
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
                  aria-label="Retour à la liste"
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
                  aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
                  onClick={() => setIsFullscreen((v) => !v)}
                  className="h-11 w-11 md:h-9 md:w-9"
                >
                  {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Supprimer la note"
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
                    <span className="text-muted-foreground">Enregistrement...</span>
                  </>
                ) : saveError ? (
                  <>
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    <span className="text-destructive">Échec de l'enregistrement — réessaie</span>
                  </>
                ) : isDirty ? (
                  <>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    <span className="text-amber-600 dark:text-amber-400">{tNotes("unsavedChanges", language)}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400">Enregistré</span>
                  </>
                )}
              </div>

              {/* المكون الجديد: محرر يقبل الجداول والألوان مباشرة */}
              <HtmlEditor value={draftContent} onChange={setDraftContent} disabled={isOrganizing} />

              <div className="mt-4 flex shrink-0 flex-col sm:flex-row justify-between items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOrganizeByAI}
                  disabled={isOrganizing || stripHtmlToText(draftContent).trim().length === 0}
                  className="h-10 sm:h-8 w-full sm:w-auto border-purple-500/30 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/30 dark:text-purple-400"
                >
                  {isOrganizing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  {isOrganizing ? "Organisation en cours..." : "Généré avec l'AI"}
                </Button>

                <Button size="sm" onClick={handleSave} disabled={isSaving || !isDirty} className="h-10 sm:h-8 w-full sm:w-auto">
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Sauvegarder
                </Button>
              </div>
            </motion.div>
          )}
        </Card>
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
              Annuler
            </Button>
            <Button size="sm" onClick={handleRenameSubmit} disabled={isRenaming || renameValue.trim().length === 0}>
              {isRenaming && <Loader2 className="h-4 w-4 animate-spin" />}
              Renommer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteNote !== null} onOpenChange={(open) => !open && setConfirmDeleteNote(null)}>
        <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Supprimer la note ?</DialogTitle>
            <DialogDescription>
              « {confirmDeleteNote?.title} » sera supprimée définitivement
              {confirmDeleteNote && selectedId === confirmDeleteNote.id && isDirty
                ? ", y compris les modifications non enregistrées que tu es en train d'écrire"
                : ""}
              . Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmDeleteNote(null)}>
              Annuler
            </Button>
            <Button type="button" variant="danger" onClick={handleConfirmDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              Supprimer
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