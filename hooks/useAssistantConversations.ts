"use client";

/**
 * MedArt Assistant conversation persistence — localStorage, not Supabase,
 * a deliberate scope choice: this app already has a proven server-side
 * history pattern (course_chat_history), but that needs a new table, a new
 * GET/POST pair, and auth-scoped queries — real work, not a "tonight" fix.
 * localStorage is genuinely robust for what's actually being asked (survive
 * a refresh/navigation on the SAME device) and ships immediately.
 *
 * Disclosed limitation, not hidden: this is per-browser, per-device only.
 * No cross-device sync, and clearing browser data/history wipes it. If
 * conversations need to survive that, this hook is the wrong layer — that
 * needs the Supabase path instead, as a separate, real feature.
 */

import { useCallback, useEffect, useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface StoredConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const STORAGE_KEY = "medart-assistant-conversations";
const ACTIVE_ID_KEY = "medart-assistant-active-id";
const MAX_STORED_CONVERSATIONS = 100; // bounds localStorage growth — oldest conversations past this are dropped, not silently kept forever
const TITLE_MAX_CHARS = 60;

function readConversationsFromStorage(): StoredConversation[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredConversation =>
        item && typeof item.id === "string" && typeof item.title === "string" && Array.isArray(item.messages) && typeof item.updatedAt === "number"
    );
  } catch (error) {
    console.warn("[assistant] Historique local illisible (corrompu ou format inattendu) — repart de zéro:", error);
    return [];
  }
}

function writeConversationsToStorage(conversations: StoredConversation[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
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

export function useAssistantConversations() {
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // False until the initial localStorage read completes — localStorage
  // doesn't exist during server rendering, so this MUST happen in an
  // effect, never during the first render, or React flags a hydration
  // mismatch between server and client markup.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readConversationsFromStorage();
    setConversations(stored);
    const savedActiveId = window.localStorage.getItem(ACTIVE_ID_KEY);
    if (savedActiveId && stored.some((c) => c.id === savedActiveId)) {
      setActiveId(savedActiveId);
    }
    setHydrated(true);
  }, []);

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
      if (messages.length === 0) return;
      const title = deriveTitle(messages);
      const now = Date.now();

      setConversations((prev) => {
        const existingIndex = activeId ? prev.findIndex((c) => c.id === activeId) : -1;
        let next: StoredConversation[];

        if (existingIndex >= 0) {
          next = prev.map((c, i) => (i === existingIndex ? { ...c, messages, title, updatedAt: now } : c));
        } else {
          const newId = crypto.randomUUID();
          next = [{ id: newId, title, messages, updatedAt: now }, ...prev];
          setActiveId(newId);
          try {
            window.localStorage.setItem(ACTIVE_ID_KEY, newId);
          } catch {
            // Same fail-open as writeConversationsToStorage below — the
            // active id just won't survive a refresh this time.
          }
        }

        next.sort((a, b) => b.updatedAt - a.updatedAt);
        const bounded = next.slice(0, MAX_STORED_CONVERSATIONS);
        writeConversationsToStorage(bounded);
        return bounded;
      });
    },
    [activeId]
  );

  /** "+ Nouvelle conversation" — clears which conversation is active so the NEXT saveMessages call creates a fresh entry instead of overwriting the one that was just open. Does not touch the page's own `messages` state; the page clears that itself. */
  const startNewConversation = useCallback(() => {
    setActiveId(null);
    try {
      window.localStorage.removeItem(ACTIVE_ID_KEY);
    } catch {
      // Non-fatal — worst case, the next reload re-opens the previously active conversation instead of a blank one.
    }
  }, []);

  /** Returns the stored record so the page can load its messages into its own live state — this hook only owns the persisted list + which id is active, not the page's render state. */
  const selectConversation = useCallback(
    (id: string): StoredConversation | null => {
      const found = conversations.find((c) => c.id === id) ?? null;
      if (found) {
        setActiveId(id);
        try {
          window.localStorage.setItem(ACTIVE_ID_KEY, id);
        } catch {
          // Non-fatal, same reasoning as above.
        }
      }
      return found;
    },
    [conversations]
  );

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        writeConversationsToStorage(next);
        return next;
      });
      if (activeId === id) {
        setActiveId(null);
        try {
          window.localStorage.removeItem(ACTIVE_ID_KEY);
        } catch {
          // Non-fatal.
        }
      }
    },
    [activeId]
  );

  return { conversations, activeId, hydrated, saveMessages, startNewConversation, selectConversation, deleteConversation };
}
