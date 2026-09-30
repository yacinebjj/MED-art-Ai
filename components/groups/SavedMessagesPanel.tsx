"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, ImageIcon, Mic, Trash2, Video, X } from "lucide-react";
import { BottomSheetHandle, useBottomSheetMotion } from "@/components/ui/BottomSheet";
import type { SavedMessage } from "@/hooks/useSavedMessages";

interface SavedMessagesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  saved: SavedMessage[];
  onRemove: (messageId: string) => void;
  currentGroupId: string;
}

const TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const MEDIA_LABEL: Record<Exclude<SavedMessage["type"], "text">, { label: string; icon: typeof ImageIcon }> = {
  image: { label: "Photo", icon: ImageIcon },
  video: { label: "Vidéo", icon: Video },
  audio: { label: "Message vocal", icon: Mic },
};

/**
 * "Saved Messages" — a private, per-device shelf backed by
 * hooks/useSavedMessages.ts (localStorage). Cross-group by design (each row
 * carries its own groupName/groupId), unlike MemberDrawer/MediaVaultPanel
 * which are scoped to the room currently open — bookmarking a high-yield
 * fact in one group and finding it again from any other group's chat is the
 * whole point.
 */
export function SavedMessagesPanel({ isOpen, onClose, saved, onRemove, currentGroupId }: SavedMessagesPanelProps) {
  const { sheetProps, startDrag } = useBottomSheetMotion(onClose);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            {...sheetProps}
            className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[80dvh] flex-col rounded-t-3xl border-t border-zinc-200 bg-white shadow-xl shadow-zinc-300/40 dark:border-white/5 dark:bg-zinc-950 dark:shadow-black/40 sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:bottom-auto sm:h-full sm:w-96 sm:max-h-none sm:rounded-l-2xl sm:rounded-t-none sm:border-l sm:border-t-0"
          >
            <BottomSheetHandle onPointerDown={startDrag} />
            <div className="flex shrink-0 items-center justify-between p-4 max-sm:pt-1">
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-zinc-900 dark:text-white">
                Messages enregistrés
                <span className="text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400">({saved.length})</span>
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="touch-target relative rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 active:scale-90 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="chat-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
              {saved.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  <Bookmark className="h-6 w-6 opacity-40" />
                  Enregistre un message d&apos;un tap sur son icône marque-page.
                </div>
              ) : (
                saved.map((item) => {
                  const media = item.type !== "text" ? MEDIA_LABEL[item.type] : null;
                  const MediaIcon = media?.icon;
                  return (
                    <div
                      key={item.id}
                      className="group rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 transition-colors hover:bg-zinc-100 dark:border-white/5 dark:bg-white/[0.02] dark:hover:bg-white/5"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <Link
                          href={`/dashboard/groups/${item.groupId}`}
                          className="min-w-0 truncate text-[11px] font-semibold text-cyan-700 hover:underline dark:text-cyan-300"
                        >
                          {item.groupName}
                        </Link>
                        <button
                          type="button"
                          onClick={() => onRemove(item.id)}
                          // Hover-reveal only where hover exists — on touch it was permanently invisible.
                          className="touch-target relative shrink-0 rounded-full p-1 text-zinc-400 transition-all hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-400 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
                          aria-label="Retirer"
                          title="Retirer des messages enregistrés"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>

                      {item.type === "text" ? (
                        <p className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">{item.contentText}</p>
                      ) : (
                        <p className="flex items-center gap-1.5 text-sm italic text-zinc-500 dark:text-zinc-400">
                          {MediaIcon && <MediaIcon className="h-3.5 w-3.5" />}
                          {media?.label}
                        </p>
                      )}

                      <p className="mt-1.5 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                        {item.senderName ?? "Étudiant(e)"} · {TIME_FORMAT.format(new Date(item.createdAt))}
                        {item.groupId === currentGroupId && " · cette discussion"}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
