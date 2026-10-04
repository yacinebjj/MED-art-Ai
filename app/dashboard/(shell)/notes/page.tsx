"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowDownAZ,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  NotebookPen,
  Plus,
  Search,
  Sparkles,
  Timer,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { FullscreenViewerModal } from "@/components/ui/FullscreenViewerModal";
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
import { CyberHeader, CyberPanel, CyberStage, SegmentedControl } from "@/components/cyber/primitives";
import { useStoredPreference } from "@/components/cyber/hooks";
import type { UserNote } from "@/types/user-notes";

const SIDEBAR_WIDTH = 320;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const NOTE_FILTERS = ["all", "recent", "module"] as const;
type NoteFilter = (typeof NOTE_FILTERS)[number];
const NOTE_SORTS = ["updated", "alpha", "length"] as const;
type NoteSort = (typeof NOTE_SORTS)[number];

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function NotesPageContent() {
  const { toast } = useToast();
  const { language } = useLanguage();
  const fr = language === "fr";
  const searchParams = useSearchParams();
  const deepLinkedNoteId = searchParams.get("noteId");
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useStoredPreference<NoteFilter>("medart:notes-filter", "all", NOTE_FILTERS);
  const [sort, setSort] = useStoredPreference<NoteSort>("medart:notes-sort", "updated", NOTE_SORTS);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Persistent save-status pill state (a toast alone disappears).
  const [saveError, setSaveError] = useState(false);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingNote, setRenamingNote] = useState<UserNote | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [confirmDeleteNote, setConfirmDeleteNote] = useState<UserNote | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // On mobile the list and the editor share one view: no auto-open of the first note there.
  const isDesktopOrTablet = useMediaQuery("(min-width: 768px)");
  // The bootstrap fetch below reads this inside an async callback — a ref avoids a stale closure.
  const isDesktopOrTabletRef = useRef(isDesktopOrTablet);
  useEffect(() => {
    isDesktopOrTabletRef.current = isDesktopOrTablet;
  }, [isDesktopOrTablet]);
  // iOS Safari: keep the save bar above the virtual keyboard.
  const keyboardInset = useKeyboardInset();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notes")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const loaded: UserNote[] = data?.success ? data.notes ?? [] : [];
        setNotes(loaded);

        const deepLinked = deepLinkedNoteId ? loaded.find((n) => n.id === deepLinkedNoteId) : undefined;
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
    // Runs once on mount to resume/deep-link into a note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;
  const selectedOriginalContent = selectedNote ? selectedNote.content : "";
  const isDirty = selectedNote ? draftTitle !== selectedNote.title || draftContent !== selectedOriginalContent : false;

  // Plain text of every note, computed once per notes change (search, previews, badges, stats).
  const plainById = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of notes) map.set(note.id, stripHtmlToText(note.content));
    return map;
  }, [notes]);

  const totalWords = useMemo(() => {
    let sum = 0;
    plainById.forEach((text) => {
      sum += countWords(text);
    });
    return sum;
  }, [plainById]);

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = Date.now();
    const list = notes.filter((n) => {
      if (filter === "recent" && !(now - new Date(n.updatedAt).getTime() < WEEK_MS)) return false;
      if (filter === "module" && n.moduleId === null) return false;
      if (!q) return true;
      return n.title.toLowerCase().includes(q) || (plainById.get(n.id) ?? "").toLowerCase().includes(q);
    });
    if (sort === "alpha") list.sort((a, b) => a.title.localeCompare(b.title, language));
    else if (sort === "length") list.sort((a, b) => countWords(plainById.get(b.id) ?? "") - countWords(plainById.get(a.id) ?? ""));
    else list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return list;
  }, [notes, searchQuery, filter, sort, plainById, language]);

  const recentCount = useMemo(() => notes.filter((n) => Date.now() - new Date(n.updatedAt).getTime() < WEEK_MS).length, [notes]);
  const moduleCount = useMemo(() => notes.filter((n) => n.moduleId !== null).length, [notes]);

  // Live counters for the note being edited.
  const draftPlain = useMemo(() => stripHtmlToText(draftContent), [draftContent]);
  const draftWords = countWords(draftPlain);
  const draftChars = draftPlain.replace(/\s/g, "").length;
  const draftReadMinutes = Math.max(1, Math.round(draftWords / 200));

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

  // Ctrl/Cmd + S saves the open note.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  const iconButton =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40 md:h-9 md:w-9";

  // Shared between the inline panel AND the fullscreen portal below — one implementation, two mounts.
  const editorContent = selectedNote && (
    <motion.div
      key={selectedNote.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label={tNotes("backToListAriaLabel", language)} onClick={() => setSelectedId(null)} className={cn(iconButton, "md:hidden")}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder={tNotes("titlePlaceholder", language)}
            className="w-full bg-transparent text-xl font-black tracking-tight text-white outline-none placeholder:text-slate-600 sm:text-2xl"
          />
        </div>
        <button
          type="button"
          aria-label={isFullscreen ? tNotes("exitFullscreenAriaLabel", language) : tNotes("fullscreenAriaLabel", language)}
          onClick={() => setIsFullscreen((v) => !v)}
          className={iconButton}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          aria-label={tNotes("deleteNoteAriaLabel", language)}
          onClick={() => setConfirmDeleteNote(selectedNote)}
          disabled={deletingId === selectedNote.id}
          className={cn(iconButton, "hover:bg-rose-500/15 hover:text-rose-300")}
        >
          {deletingId === selectedNote.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>

      {/* Persistent status badges — the save state is always on screen, never only a toast. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold" aria-live="polite" role="status">
        {isSaving ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-cyan-200">
            <Loader2 className="h-3 w-3 animate-spin" />
            {tNotes("savingLabel", language)}
          </span>
        ) : saveError ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/40 bg-rose-500/10 px-2.5 py-1 text-rose-200">
            <AlertCircle className="h-3 w-3" />
            {tNotes("saveErrorLabel", language)}
          </span>
        ) : isDirty ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
            {tNotes("unsavedChanges", language)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-emerald-200">
            <CheckCircle2 className="h-3 w-3" />
            {tNotes("savedLabel", language)}
          </span>
        )}
        {selectedNote.moduleTitle && (
          <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-400/10 px-2.5 py-1 text-violet-200">
            <Layers className="h-3 w-3" />
            {selectedNote.moduleTitle}
          </span>
        )}
        {isOrganizing && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/30 bg-fuchsia-400/10 px-2.5 py-1 text-fuchsia-200">
            <Sparkles className="h-3 w-3 animate-pulse" />
            {tNotes("organizingLabel", language)}
          </span>
        )}
      </div>

      <NoteEditor value={draftContent} onChange={setDraftContent} disabled={isOrganizing} />

      {/* pb-28 on mobile clears the floating bottom nav; desktop has none. */}
      <div className="mt-4 flex shrink-0 flex-col gap-3 pb-28 sm:pb-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-slate-500">
          <span className="flex items-center gap-1">
            <Type className="h-3 w-3 text-cyan-300/70" />
            {draftWords} {fr ? "mots" : "words"}
          </span>
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3 text-cyan-300/70" />
            {draftChars} {fr ? "caractères" : "characters"}
          </span>
          <span className="flex items-center gap-1">
            <Timer className="h-3 w-3 text-cyan-300/70" />~{draftReadMinutes} min {fr ? "de lecture" : "read"}
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <kbd className="rounded border border-white/15 px-1 font-mono text-[10px]">Ctrl</kbd>+<kbd className="rounded border border-white/15 px-1 font-mono text-[10px]">S</kbd>
            {fr ? "pour sauvegarder" : "to save"}
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleOrganizeByAI}
              disabled={isOrganizing || draftPlain.trim().length === 0}
              className="group relative flex h-10 w-full items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/10 px-3.5 text-xs font-bold text-fuchsia-100 transition-[background-color,box-shadow] hover:bg-fuchsia-500/20 hover:shadow-[0_0_22px_rgba(217,70,239,0.3)] disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-auto"
            >
              <span aria-hidden className="cyber-sheen" />
              {isOrganizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isOrganizing ? tNotes("organizingLabel", language) : tNotes("organizeButton", language)}
            </button>
            <NoteSummaryButton getPlainText={() => draftPlain} />
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-sky-400 px-5 text-sm font-black text-slate-950 shadow-[0_0_22px_rgba(34,211,238,0.35)] transition-[transform,opacity] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none sm:h-9 sm:w-auto"
          >
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {tNotes("saveButton", language)}
          </button>
        </div>
      </div>
    </motion.div>
  );

  return (
    <CyberStage
      accent="violet"
      className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden p-3 sm:p-5"
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
    >
      <CyberHeader
        className="shrink-0"
        icon={NotebookPen}
        kicker={fr ? "Carnet de bord" : "Logbook"}
        title={tNotes("pageTitle", language)}
        subtitle={tNotes("pageSubtitle", language)}
        actions={
          !loading && notes.length > 0 ? (
            <div className="hidden items-center gap-2 sm:flex">
              <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-slate-300">
                <b className="text-white">{notes.length}</b> notes
              </span>
              <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-slate-300">
                <b className="text-white">{totalWords.toLocaleString(language)}</b> {fr ? "mots" : "words"}
              </span>
            </div>
          ) : undefined
        }
      />

      {/*
        Master-detail: below md exactly one pane shows (list, or the editor
        with its own back button); from md up both sit side by side and the
        sidebar's width animates when collapsed.
      */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 md:flex-row sm:mt-5">
        <motion.div
          initial={false}
          animate={isDesktopOrTablet ? { width: isSidebarCollapsed ? 0 : SIDEBAR_WIDTH } : { width: "100%" }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          // max-md:flex-1: on phones this pane needs a real height for its list to scroll.
          className={cn("min-h-0 w-full overflow-hidden max-md:flex-1 md:shrink-0", selectedId ? "hidden md:block" : "block")}
        >
          <CyberPanel className="flex h-full min-h-0 w-full flex-col p-3" style={isDesktopOrTablet ? { width: SIDEBAR_WIDTH } : undefined}>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating}
                className="group relative flex h-11 flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-500 text-sm font-black text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.35)] transition-transform active:scale-95 disabled:opacity-60"
              >
                <span aria-hidden className="cyber-sheen" />
                {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {tNotes("newNote", language)}
              </button>
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed(true)}
                aria-label={tNotes("collapseSidebarAriaLabel", language)}
                className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white/10 hover:text-white md:flex"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>

            <div className="relative mt-3 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={tNotes("searchPlaceholder", language)}
                className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/60 pl-9 pr-8 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-400/50"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label={tNotes("cancel", language)}
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-white/10"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="mt-2.5 flex shrink-0 items-center gap-1.5">
              <SegmentedControl<NoteFilter>
                size="sm"
                className="min-w-0 flex-1"
                ariaLabel={fr ? "Filtrer les notes" : "Filter notes"}
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: fr ? "Toutes" : "All", count: notes.length },
                  { value: "recent", label: fr ? "7 j" : "7 d", count: recentCount },
                  { value: "module", label: "Modules", count: moduleCount },
                ]}
              />
              <button
                type="button"
                onClick={() => setSort(sort === "updated" ? "alpha" : sort === "alpha" ? "length" : "updated")}
                title={sort === "updated" ? (fr ? "Tri : récentes" : "Sort: recent") : sort === "alpha" ? (fr ? "Tri : A → Z" : "Sort: A → Z") : fr ? "Tri : les plus longues" : "Sort: longest"}
                aria-label={fr ? "Changer le tri" : "Change sort"}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-200"
              >
                {sort === "updated" ? <Clock3 className="h-4 w-4" /> : sort === "alpha" ? <ArrowDownAZ className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              </button>
            </div>

            <div className="cyber-scrollbar mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
                  <BrandLoader className="h-6 w-6" />
                  {tNotes("loading", language)}
                </div>
              ) : notes.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-200 ring-1 ring-inset ring-cyan-400/30">
                    <NotebookPen className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{tNotes("notebookEmpty", language)}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">{tNotes("emptySelectionBodyNoNotes", language)}</p>
                  </div>
                </div>
              ) : filteredNotes.length === 0 ? (
                <p className="px-3 py-10 text-center text-xs text-slate-500">{tNotes("noSearchResults", language)}</p>
              ) : (
                <AnimatePresence initial={false}>
                  {filteredNotes.map((note) => {
                    const plain = plainById.get(note.id) ?? "";
                    return (
                      <NoteCard
                        key={note.id}
                        note={note}
                        preview={plain.trim().slice(0, 90)}
                        wordCount={countWords(plain)}
                        isSelected={note.id === selectedId}
                        hasUnsavedEdits={note.id === selectedId && isDirty}
                        isDeleting={deletingId === note.id}
                        onSelect={() => selectNote(note)}
                        onRename={() => openRenameDialog(note)}
                        onDeleteRequest={() => setConfirmDeleteNote(note)}
                      />
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </CyberPanel>
        </motion.div>

        {isSidebarCollapsed && isDesktopOrTablet && (
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed(false)}
            aria-label={tNotes("expandSidebarAriaLabel", language)}
            className="flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-xl border border-white/10 bg-slate-950/70 text-slate-300 transition-colors hover:border-cyan-400/40 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        <CyberPanel
          className={cn("h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6", !selectedId && "hidden md:flex", selectedId && "flex")}
        >
          {!selectedNote ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-400/20 to-violet-500/20 text-cyan-100 ring-1 ring-inset ring-white/15">
                <span aria-hidden className="cyber-breathe absolute inset-0 rounded-3xl bg-cyan-400/10" />
                <NotebookPen className="relative h-8 w-8" />
              </div>
              <div className="max-w-xs">
                <p className="text-sm font-bold text-white">{notes.length === 0 ? tNotes("notebookEmpty", language) : tNotes("emptySelectionTitleWithNotes", language)}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {notes.length === 0 ? tNotes("emptySelectionBodyNoNotes", language) : tNotes("emptySelectionBodyWithNotes", language)}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating}
                className="flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-sky-400 px-5 text-sm font-black text-slate-950 shadow-[0_0_22px_rgba(34,211,238,0.35)] active:scale-95 disabled:opacity-60"
              >
                {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {notes.length === 0 ? tNotes("createFirstNote", language) : tNotes("newNote", language)}
              </button>
            </div>
          ) : (
            editorContent
          )}
        </CyberPanel>
      </div>

      {/* True fullscreen — a portal to document.body (PageTransition's transform would otherwise contain `fixed`). */}
      <FullscreenViewerModal open={isFullscreen && !!selectedNote} onClose={() => setIsFullscreen(false)} title={draftTitle || tNotes("titlePlaceholder", language)}>
        <div className="cyber-stage min-h-full rounded-none border-0 p-4 sm:p-6" style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}>
          {editorContent}
        </div>
      </FullscreenViewerModal>

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
    </CyberStage>
  );
}

export default function NotesPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl py-20 text-center text-sm text-muted-foreground">Chargement...</div>}>
      <NotesPageContent />
    </Suspense>
  );
}
