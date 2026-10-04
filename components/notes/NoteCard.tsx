"use client";

import { motion, useMotionValue, useTransform } from "framer-motion";
import { Clock3, FileText, Loader2, MoreVertical, Pencil, Sparkle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import { ModuleBadge } from "./ModuleBadge";
import { formatRelativeTime } from "@/lib/relative-time";
import { useLanguage } from "@/providers/LanguageProvider";
import { tNotes } from "@/lib/translations/notes";
import type { UserNote } from "@/types/user-notes";

interface NoteCardProps {
  note: UserNote;
  preview: string;
  /** Real word count of the note body (stripped HTML). */
  wordCount: number;
  isSelected: boolean;
  hasUnsavedEdits: boolean;
  isDeleting: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDeleteRequest: () => void;
}

const SWIPE_REVEAL_THRESHOLD = 72;
const RECENT_MS = 24 * 60 * 60 * 1000;

/**
 * Note card — real module badge, real "modifié il y a X", live status badges
 * derived from the note itself (unsaved, fresh, empty, length). Swipe-left on
 * mobile reveals a delete affordance that opens the SAME confirm dialog as
 * the desktop menu (never an immediate silent delete).
 */
export function NoteCard({ note, preview, wordCount, isSelected, hasUnsavedEdits, isDeleting, onSelect, onRename, onDeleteRequest }: NoteCardProps) {
  const { language } = useLanguage();
  const x = useMotionValue(0);
  const deleteZoneOpacity = useTransform(x, [-SWIPE_REVEAL_THRESHOLD, 0], [1, 0]);
  const updatedMs = new Date(note.updatedAt).getTime();
  const isFresh = Number.isFinite(updatedMs) && Date.now() - updatedMs < RECENT_MS;
  const isEmpty = wordCount === 0;
  const readMinutes = Math.max(1, Math.round(wordCount / 200));

  function handleDragEnd(_event: unknown, info: { offset: { x: number } }) {
    if (info.offset.x <= -SWIPE_REVEAL_THRESHOLD) onDeleteRequest();
  }

  return (
    <div className="relative">
      <motion.div
        style={{ opacity: deleteZoneOpacity }}
        className="absolute inset-y-0 right-0 z-0 flex w-20 items-center justify-end rounded-r-2xl bg-rose-600 pr-4 text-white"
      >
        <Trash2 className="h-4 w-4" />
      </motion.div>

      <motion.div
        drag="x"
        dragConstraints={{ left: -SWIPE_REVEAL_THRESHOLD - 16, right: 0 }}
        dragElastic={0.1}
        dragDirectionLock
        dragSnapToOrigin
        style={{ x }}
        onDragEnd={handleDragEnd}
        layout
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className={cn(
          "relative z-10 flex items-start gap-2 overflow-hidden rounded-2xl border p-3 transition-[border-color,box-shadow,background-color] duration-200",
          isSelected
            ? "border-cyan-400/50 bg-slate-900 shadow-[0_0_24px_-6px_rgba(34,211,238,0.45)]"
            : "border-white/[0.07] bg-slate-950 hover:border-white/20 hover:bg-slate-900"
        )}
      >
        {isSelected && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-gradient-to-b from-cyan-300 to-violet-500" />}
        <button type="button" onClick={onSelect} className="min-h-12 min-w-0 flex-1 text-left">
          <span className="flex items-center gap-1.5">
            <span className={cn("truncate text-sm font-bold", isSelected ? "text-white" : "text-slate-200")}>{note.title}</span>
            {hasUnsavedEdits && (
              <span aria-label={tNotes("unsavedChanges", language)} title={tNotes("unsavedChanges", language)} className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/60" />
                <span className="relative h-2 w-2 rounded-full bg-amber-400" />
              </span>
            )}
          </span>
          {preview ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">{preview}</p> : <p className="mt-1 text-xs italic text-slate-600">—</p>}
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {note.moduleId !== null && note.moduleTitle && <ModuleBadge moduleId={note.moduleId} moduleTitle={note.moduleTitle} />}
            {isFresh && (
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-200">
                <Sparkle className="h-2.5 w-2.5" />
                {language === "fr" ? "Récente" : "Fresh"}
              </span>
            )}
            {isEmpty ? (
              <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{language === "fr" ? "Vide" : "Empty"}</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                <FileText className="h-2.5 w-2.5" />
                {wordCount} {language === "fr" ? "mots" : "words"} · {readMinutes} min
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500">
              <Clock3 className="h-2.5 w-2.5" />
              {formatRelativeTime(note.updatedAt, language)}
            </span>
          </span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={tNotes("noteOptionsAriaLabel", language)}
              onClick={(e) => e.stopPropagation()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-white/10 hover:text-white"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRename}>
              <Pencil className="h-4 w-4" />
              {tNotes("rename", language)}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDeleteRequest} className="text-destructive focus:text-destructive">
              <Trash2 className="h-4 w-4" />
              {tNotes("delete", language)}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </motion.div>
    </div>
  );
}
