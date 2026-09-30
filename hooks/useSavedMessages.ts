"use client";

import { useEffect, useState } from "react";
import type { ChatMessageType } from "@/types/group-chat";

const STORAGE_KEY = "medart_saved_messages";
/** A saved list this large already means something is wrong with the UX, not the storage — a simple cap keeps localStorage (a few MB budget, shared with every other medart_* key) from ever being the failure mode. */
const MAX_SAVED = 300;

/**
 * A private, per-device "Saved Messages" shelf — deliberately localStorage
 * only, same convention as useChatTheme.ts's own STORAGE_KEY (a plain string
 * constant, read once on mount, written synchronously alongside state). This
 * is NOT synced across devices/members: it stores a full snapshot of the
 * message's content at save-time (not just an id) because
 * GET /api/groups/[id]/messages caps history at 200 rows — a message a
 * student saved today could scroll out of that server-side window by next
 * week, and a reference-only bookmark would then silently render as nothing.
 * Global (not per-group) so one panel can show saves from every group.
 */
export interface SavedMessage {
  id: string;
  groupId: string;
  groupName: string;
  senderName: string | null;
  type: ChatMessageType;
  contentText: string | null;
  mediaUrl: string | null;
  createdAt: string;
  savedAt: string;
}

function readStorage(): SavedMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useSavedMessages() {
  const [saved, setSaved] = useState<SavedMessage[]>([]);

  useEffect(() => {
    setSaved(readStorage());
  }, []);

  function isSaved(messageId: string): boolean {
    return saved.some((m) => m.id === messageId);
  }

  function toggle(entry: Omit<SavedMessage, "savedAt">) {
    setSaved((prev) => {
      const already = prev.some((m) => m.id === entry.id);
      const next = already
        ? prev.filter((m) => m.id !== entry.id)
        : [{ ...entry, savedAt: new Date().toISOString() }, ...prev].slice(0, MAX_SAVED);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function remove(messageId: string) {
    setSaved((prev) => {
      const next = prev.filter((m) => m.id !== messageId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return { saved, isSaved, toggle, remove };
}
