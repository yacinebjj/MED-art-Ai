"use client";

/**
 * MedArt Assistant conversation persistence — localStorage for the instant
 * first paint (and offline), mirrored to the cross-device sync store
 * (lib/user-sync.ts, namespace SYNC_NS, one document per conversation id) so
 * a conversation started on the PC is there on the phone. When the sync
 * store is unavailable (offline, migration not run) every helper degrades to
 * a no-op and this hook behaves exactly as the local-only version did.
 * The active conversation id stays per-device on purpose.
 */

import { useCallback, useEffect, useState } from "react";
import type { AssistantMode } from "@/lib/assistant-modes";
import { deleteSyncDoc, putSyncDoc, reconcileList } from "@/lib/user-sync";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** User messages only — the quick action (QCM, flashcards…) this message was sent with, kept so "Régénérer" re-runs it the same way. Absent on every message sent before quick actions existed. */
  mode?: AssistantMode;
}

export interface StoredConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const MAX_STORED_CONVERSATIONS = 100; // bounds localStorage growth — oldest conversations past this are dropped, not silently kept forever
const TITLE_MAX_CHARS = 60;
const SYNC_NS = "assistant-conversations";

/**
 * Storage keys are namespaced by userId — WAS a fixed global string before
 * this fix ("medart-assistant-conversations", no user id anywhere in it),
 * meaning any second account logging in on the SAME browser/machine saw the
 * first account's ENTIRE conversation history and could open/continue those
 * threads. Found while preparing a clean-state demo recording. `userId:
 * null` (auth not resolved yet, or genuinely signed out) deliberately maps
 * to keys no real conversation is ever stored under — this hook simply
 * behaves as empty/no-op until a real user id is known, rather than falling
 * back to the old shared key.
 */
function storageKeyFor(userId: string | null): string | null {
  return userId ? `medart-assistant-conversations:${userId}` : null;
}
function activeIdKeyFor(userId: string | null): string | null {
  return userId ? `medart-assistant-active-id:${userId}` : null;
}

function isStoredConversation(item: unknown): item is StoredConversation {
  if (!item || typeof item !== "object") return false;
  const c = item as Partial<StoredConversation>;
  return typeof c.id === "string" && typeof c.title === "string" && Array.isArray(c.messages) && typeof c.updatedAt === "number";
}

function readConversationsFromStorage(storageKey: string): StoredConversation[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredConversation);
  } catch (error) {
    console.warn("[assistant] Historique local illisible (corrompu ou format inattendu) — repart de zéro:", error);
    return [];
  }
}

function writeConversationsToStorage(storageKey: string, conversations: StoredConversation[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(conversations));
  } catch (error) {
    // Quota exceeded, private-browsing restrictions, or storage disabled —
    // the current session keeps working entirely in memory either way,
    // this just means it won't survive a refresh this time.
    console.warn("[assistant] Échec sauvegarde de l'historique (quota localStorage ?):", error);
  }
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((m) => m.role === "user");
  if (!firstUserMessage) return "Nouvelle conversation";
  const trimmed = firstUserMessage.content.trim();
  return trimmed.length > TITLE_MAX_CHARS ? `${trimmed.slice(0, TITLE_MAX_CHARS).trimEnd()}…` : trimmed;
}

/** `userId`: the signed-in student's id (or `null` while auth hasn't resolved yet / genuinely signed out) — see storageKeyFor's own comment for why this parameter exists at all. */
export function useAssistantConversations(userId: string | null) {
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // False until the initial localStorage read completes — localStorage
  // doesn't exist during server rendering, so this MUST happen in an
  // effect, never during the first render, or React flags a hydration
  // mismatch between server and client markup.
  const [hydrated, setHydrated] = useState(false);

  // Re-hydrates whenever the user id changes — covers auth resolving
  // asynchronously after mount, AND a genuine account switch on the same
  // browser tab without a full reload: this student's own state (or none,
  // while userId is still null) always replaces whatever the PREVIOUS
  // userId's effect run had loaded, rather than leaving stale data.
  useEffect(() => {
    const storageKey = storageKeyFor(userId);
    const activeIdKey = activeIdKeyFor(userId);
    if (!storageKey || !activeIdKey) {
      setConversations([]);
      setActiveId(null);
      setHydrated(false);
      return;
    }

    const stored = readConversationsFromStorage(storageKey);
    setConversations(stored);
    const savedActiveId = window.localStorage.getItem(activeIdKey);
    setActiveId(savedActiveId && stored.some((c) => c.id === savedActiveId) ? savedActiveId : null);
    setHydrated(true);

    // Then merge with the server copy (other devices' conversations come in,
    // local-only ones are uploaded, ones deleted elsewhere drop out). null =
    // sync unavailable → the local list above simply stays.
    let cancelled = false;
    const storedIds = new Set(stored.map((c) => c.id));
    void reconcileList(SYNC_NS, stored, { sortKey: (c) => c.updatedAt, max: MAX_STORED_CONVERSATIONS, isValid: isStoredConversation }).then((merged) => {
      if (cancelled || !merged) return;
      setConversations((prev) => {
        // Keep what changed locally while the request was in flight: new
        // conversations (not in the initial read), newer local edits, and
        // deletions (in the initial read, gone from the live list).
        const prevIds = new Set(prev.map((c) => c.id));
        const byId = new Map(merged.filter((c) => !storedIds.has(c.id) || prevIds.has(c.id)).map((c) => [c.id, c]));
        for (const c of prev) {
          const remote = byId.get(c.id);
          if (remote ? c.updatedAt > remote.updatedAt : !storedIds.has(c.id)) byId.set(c.id, c);
        }
        const next = Array.from(byId.values())
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_STORED_CONVERSATIONS);
        writeConversationsToStorage(storageKey, next);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /**
   * Upserts the given messages under the active conversation, creating and
   * activating a brand-new one on the very first call of a fresh session
   * (activeId is still null then). Called by the page after the user sends
   * a message AND after the AI's reply completes — not on every streamed
   * chunk, which would mean writing to localStorage up to 60 times/second
   * during a response for no benefit (a mid-stream refresh loses that
   * in-flight reply regardless of how often it was persisted, since the
   * fetch itself can't survive a reload either).
   */
  const saveMessages = useCallback(
    (messages: ChatMessage[]) => {
      const activeIdKey = activeIdKeyFor(userId);
      const storageKey = storageKeyFor(userId);
      if (messages.length === 0 || !storageKey || !activeIdKey) return;
      const title = deriveTitle(messages);
      const now = Date.now();

      setConversations((prev) => {
        const existingIndex = activeId ? prev.findIndex((c) => c.id === activeId) : -1;
        let next: StoredConversation[];
        let changed: StoredConversation;

        if (existingIndex >= 0) {
          changed = { ...prev[existingIndex], messages, title, updatedAt: now };
          next = prev.map((c, i) => (i === existingIndex ? changed : c));
        } else {
          const newId = crypto.randomUUID();
          changed = { id: newId, title, messages, updatedAt: now };
          next = [changed, ...prev];
          setActiveId(newId);
          try {
            window.localStorage.setItem(activeIdKey, newId);
          } catch {
            // Same fail-open as writeConversationsToStorage below — the
            // active id just won't survive a refresh this time.
          }
        }

        next.sort((a, b) => b.updatedAt - a.updatedAt);
        const bounded = next.slice(0, MAX_STORED_CONVERSATIONS);
        writeConversationsToStorage(storageKey, bounded);
        // Debounced per conversation id — the user-message save and the
        // reply save that follows it collapse into one request.
        putSyncDoc(SYNC_NS, changed.id, changed);
        return bounded;
      });
    },
    [activeId, userId]
  );

  /** "+ Nouvelle conversation" — clears which conversation is active so the NEXT saveMessages call creates a fresh entry instead of overwriting the one that was just open. Does not touch the page's own `messages` state; the page clears that itself. */
  const startNewConversation = useCallback(() => {
    setActiveId(null);
    const activeIdKey = activeIdKeyFor(userId);
    if (!activeIdKey) return;
    try {
      window.localStorage.removeItem(activeIdKey);
    } catch {
      // Non-fatal — worst case, the next reload re-opens the previously active conversation instead of a blank one.
    }
  }, [userId]);

  /** Returns the stored record so the page can load its messages into its own live state — this hook only owns the persisted list + which id is active, not the page's render state. */
  const selectConversation = useCallback(
    (id: string): StoredConversation | null => {
      const found = conversations.find((c) => c.id === id) ?? null;
      const activeIdKey = activeIdKeyFor(userId);
      if (found && activeIdKey) {
        setActiveId(id);
        try {
          window.localStorage.setItem(activeIdKey, id);
        } catch {
          // Non-fatal, same reasoning as above.
        }
      }
      return found;
    },
    [conversations, userId]
  );

  const deleteConversation = useCallback(
    (id: string) => {
      const storageKey = storageKeyFor(userId);
      const activeIdKey = activeIdKeyFor(userId);
      if (!storageKey || !activeIdKey) return;

      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        writeConversationsToStorage(storageKey, next);
        return next;
      });
      deleteSyncDoc(SYNC_NS, id);
      if (activeId === id) {
        setActiveId(null);
        try {
          window.localStorage.removeItem(activeIdKey);
        } catch {
          // Non-fatal.
        }
      }
    },
    [activeId, userId]
  );

  return { conversations, activeId, hydrated, saveMessages, startNewConversation, selectConversation, deleteConversation };
}
