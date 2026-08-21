"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileText, Loader2, Maximize2, Minimize2, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { TextSelectionToolbar } from "@/components/course/workspace/TextSelectionToolbar";
import { useTextSelection } from "@/hooks/useTextSelection";
import { cn } from "@/lib/utils";
import { sanitizeNoteHtml, stripHtmlToText } from "@/lib/highlight";
import type { UserNote } from "@/types/user-notes";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * "Mes notes" — free-standing student notes (see app/api/notes, app/api/notes/[id]),
 * unrelated to any course/module. Classic list-left / editor-right layout:
 * selecting a note loads its title/content into local draft state, "Sauvegarder"
 * PUTs only when the draft actually differs from the loaded note.
 *
 * `content` is HTML (not plain text) — the editor is a `contentEditable` div
 * so highlights made with TextSelectionToolbar (real `<mark>` elements) can
 * render and persist. `dangerouslySetInnerHTML` is fed `selectedNote.content`
 * (the last SAVED value), never the live `draftContent` — the two only
 * become equal again right after a save, so React never fights the browser
 * for control of the DOM while the student is actively typing (which would
 * otherwise reset the cursor position on every keystroke).
 *
 * `?noteId=` deep-link: TextSelectionToolbar's "Add Note" button creates the
 * note server-side first (so its id exists), then navigates here with
 * `?noteId=<id>` — read once on load so that specific note opens pre-selected
 * instead of whatever the newest note happens to be.
 */
function NotesPageContent() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const deepLinkedNoteId = searchParams.get("noteId");
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingNote, setRenamingNote] = useState<UserNote | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  // Deletion is irreversible and can silently discard an unsaved in-progress
  // edit if the note being deleted is also the one currently open — this
  // holds the PENDING target so a confirmation dialog gates the actual
  // delete, instead of the trash icon/menu item deleting on the very first
  // click (see handleDeleteNoteById below).
  const [confirmDeleteNote, setConfirmDeleteNote] = useState<UserNote | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const { containerRef, tooltipRef, selection, clearSelection } = useTextSelection();

  // Escape exits fullscreen — same convention as StudioPanel's own expanded-
  // section overlay. Only listens while actually fullscreen, so it never
  // intercepts an Escape meant for something else (a Dialog stacked on top).
  useEffect(() => {
    if (!isFullscreen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsFullscreen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  /** Ask MedArt / Translate need a course context this standalone notes page doesn't have — honest info toast instead of a silently-broken action. Search Web, Add Note, and Highlight/Unhighlight all work exactly as everywhere else. */
  function handleAskFromNote() {
    clearSelection();
    toast({
      variant: "info",
      title: "Indisponible ici",
      description: "Ask MedArt fonctionne depuis un cours — ouvre une source dans un module pour poser une question.",
    });
  }
  function handleTranslateFromNote() {
    clearSelection();
    toast({
      variant: "info",
      title: "Indisponible ici",
      description: "La traduction fonctionne depuis un cours — ouvre une source dans un module.",
    });
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notes")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const loaded: UserNote[] = data?.success ? data.notes ?? [] : [];
        setNotes(loaded);

        const deepLinked = deepLinkedNoteId ? loaded.find((n) => n.id === deepLinkedNoteId) : undefined;
        const initial = deepLinked ?? loaded[0];
        if (initial) {
          setSelectedId(initial.id);
          setDraftTitle(initial.title);
          setDraftContent(initial.content);
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
  const isDirty = selectedNote ? draftTitle !== selectedNote.title || draftContent !== selectedNote.content : false;
  const isContentEmpty = stripHtmlToText(draftContent).trim().length === 0;

  // Sanitized once per note (id+content), not on every keystroke — see the
  // component doc comment for why this, and never `draftContent`, feeds the
  // contentEditable div's initial HTML.
  const sanitizedSelectedContent = useMemo(
    () => (selectedNote ? sanitizeNoteHtml(selectedNote.content) : ""),
    [selectedNote?.id, selectedNote?.content]
  );

  /** Merges the plain innerHTML-reading ref with useTextSelection's callback ref — both need to observe the same contentEditable node. */
  function setEditorRef(node: HTMLDivElement | null) {
    editorRef.current = node;
    containerRef(node);
  }

  function selectNote(note: UserNote) {
    setSelectedId(note.id);
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setIsFullscreen(false);
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
      toast({ variant: "error", title: "Échec", description: error instanceof Error ? error.message : "Erreur inconnue." });
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSave() {
    if (!selectedNote) return;
    setIsSaving(true);
    try {
      const cleanContent = sanitizeNoteHtml(draftContent);
      const res = await fetch(`/api/notes/${selectedNote.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draftTitle, content: cleanContent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "L'enregistrement a échoué.");

      const finalTitle = draftTitle.trim() || "Note sans titre";
      setNotes((prev) => prev.map((n) => (n.id === selectedNote.id ? { ...n, title: finalTitle, content: cleanContent } : n)));
      setDraftTitle(finalTitle);
      setDraftContent(cleanContent);
      toast({ variant: "success", title: "Note enregistrée" });
    } catch (error) {
      toast({ variant: "error", title: "Échec", description: error instanceof Error ? error.message : "Erreur inconnue." });
    } finally {
      setIsSaving(false);
    }
  }

  /** Usable from the list's per-note dropdown (any note) as well as the editor's own trash icon (the selected note). Only ever called after the confirmation dialog below — never directly from a click handler. */
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
        }
      }
      toast({ variant: "success", title: "Note supprimée" });
    } catch (error) {
      toast({ variant: "error", title: "Échec", description: error instanceof Error ? error.message : "Erreur inconnue." });
    } finally {
      setDeletingId(null);
    }
  }

  /** The confirmation dialog's own "Supprimer" button — the only path that ever reaches handleDeleteNoteById. */
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
    // Guards the Enter-key path too — the button's own `disabled` below only
    // stops a click, not an Enter press typed into an empty/whitespace-only
    // field. No more silent fallback to "Note sans titre": an empty title is
    // now simply refused rather than auto-renamed to something the student
    // never typed.
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
      toast({ variant: "success", title: "Note renommée" });
    } catch (error) {
      toast({ variant: "error", title: "Échec", description: error instanceof Error ? error.message : "Erreur inconnue." });
    } finally {
      setIsRenaming(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Mes notes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tes notes personnelles, indépendantes de tes cours.</p>
      </div>

      <div className="mt-6 min-h-0 flex-1 grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
        <Card className="flex h-full min-h-0 flex-col p-3">
          <Button size="sm" className="w-full rounded-xl" onClick={handleCreate} disabled={isCreating}>
            {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Nouvelle note
          </Button>

          <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <BrandLoader className="h-6 w-6" />
                Chargement...
              </div>
            ) : notes.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                <FileText className="h-6 w-6 opacity-50" />
                <p className="text-xs">Aucune note pour l'instant.</p>
              </div>
            ) : (
              notes.map((note) => {
                const preview = stripHtmlToText(note.content).trim();
                return (
                  <div
                    key={note.id}
                    className={cn(
                      "flex items-center gap-1 rounded-xl transition-colors",
                      note.id === selectedId ? "bg-primary-50 dark:bg-primary-900/30" : "hover:bg-accent"
                    )}
                  >
                    <button type="button" onClick={() => selectNote(note)} className="min-w-0 flex-1 px-3 py-2.5 text-left">
                      <p className="truncate text-sm font-medium text-foreground">{note.title}</p>
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
                          className="mr-1 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <Card
          className={cn(
            "flex min-h-0 min-w-0 flex-col",
            isFullscreen ? "fixed inset-0 z-50 h-screen w-screen overflow-y-auto rounded-none bg-background p-8" : "h-full p-5"
          )}
        >
          {!selectedNote ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <FileText className="h-8 w-8 opacity-40" />
              <p className="text-sm">Sélectionne une note, ou crée-en une nouvelle.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="Titre de la note"
                    className="border-none bg-transparent px-0 text-lg font-semibold shadow-none focus:ring-0"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
                  onClick={() => setIsFullscreen((v) => !v)}
                >
                  {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Supprimer la note"
                  onClick={() => setConfirmDeleteNote(selectedNote)}
                  disabled={deletingId === selectedNote.id}
                >
                  {deletingId === selectedNote.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                </Button>
              </div>

              {/* Rich-text body — a contentEditable div (not a <textarea>) so
                  TextSelectionToolbar's highlights render as real <mark>
                  elements; switching to a plain textarea would show raw
                  "<mark>...</mark>" tags as literal text instead of a
                  highlight. `key={selectedNote.id}` forces a full remount on
                  note switch, so the browser's own undo history and any
                  lingering composition state never bleed from one note into
                  another.

                  `min-w-0` on this flex item is load-bearing, not
                  decorative: without it, a long unbroken token (a URL, a
                  chemical name) in the note's content forces this whole flex
                  child — and the Card column it sits in — wider than the
                  viewport instead of wrapping, which pushes the actual
                  editable surface out from under wherever the student
                  visually clicks. `break-words`/`whitespace-pre-wrap` alone
                  do NOT fix that in a flex layout; `min-w-0` does. */}
              <div className="relative mt-3 min-h-0 min-w-0 flex-1">
                {isContentEmpty && (
                  <p className="pointer-events-none absolute inset-0 p-4 text-sm text-muted-foreground">
                    Écris ta note ici...
                  </p>
                )}
                <div
                  key={selectedNote.id}
                  ref={setEditorRef}
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-multiline="true"
                  onInput={(e) => setDraftContent(e.currentTarget.innerHTML)}
                  dangerouslySetInnerHTML={{ __html: sanitizedSelectedContent }}
                  className="h-full w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-transparent p-4 text-sm leading-relaxed text-foreground outline-none [&_mark]:text-gray-900"
                />
              </div>

              {selection && (
                <TextSelectionToolbar
                  ref={tooltipRef}
                  selection={selection}
                  onAsk={handleAskFromNote}
                  onTranslate={handleTranslateFromNote}
                  onHighlightChange={() => {
                    if (editorRef.current) setDraftContent(editorRef.current.innerHTML);
                  }}
                />
              )}

              <div className="mt-3 flex justify-end">
                <Button size="sm" onClick={handleSave} disabled={isSaving || !isDirty}>
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Sauvegarder
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <Dialog open={renamingNote !== null} onOpenChange={(open) => !open && setRenamingNote(null)}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Renommer la note</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
            }}
            placeholder="Titre de la note"
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

/** useSearchParams() (read by NotesPageContent, for the ?noteId= deep link) requires a Suspense boundary at build time — this wrapper is purely that, no logic of its own. */
export default function NotesPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl py-20 text-center text-sm text-muted-foreground">Chargement...</div>}>
      <NotesPageContent />
    </Suspense>
  );
}
