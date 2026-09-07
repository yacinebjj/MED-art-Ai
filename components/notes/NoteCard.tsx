"use client";

import { motion, useMotionValue, useTransform } from "framer-motion";
import { Loader2, MoreVertical, Pencil, Trash2 } from "lucide-react";
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
  isSelected: boolean;
  hasUnsavedEdits: boolean;
  isDeleting: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDeleteRequest: () => void;
}

const SWIPE_REVEAL_THRESHOLD = 72;

/**
 * Rich note card — real module badge (only when moduleId/moduleTitle are
 * set, see UserNote's own doc comment), real "modifié il y a X" from
 * updatedAt, a 2-line stripped-HTML preview. Swipe-left on mobile reveals a
 * delete affordance that opens the SAME confirm dialog as the desktop menu
 * (never an immediate silent delete — a note can hold a lot of writing).
 */
export function NoteCard({ note, preview, isSelected, hasUnsavedEdits, isDeleting, onSelect, onRename, onDeleteRequest }: NoteCardProps) {
  const { language } = useLanguage();
  const x = useMotionValue(0);
  const deleteZoneOpacity = useTransform(x, [-SWIPE_REVEAL_THRESHOLD, 0], [1, 0]);

  function handleDragEnd(_event: unknown, info: { offset: { x: number } }) {
    if (info.offset.x <= -SWIPE_REVEAL_THRESHOLD) onDeleteRequest();
  }

  return (
    <div className="relative">
      <motion.div
        style={{ opacity: deleteZoneOpacity }}
        className="absolute inset-y-0 right-0 z-0 flex w-20 items-center justify-end rounded-r-2xl bg-destructive pr-4 text-destructive-foreground"
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
          "glass-card relative z-10 flex items-start gap-2 rounded-2xl border p-3 shadow-glass transition-colors duration-200 dark:shadow-glass-dark",
          isSelected ? "border-primary/40 bg-primary-50/60 shadow-glow dark:bg-primary-900/20" : "border-border hover:border-primary/20 hover:shadow-soft"
        )}
      >
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 min-h-12 text-left">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{note.title}</span>
            {hasUnsavedEdits && (
              <span
                aria-label={tNotes("unsavedChanges", language)}
                title={tNotes("unsavedChanges", language)}
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
              />
            )}
            {note.moduleId !== null && note.moduleTitle && <ModuleBadge moduleId={note.moduleId} moduleTitle={note.moduleTitle} />}
          </span>
          {preview && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{preview}</p>}
          <p className="mt-1.5 text-[11px] font-medium text-muted-foreground/80">{formatRelativeTime(note.updatedAt, language)}</p>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={tNotes("noteOptionsAriaLabel", language)}
              onClick={(e) => e.stopPropagation()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
