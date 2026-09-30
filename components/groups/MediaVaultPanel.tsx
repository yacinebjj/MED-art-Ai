"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, FileAudio, ImageIcon, Loader2, Video, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AudioPlayer } from "./AudioPlayer";
import { ChatImage } from "./ChatImage";
import type { ChatMessage } from "@/types/group-chat";

interface MediaVaultPanelProps {
  groupId: string;
  isOpen: boolean;
  onClose: () => void;
}

const TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type VaultTab = "image" | "video" | "audio";

const TABS: { id: VaultTab; label: string; icon: typeof ImageIcon }[] = [
  { id: "image", label: "Images", icon: ImageIcon },
  { id: "video", label: "Vidéos", icon: Video },
  { id: "audio", label: "Vocaux", icon: FileAudio },
];

/**
 * The Media Vault — every image/video/voice note ever shared in the group,
 * fetched via its OWN endpoint (GET /api/groups/[id]/media, capped at 500,
 * newest first) rather than filtered from ChatRoom's own `messages` state,
 * which is capped at 200 by the general history fetch and would silently
 * miss older media in a heavily-used group. Same bespoke zinc/cyan
 * command-center palette as MemberDrawer — this drawer's only consumer is
 * ChatRoom too.
 */
export function MediaVaultPanel({ groupId, isOpen, onClose }: MediaVaultPanelProps) {
  const [media, setMedia] = useState<ChatMessage[] | null>(null);
  const [activeTab, setActiveTab] = useState<VaultTab>("image");

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setMedia(null);

    fetch(`/api/groups/${groupId}/media`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.success) return;
        setMedia(data.media as ChatMessage[]);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, groupId]);

  const items = (media ?? []).filter((m) => m.type === activeTab);
  const counts = {
    image: (media ?? []).filter((m) => m.type === "image").length,
    video: (media ?? []).filter((m) => m.type === "video").length,
    audio: (media ?? []).filter((m) => m.type === "audio").length,
  };

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
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[80vh] flex-col rounded-t-2xl border-t border-zinc-200 bg-white shadow-xl shadow-zinc-300/40 dark:border-white/5 dark:bg-zinc-950 dark:shadow-black/40 sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:bottom-auto sm:h-full sm:w-96 sm:max-h-none sm:rounded-l-2xl sm:rounded-t-none sm:border-l sm:border-t-0"
          >
            <div className="flex shrink-0 items-center justify-between p-4 pb-2">
              <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-white">Vault Médical</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 active:scale-90 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex shrink-0 gap-1 px-4 pb-3">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-all duration-150",
                      isActive
                        ? "bg-zinc-900 text-white dark:bg-white/10 dark:text-white"
                        : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                    <span className="tabular-nums opacity-70">({counts[tab.id]})</span>
                  </button>
                );
              })}
            </div>

            <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {!media ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500 dark:text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Chargement…
                </div>
              ) : items.length === 0 ? (
                <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Rien ici pour l&apos;instant.</p>
              ) : activeTab === "image" ? (
                <div className="grid grid-cols-2 gap-2">
                  {items.map((item) => (
                    <div key={item.id} className="group relative overflow-hidden rounded-xl border border-zinc-200 dark:border-white/5">
                      {item.mediaUrl && <ChatImage src={item.mediaUrl} />}
                      <VaultItemMeta item={item} />
                    </div>
                  ))}
                </div>
              ) : activeTab === "video" ? (
                <div className="space-y-3">
                  {items.map((item) => (
                    <div key={item.id} className="overflow-hidden rounded-xl border border-zinc-200 dark:border-white/5">
                      {item.mediaUrl && <video src={item.mediaUrl} controls className="max-h-48 w-full bg-black object-contain" />}
                      <VaultItemMeta item={item} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.id} className="rounded-xl border border-zinc-200 p-3 dark:border-white/5">
                      {item.mediaUrl && <AudioPlayer src={item.mediaUrl} onColoredBubble={false} />}
                      <VaultItemMeta item={item} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function VaultItemMeta({ item }: { item: ChatMessage }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
      <span className="min-w-0 truncate">
        {item.senderName ?? "Étudiant(e)"} · {TIME_FORMAT.format(new Date(item.createdAt))}
      </span>
      {item.mediaUrl && (
        <a
          href={item.mediaUrl}
          download
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-cyan-600 dark:text-zinc-500 dark:hover:bg-white/10 dark:hover:text-cyan-300"
          aria-label="Télécharger"
          title="Télécharger"
        >
          <Download className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
