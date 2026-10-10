/**
 * Client-side, per-browser cache of generated audio files (Studio "Podcast
 * Audio" episodes) in IndexedDB, keyed by the file's public URL — which is
 * itself content-addressed (sha256 of the course text + prompt version
 * [+ dialect], see app/api/studio/podcast/route.ts), so a URL's bytes never
 * change meaning.
 *
 * Why: the player used to download the whole mp3 twice per visit (once to
 * draw the waveform, once more through the <audio> element), and again on
 * every reload. With this cache, the first visit's waveform download is kept
 * (bytes + computed peaks) and every later visit plays from local storage
 * with its waveform ready at once — zero network.
 *
 * Strictly best-effort: no IndexedDB (SSR, private mode, blocked storage), a
 * quota error or a slow/blocked open all resolve to "miss" / no-op — playback
 * never depends on it. Bounded LRU (MAX_ENTRIES / MAX_TOTAL_BYTES), tracked in
 * a small separate "meta" store so eviction never loads audio bytes.
 */

const DB_NAME = "medart-audio-cache";
const DB_VERSION = 1;
const FILES = "files";
const META = "meta";
const MAX_ENTRIES = 8;
const MAX_TOTAL_BYTES = 160 * 1024 * 1024;
/** A single file above this is never cached (keeps one entry from evicting everything). */
export const MAX_CACHED_AUDIO_BYTES = 60 * 1024 * 1024;
/** An open/read slower than this is treated as a miss — the player must never wait on storage. */
const OPERATION_TIMEOUT_MS = 1_500;

export interface CachedWaveform {
  peaks: number[];
  duration: number;
}

interface FileRecord {
  url: string;
  /** Stored as an ArrayBuffer, not a Blob: older Safari cannot persist Blobs in IndexedDB. */
  bytes: ArrayBuffer;
  type: string;
  waveform: CachedWaveform | null;
}

interface MetaRecord {
  url: string;
  size: number;
  lastAccess: number;
}

export interface CachedAudio {
  blob: Blob;
  waveform: CachedWaveform | null;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), OPERATION_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  const opening = withTimeout(
    new Promise<IDBDatabase | null>((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: "url" });
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "url" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }),
    null
  ).then((db) => {
    // A failed open is retried on the next call instead of being memoized forever.
    if (!db) dbPromise = null;
    return db;
  });
  dbPromise = opening;
  return opening;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** The cached file for `url`, or null on a miss or any storage problem. */
export async function getCachedAudio(url: string): Promise<CachedAudio | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const record = await withTimeout(
      requestToPromise(db.transaction(FILES, "readonly").objectStore(FILES).get(url) as IDBRequest<FileRecord | undefined>),
      undefined
    );
    if (!record || !(record.bytes instanceof ArrayBuffer) || record.bytes.byteLength === 0) return null;
    // LRU bookkeeping, fire-and-forget.
    try {
      db.transaction(META, "readwrite").objectStore(META).put({ url, size: record.bytes.byteLength, lastAccess: Date.now() } satisfies MetaRecord);
    } catch {
      /* best-effort */
    }
    return { blob: new Blob([record.bytes], { type: record.type || "audio/mpeg" }), waveform: record.waveform ?? null };
  } catch {
    return null;
  }
}

/** Stores a downloaded file (+ its waveform), then evicts least-recently-used entries over the caps. Never throws. */
export async function putCachedAudio(url: string, bytes: ArrayBuffer, type: string, waveform: CachedWaveform | null): Promise<void> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CACHED_AUDIO_BYTES) return;
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction([FILES, META], "readwrite");
    tx.objectStore(FILES).put({ url, bytes, type: type || "audio/mpeg", waveform } satisfies FileRecord);
    tx.objectStore(META).put({ url, size: bytes.byteLength, lastAccess: Date.now() } satisfies MetaRecord);
    await transactionDone(tx);
    await pruneCache(db);
  } catch {
    // Quota exceeded / private mode: the cache is a convenience only.
  }
}

export async function deleteCachedAudio(url: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction([FILES, META], "readwrite");
    tx.objectStore(FILES).delete(url);
    tx.objectStore(META).delete(url);
    await transactionDone(tx);
  } catch {
    /* best-effort */
  }
}

async function pruneCache(db: IDBDatabase): Promise<void> {
  const metas = (await requestToPromise(db.transaction(META, "readonly").objectStore(META).getAll() as IDBRequest<MetaRecord[]>)) ?? [];
  const newestFirst = [...metas].sort((a, b) => (b.lastAccess ?? 0) - (a.lastAccess ?? 0));
  let total = 0;
  const evict: string[] = [];
  newestFirst.forEach((entry, index) => {
    total += entry.size ?? 0;
    if (index >= MAX_ENTRIES || total > MAX_TOTAL_BYTES) evict.push(entry.url);
  });
  if (evict.length === 0) return;
  const tx = db.transaction([FILES, META], "readwrite");
  for (const url of evict) {
    tx.objectStore(FILES).delete(url);
    tx.objectStore(META).delete(url);
  }
  await transactionDone(tx);
}
