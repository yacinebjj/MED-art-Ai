"use client";

import { useEffect, useState } from "react";
import type { ChatMessageType } from "@/types/group-chat";
import { useAuth } from "@/providers/AuthProvider";
import { deleteSyncDoc, putSyncDoc, reconcileList } from "@/lib/user-sync";

const STORAGE_KEY = "medart_saved_messages";
/** Which account the local shelf was last reconciled with — the shelf key itself is not user-scoped, so a different account on the same browser must not upload it. */
const OWNER_KEY = "medart_saved_messages_owner";
const SYNC_NS = "saved-messages";
/** A saved list this large already means something is wrong with the UX, not the storage — a simple cap keeps localStorage (a few MB budget, shared with every other medart_* key) from ever being the failure mode. */
const MAX_SAVED = 300;

/**
 * A private "Saved Messages" shelf — localStorage first (same convention as
 * useChatTheme.ts's own STORAGE_KEY: read once on mount, written
 * synchronously alongside state), mirrored to the signed-in student's
 * cross-device sync store (lib/user-sync.ts, one document per message id) so
 * a message saved on the PC shows up on the phone. Without sync (offline,
 * store unavailable) it is exactly the per-device shelf it always was.
 * Never shared between group members. It stores a full snapshot of the
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

function isSavedMessage(value: unknown): value is SavedMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<SavedMessage>;
  return typeof m.id === "string" && typeof m.groupId === "string" && typeof m.savedAt === "string";
}

function savedAtMs(message: SavedMessage): number {
  const ms = Date.parse(message.savedAt);
  return Number.isFinite(ms) ? ms : 0;
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

function writeStorage(list: SavedMessage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Quota / privacy mode — the shelf still works for this visit.
  }
}

export function useSavedMessages() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [saved, setSaved] = useState<SavedMessage[]>([]);

  useEffect(() => {
    setSaved(readStorage());
  }, []);

  // Once the account is known: merge with its server copy. null = sync
  // unavailable → the local shelf above stays as it is.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let owner: string | null = null;
    try {
      owner = localStorage.getItem(OWNER_KEY);
    } catch {
      owner = null;
    }
    const local = readStorage();
    // Shelf last reconciled with ANOTHER account: show this account's server
    // copy instead of uploading someone else's saves into it.
    const toMerge = owner && owner !== userId ? [] : local.filter(isSavedMessage);
    const localIds = new Set(toMerge.map((m) => m.id));
    const initialIds = new Set(local.map((m) => m.id));
    void reconcileList(SYNC_NS, toMerge, { sortKey: savedAtMs, max: MAX_SAVED, isValid: isSavedMessage }).then((merged) => {
      if (cancelled || !merged) return;
      try {
        localStorage.setItem(OWNER_KEY, userId);
      } catch {
        // Non-fatal — the next load reconciles again.
      }
      setSaved((prev) => {
        // Keep saves/unsaves made while the request was in flight.
        const prevIds = new Set(prev.map((m) => m.id));
        const byId = new Map(merged.filter((m) => !localIds.has(m.id) || prevIds.has(m.id)).map((m) => [m.id, m]));
        for (const m of prev) {
          if (!byId.has(m.id) && !initialIds.has(m.id)) byId.set(m.id, m);
        }
        const next = Array.from(byId.values())
          .sort((a, b) => savedAtMs(b) - savedAtMs(a))
          .slice(0, MAX_SAVED);
        writeStorage(next);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  function isSaved(messageId: string): boolean {
    return saved.some((m) => m.id === messageId);
  }

  function toggle(entry: Omit<SavedMessage, "savedAt">) {
    const already = saved.some((m) => m.id === entry.id);
    if (already) {
      if (userId) deleteSyncDoc(SYNC_NS, entry.id);
      setSaved((prev) => {
        const next = prev.filter((m) => m.id !== entry.id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      return;
    }
    const added: SavedMessage = { ...entry, savedAt: new Date().toISOString() };
    if (userId) putSyncDoc(SYNC_NS, added.id, added);
    setSaved((prev) => {
      const next = [added, ...prev.filter((m) => m.id !== entry.id)].slice(0, MAX_SAVED);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function remove(messageId: string) {
    if (userId) deleteSyncDoc(SYNC_NS, messageId);
    setSaved((prev) => {
      const next = prev.filter((m) => m.id !== messageId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return { saved, isSaved, toggle, remove };
}
