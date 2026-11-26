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
/** The server refuses a document whose JSON is longer than this (app/api/user-sync, MAX_DOC_BYTES). */
const MAX_DOC_CHARS = 2_000_000;
/**
 * Request body ceiling, in UTF-8 bytes. Vercel refuses any function request
 * body above 4.5 MB before the route runs: a bulk upload past it failed
 * whole — and silently, again on every load — so batches are cut below it.
 */
const MAX_BODY_BYTES = 4_400_000;
/** Target size of one bulk upload, leaving room under MAX_BODY_BYTES. */
const UPLOAD_BATCH_BYTES = 3_500_000;
/** Browsers cap keepalive bodies (64 KB, shared by every keepalive request in flight). */
const MAX_KEEPALIVE_BYTES = 60_000;

const pending = new Map<string, { ns: string; key: string; data: unknown; timer: ReturnType<typeof setTimeout> }>();

/**
 * The UTF-8 size of a string, without encoding it: what it weighs as a
 * request body (accents count 2 bytes, Arabic 2, most other scripts 3,
 * emoji 4).
 */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4; // a surrogate pair: one 4-byte character
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * How long a document's own JSON is inside a serialized `{ ..., data }`
 * object: the object's length minus that of the same object with `data: null`.
 *
 * @param json - JSON.stringify of the object holding `data`.
 * @param withNullData - The same object with `data: null`.
 */
function dataChars(json: string, withNullData: Record<string, unknown>): number {
  return json.length - (JSON.stringify(withNullData).length - "null".length);
}

/** A document the server or Vercel would refuse anyway: never sent, so it cannot sink the others of its batch. */
function tooLargeToSync(docChars: number, bodyBytes: number): boolean {
  return docChars > MAX_DOC_CHARS || bodyBytes > MAX_BODY_BYTES;
}

/** Sends a serialized body; false when the request failed or was refused. */
async function send(method: "PUT" | "DELETE", json: string, keepalive = false): Promise<boolean> {
  try {
    const res = await fetch("/api/user-sync", { method, headers: { "Content-Type": "application/json" }, body: json, keepalive });
    return res.ok;
  } catch {
    // A keepalive request over the browser's shared budget is refused before it
    // leaves: send it as a normal request rather than lose it.
    if (keepalive) return send(method, json, false);
    return false;
  }
}

/** Sends one document as its own PUT, unless it is too large to be stored. */
function sendOne(ns: string, key: string, data: unknown, keepalive: boolean): void {
  let json: string;
  try {
    json = JSON.stringify({ ns, key, data });
  } catch {
    return; // not serializable (a cycle, a BigInt): nothing that could be stored
  }
  const bodyBytes = utf8Length(json);
  if (tooLargeToSync(dataChars(json, { ns, key, data: null }), bodyBytes)) {
    console.warn(`[user-sync] ${ns}/${key} n'est pas synchronisé : document trop volumineux (${bodyBytes} octets). Il reste sur cet appareil.`);
    return;
  }
  void send("PUT", json, keepalive && bodyBytes < MAX_KEEPALIVE_BYTES);
}

function flushOne(id: string, keepalive = false): void {
  const entry = pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(id);
  // keepalive bodies are capped by browsers: large documents go as a normal request.
  sendOne(entry.ns, entry.key, entry.data, keepalive);
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

/**
 * Sends one document right away, bypassing the debounce (keepalive when it is
 * small enough) — for the moment a page is hidden or left, when a queued
 * timer may never get to run.
 */
export function putSyncDocNow(ns: string, key: string, data: unknown): void {
  const id = `${ns}|${key}`;
  const existing = pending.get(id);
  if (existing) {
    clearTimeout(existing.timer);
    pending.delete(id);
  }
  sendOne(ns, key, data, true);
}

/** Deletes on every device (tombstone). */
export function deleteSyncDoc(ns: string, key: string): void {
  const id = `${ns}|${key}`;
  const existing = pending.get(id);
  if (existing) {
    clearTimeout(existing.timer);
    pending.delete(id);
  }
  void send("DELETE", JSON.stringify({ ns, key }));
}

/**
 * Uploads documents in batches of at most MAX_UPLOAD_PER_REQUEST documents
 * and about UPLOAD_BATCH_BYTES each, one batch at a time. A document too
 * large to be stored is skipped (it stays on this device): the server
 * refuses a batch whole, so it would have taken every other document of its
 * batch down with it, on every load.
 */
async function uploadMany(ns: string, docs: { key: string; data: unknown }[]): Promise<void> {
  const head = `{"ns":${JSON.stringify(ns)},"docs":[`;
  const sendBatch = (batch: string[]) => send("PUT", `${head}${batch.join(",")}]}`);
  let batch: string[] = [];
  let batchBytes = 0;
  for (const doc of docs) {
    let json: string;
    try {
      json = JSON.stringify({ key: doc.key, data: doc.data });
    } catch {
      continue; // not serializable: nothing that could be stored
    }
    const docBytes = utf8Length(json) + 1; // + the comma between documents
    if (tooLargeToSync(dataChars(json, { key: doc.key, data: null }), docBytes + head.length + 2)) {
      console.warn(`[user-sync] ${ns}/${doc.key} n'est pas synchronisé : document trop volumineux (${docBytes} octets). Il reste sur cet appareil.`);
      continue;
    }
    if (batch.length > 0 && (batch.length >= MAX_UPLOAD_PER_REQUEST || batchBytes + docBytes > UPLOAD_BATCH_BYTES)) {
      await sendBatch(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(json);
    batchBytes += docBytes;
  }
  if (batch.length > 0) await sendBatch(batch);
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
