"use client";

import { deleteSyncDoc, putSyncDoc, reconcileList } from "@/lib/user-sync";
import { isHighlightColorId, type HighlightColorId } from "@/lib/reading/highlight-paint";

/**
 * Where a student's highlights live: one server document per highlight in
 * their sync store (user_sync_documents through app/api/user-sync, namespace
 * "hl:<surface key>"), mirrored in this browser's localStorage (per account)
 * for an instant repaint and as an offline buffer — a highlight made offline
 * is uploaded on the next visit (lib/user-sync.ts reconcileList), and one
 * removed on another device is dropped here (tombstone).
 *
 * Everything is keyed by (account, surface): two accounts on one browser never
 * see each other's highlights.
 */

export interface ReadingHighlight {
  id: string;
  color: HighlightColorId;
  /** Exact highlighted text, and where it was — see lib/reading/anchor-match.ts. */
  text: string;
  start: number;
  end: number;
  prefix: string;
  suffix: string;
  createdAt: number;
}

/** A highlight longer than this is not saved (a whole chapter selected by accident). */
export const MAX_HIGHLIGHT_CHARS = 4000;
/** Highlights kept per surface (the oldest go first). */
const MAX_PER_SURFACE = 300;

export function highlightNamespace(surfaceKey: string): string {
  return `hl:${surfaceKey}`;
}

function storageKey(userId: string, surfaceKey: string): string {
  return `medart:hl:${userId}:${surfaceKey}`;
}

export function isReadingHighlight(value: unknown): value is ReadingHighlight {
  if (!value || typeof value !== "object") return false;
  const h = value as Record<string, unknown>;
  return (
    typeof h.id === "string" &&
    h.id.length > 0 &&
    h.id.length <= 64 &&
    isHighlightColorId(h.color) &&
    typeof h.text === "string" &&
    h.text.length > 0 &&
    h.text.length <= MAX_HIGHLIGHT_CHARS &&
    typeof h.start === "number" &&
    Number.isInteger(h.start) &&
    h.start >= 0 &&
    typeof h.end === "number" &&
    Number.isInteger(h.end) &&
    h.end > h.start &&
    typeof h.prefix === "string" &&
    h.prefix.length <= 64 &&
    typeof h.suffix === "string" &&
    h.suffix.length <= 64 &&
    typeof h.createdAt === "number" &&
    Number.isFinite(h.createdAt)
  );
}

interface Entry {
  items: ReadingHighlight[];
  /** Ids added / removed on this page since the server copy was last read — re-applied over it. */
  addedSinceLoad: Map<string, ReadingHighlight>;
  removedSinceLoad: Set<string>;
  loading: boolean;
  loaded: boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function entryId(userId: string, surfaceKey: string): string {
  return `${userId}|${surfaceKey}`;
}

function readLocal(userId: string, surfaceKey: string): ReadingHighlight[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId, surfaceKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isReadingHighlight) : [];
  } catch {
    return [];
  }
}

function writeLocal(userId: string, surfaceKey: string, items: ReadingHighlight[]): void {
  try {
    if (items.length === 0) window.localStorage.removeItem(storageKey(userId, surfaceKey));
    else window.localStorage.setItem(storageKey(userId, surfaceKey), JSON.stringify(items));
  } catch {
    // Storage full or blocked: the server copy still has them.
  }
}

function sorted(items: ReadingHighlight[]): ReadingHighlight[] {
  return items.slice().sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_PER_SURFACE);
}

function notify(id: string): void {
  listeners.get(id)?.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error("[reading] Rafraîchissement des surlignages impossible:", error);
    }
  });
}

function entryFor(userId: string, surfaceKey: string): Entry {
  const id = entryId(userId, surfaceKey);
  let entry = entries.get(id);
  if (!entry) {
    entry = { items: sorted(readLocal(userId, surfaceKey)), addedSinceLoad: new Map(), removedSinceLoad: new Set(), loading: false, loaded: false };
    entries.set(id, entry);
  }
  return entry;
}

/** The highlights known right now (this browser's copy until the server answers). */
export function getHighlights(userId: string, surfaceKey: string): ReadingHighlight[] {
  return entryFor(userId, surfaceKey).items;
}

export function subscribeHighlights(userId: string, surfaceKey: string, listener: () => void): () => void {
  const id = entryId(userId, surfaceKey);
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listeners.delete(id);
  };
}

/** Reads the account-wide copy once per page visit (merged with this browser's), then notifies subscribers. */
export function ensureHighlightsLoaded(userId: string, surfaceKey: string): void {
  const id = entryId(userId, surfaceKey);
  const entry = entryFor(userId, surfaceKey);
  if (entry.loaded || entry.loading) return;
  entry.loading = true;
  entry.addedSinceLoad.clear();
  entry.removedSinceLoad.clear();
  const snapshot = entry.items.slice();
  void reconcileList<ReadingHighlight>(highlightNamespace(surfaceKey), snapshot, { sortKey: (h) => h.createdAt, isValid: isReadingHighlight })
    .then((merged) => {
      entry.loading = false;
      // Offline / unavailable: keep this browser's copy, try again on the next visit.
      if (!merged) return;
      entry.loaded = true;
      const byId = new Map(merged.map((h) => [h.id, h]));
      entry.addedSinceLoad.forEach((h, hid) => byId.set(hid, h));
      entry.removedSinceLoad.forEach((hid) => byId.delete(hid));
      entry.items = sorted(Array.from(byId.values()));
      writeLocal(userId, surfaceKey, entry.items);
      notify(id);
    })
    .catch(() => {
      entry.loading = false;
    });
}

/** Saves a new highlight; `replaces` are the ids it covers (re-coloured or merged), removed in the same step. */
export function addHighlight(userId: string, surfaceKey: string, highlight: ReadingHighlight, replaces: string[] = []): void {
  if (!isReadingHighlight(highlight)) return;
  const id = entryId(userId, surfaceKey);
  const entry = entryFor(userId, surfaceKey);
  const drop = new Set(replaces);
  entry.items = sorted([...entry.items.filter((h) => !drop.has(h.id)), highlight]);
  if (entry.loading) {
    entry.addedSinceLoad.set(highlight.id, highlight);
    drop.forEach((hid) => entry.removedSinceLoad.add(hid));
  }
  writeLocal(userId, surfaceKey, entry.items);
  const ns = highlightNamespace(surfaceKey);
  drop.forEach((hid) => deleteSyncDoc(ns, hid));
  putSyncDoc(ns, highlight.id, highlight, true);
  notify(id);
}

export function removeHighlights(userId: string, surfaceKey: string, ids: string[]): void {
  if (ids.length === 0) return;
  const id = entryId(userId, surfaceKey);
  const entry = entryFor(userId, surfaceKey);
  const drop = new Set(ids);
  entry.items = entry.items.filter((h) => !drop.has(h.id));
  if (entry.loading) drop.forEach((hid) => entry.removedSinceLoad.add(hid));
  writeLocal(userId, surfaceKey, entry.items);
  const ns = highlightNamespace(surfaceKey);
  drop.forEach((hid) => deleteSyncDoc(ns, hid));
  notify(id);
}

/** A fresh id (uuid when the browser has one). */
export function newHighlightId(): string {
  const cryptoApi = typeof crypto !== "undefined" ? (crypto as Crypto & { randomUUID?: () => string }) : null;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
