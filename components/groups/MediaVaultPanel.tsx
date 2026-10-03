"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, ExternalLink, FileAudio, FileText, ImageIcon, Link2, Loader2, Video, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BottomSheetHandle, useBottomSheetMotion } from "@/components/ui/BottomSheet";
import { AudioPlayer } from "./AudioPlayer";
import { ChatImage } from "./ChatImage";
import { AttachmentCard } from "./AttachmentCard";
import type { ChatMessage } from "@/types/group-chat";

interface MediaVaultPanelProps {
  groupId: string;
  isOpen: boolean;
  onClose: () => void;
}

const TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type VaultTab = "image" | "video" | "audio" | "documents" | "links";

const TABS: { id: VaultTab; label: string; icon: typeof ImageIcon }[] = [
  { id: "documents", label: "Docs", icon: FileText },
  { id: "image", label: "Images", icon: ImageIcon },
  { id: "video", label: "Vidéos", icon: Video },
  { id: "audio", label: "Vocaux", icon: FileAudio },
  { id: "links", label: "Liens", icon: Link2 },
];

interface VaultDocument {
  messageId: string;
  senderName: string | null;
  createdAt: string;
  name: string;
  url: string;
  mime: string;
  size: number;
}

interface VaultLink {
  messageId: string;
  senderName: string | null;
  createdAt: string;
  url: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

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
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [links, setLinks] = useState<VaultLink[]>([]);
  const [activeTab, setActiveTab] = useState<VaultTab>("documents");
  const { sheetProps, startDrag } = useBottomSheetMotion(onClose);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setMedia(null);

    fetch(`/api/groups/${groupId}/media`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.success) return;
        setMedia(data.media as ChatMessage[]);
        setDocuments(Array.isArray(data.documents) ? (data.documents as VaultDocument[]) : []);
        setLinks(Array.isArray(data.links) ? (data.links as VaultLink[]) : []);
      })
      .catch(() => {
        if (!cancelled) setMedia([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, groupId]);

  const items = (media ?? []).filter((m) => m.type === activeTab);
  const counts: Record<VaultTab, number> = {
    documents: documents.length,
    image: (media ?? []).filter((m) => m.type === "image").length,
    video: (media ?? []).filter((m) => m.type === "video").length,
    audio: (media ?? []).filter((m) => m.type === "audio").length,
    links: links.length,
  };
  const activeCount = counts[activeTab];

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
            <div className="flex shrink-0 items-center justify-between p-4 pb-2 max-sm:pt-1">
              <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-white">Bibliothèque du groupe</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="touch-target relative rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 active:scale-90 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="chat-scrollbar flex shrink-0 gap-1 overflow-x-auto px-4 pb-3">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-all duration-150",
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

            <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
              {!media ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500 dark:text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Chargement…
                </div>
              ) : activeCount === 0 ? (
                <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  {activeTab === "documents"
                    ? "Aucun document partagé — envoie un PDF ou un cours avec le bouton +."
                    : activeTab === "links"
                      ? "Aucun lien partagé pour l'instant."
                      : "Rien ici pour l'instant."}
                </p>
              ) : activeTab === "documents" ? (
                <div className="space-y-2">
                  {documents.map((doc) => (
                    <div key={doc.messageId}>
                      <AttachmentCard attachment={doc} compact />
                      <p className="px-1 pt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                        {doc.senderName ?? "Étudiant(e)"} · {TIME_FORMAT.format(new Date(doc.createdAt))}
                      </p>
                    </div>
                  ))}
                </div>
              ) : activeTab === "links" ? (
                <div className="space-y-2">
                  {links.map((link) => (
                    <a
                      key={`${link.messageId}-${link.url}`}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 transition-colors hover:border-cyan-300 hover:bg-cyan-50/50 dark:border-white/5 dark:hover:border-cyan-800 dark:hover:bg-cyan-500/5"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
                        <Link2 className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-white">{hostOf(link.url)}</span>
                        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                          {link.senderName ?? "Étudiant(e)"} · {TIME_FORMAT.format(new Date(link.createdAt))}
                        </span>
                      </span>
                      <ExternalLink className="h-4 w-4 shrink-0 text-zinc-400" />
                    </a>
                  ))}
                </div>
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
          className="touch-target relative shrink-0 rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-cyan-600 dark:text-zinc-500 dark:hover:bg-white/10 dark:hover:text-cyan-300"
          aria-label="Télécharger"
          title="Télécharger"
        >
          <Download className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
