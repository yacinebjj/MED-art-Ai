/**
 * BROWSER-ONLY cross-device sync (server: app/api/user-sync, table
 * user_sync_documents). Everything a student generates or saves is written
 * to the server; localStorage stays as an instant first paint and an offline
 * buffer, never the only copy.
 *
 * Two shapes:
 *  - LISTS (history entries, conversations, saved messages, bookmarks): one
 *    server document per item, keyed by the item's id. `reconcileList` merges
 *    server + local on load: server items win, local-only items are uploaded
 *    (this is also how data created before sync existed reaches the server),
 *    items deleted on another device (tombstones) are dropped locally.
 *  - VALUES (progress, settings-like data): one document holding
 *    `{ value, savedAt }`; the most recent `savedAt` wins on either side.
 *
 * Network failures never break the page: every helper degrades to "local
 * only" and retries on the next write.
 */

export interface SyncDoc {
  key: string;
  data: unknown;
  deleted: boolean;
  updatedAt: string;
}

export interface SyncedValue<T> {
  value: T;
  savedAt: number;
}

const PUT_DEBOUNCE_MS = 700;
const MAX_UPLOAD_PER_REQUEST = 100;

const pending = new Map<string, { ns: string; key: string; data: unknown; timer: ReturnType<typeof setTimeout> }>();

async function send(method: "PUT" | "DELETE", body: unknown, keepalive = false): Promise<boolean> {
  try {
    const res = await fetch("/api/user-sync", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive });
    return res.ok;
  } catch {
    return false;
  }
}

function flushOne(id: string, keepalive = false): void {
  const entry = pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(id);
  // keepalive bodies are capped (~64 KB) by browsers: large documents go as a normal request.
  const small = keepalive && JSON.stringify(entry.data).length < 60_000;
  void send("PUT", { ns: entry.ns, key: entry.key, data: entry.data }, small);
}

if (typeof window !== "undefined") {
  // Leaving the page (tab closed, app backgrounded on a phone): send what is queued.
  const flushAll = () => {
    for (const id of Array.from(pending.keys())) flushOne(id, true);
  };
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });
}

/** Lists a namespace from the server; null when offline / unavailable (caller keeps its local copy). */
export async function fetchSyncNamespace(ns: string, key?: string): Promise<SyncDoc[] | null> {
  try {
    const url = `/api/user-sync?ns=${encodeURIComponent(ns)}${key ? `&key=${encodeURIComponent(key)}` : ""}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { success?: boolean; available?: boolean; docs?: SyncDoc[] };
    if (!body.success || body.available === false || !Array.isArray(body.docs)) return null;
    return body.docs;
  } catch {
    return null;
  }
}

/** Queues an upsert (debounced per document, so rapid edits send once). */
export function putSyncDoc(ns: string, key: string, data: unknown, immediate = false): void {
  const id = `${ns}|${key}`;
  const existing = pending.get(id);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => flushOne(id), immediate ? 0 : PUT_DEBOUNCE_MS);
  pending.set(id, { ns, key, data, timer });
}

/** Deletes on every device (tombstone). */
export function deleteSyncDoc(ns: string, key: string): void {
  const id = `${ns}|${key}`;
  const existing = pending.get(id);
  if (existing) {
    clearTimeout(existing.timer);
    pending.delete(id);
  }
  void send("DELETE", { ns, key });
}

async function uploadMany(ns: string, docs: { key: string; data: unknown }[]): Promise<void> {
  for (let i = 0; i < docs.length; i += MAX_UPLOAD_PER_REQUEST) {
    await send("PUT", { ns, docs: docs.slice(i, i + MAX_UPLOAD_PER_REQUEST) });
  }
}

/**
 * Merges a local list with the server copy. Returns the merged list (sorted
 * by `sortKey`, newest first, capped at `max`), or null when the server is
 * unreachable — the caller then simply keeps showing its local list.
 */
export async function reconcileList<T extends { id: string }>(
  ns: string,
  local: T[],
  options: { sortKey: (item: T) => number; max?: number; isValid?: (value: unknown) => value is T }
): Promise<T[] | null> {
  const docs = await fetchSyncNamespace(ns);
  if (!docs) return null;
  const tombstones = new Set(docs.filter((d) => d.deleted).map((d) => d.key));
  const merged = new Map<string, T>();
  for (const doc of docs) {
    if (doc.deleted || !doc.data || typeof doc.data !== "object") continue;
    if (options.isValid && !options.isValid(doc.data)) continue;
    merged.set(doc.key, doc.data as T);
  }
  const toUpload: { key: string; data: unknown }[] = [];
  for (const item of local) {
    if (!item || typeof item.id !== "string" || tombstones.has(item.id) || merged.has(item.id)) continue;
    merged.set(item.id, item);
    toUpload.push({ key: item.id, data: item });
  }
  if (toUpload.length > 0) void uploadMany(ns, toUpload);
  const list = Array.from(merged.values()).sort((a, b) => options.sortKey(b) - options.sortKey(a));
  return options.max ? list.slice(0, options.max) : list;
}

/**
 * Reconciles one value: the newest `savedAt` wins. Returns the winner (and
 * uploads the local one when it is newer), or null when the server is
 * unreachable or neither side has a value.
 */
export async function reconcileValue<T>(ns: string, key: string, local: SyncedValue<T> | null): Promise<SyncedValue<T> | null> {
  const docs = await fetchSyncNamespace(ns, key);
  if (!docs) return null;
  const doc = docs.find((d) => d.key === key);
  const remote = doc && !doc.deleted && doc.data && typeof doc.data === "object" && "savedAt" in doc.data ? (doc.data as SyncedValue<T>) : null;
  if (local && (!remote || local.savedAt > remote.savedAt)) {
    putSyncDoc(ns, key, local, true);
    return local;
  }
  return remote;
}
