"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileText, Loader2, Maximize2, Minimize2, MoreVertical, Pencil, Plus, Trash2, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { cn } from "@/lib/utils";
import { stripHtmlToText } from "@/lib/highlight";
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
        "mt-3 h-full min-h-[300px] w-full min-w-0 flex-1 overflow-y-auto rounded-xl border border-border bg-transparent p-4 text-sm leading-relaxed outline-none transition-opacity",
        "prose prose-sm dark:prose-invert max-w-none", // هذي اللي ترد الجداول والعناوين شابين أوتوماتيكيا
        "prose-table:w-full prose-table:border-collapse prose-td:border prose-td:border-border prose-td:p-2 prose-th:border prose-th:border-border prose-th:bg-muted prose-th:p-2", // ستايل الجداول
        disabled && "opacity-50 cursor-not-allowed"
      )}
    />
  );
}

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
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingNote, setRenamingNote] = useState<UserNote | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [confirmDeleteNote, setConfirmDeleteNote] = useState<UserNote | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
        const initial = deepLinked ?? loaded[0];
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
      toast({ variant: "success", title: "Note enregistrée" });
    } catch (error) {
      toast({ variant: "error", title: "Échec", description: error instanceof Error ? error.message : "Erreur inconnue." });
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
      toast({ variant: "error", title: "Échec", description: error instanceof Error ? error.message : "Erreur inconnue." });
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
        }
      }
      toast({ variant: "success", title: "Note supprimée" });
    } catch (error) {
      toast({ variant: "error", title: "Échec", description: error instanceof Error ? error.message : "Erreur inconnue." });
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

              {/* المكون الجديد: محرر يقبل الجداول والألوان مباشرة */}
              <HtmlEditor value={draftContent} onChange={setDraftContent} disabled={isOrganizing} />

              <div className="mt-4 flex flex-col sm:flex-row justify-between items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOrganizeByAI}
                  disabled={isOrganizing || stripHtmlToText(draftContent).trim().length === 0}
                  className="w-full sm:w-auto border-purple-500/30 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/30 dark:text-purple-400"
                >
                  {isOrganizing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  {isOrganizing ? "Organisation en cours..." : "Généré avec l'AI"}
                </Button>

                <Button size="sm" onClick={handleSave} disabled={isSaving || !isDirty} className="w-full sm:w-auto">
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
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

export default function NotesPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl py-20 text-center text-sm text-muted-foreground">Chargement...</div>}>
      <NotesPageContent />
    </Suspense>
  );
}