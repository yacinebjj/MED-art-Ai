/**
 * Stable keys for reading surfaces (lib/reading/*): one key per piece of
 * content a student reads — e.g. `course-42:explication`, `module-7:synthesis:<entry>`.
 * Keys name the server documents highlights and reading positions are saved
 * under (app/api/user-sync's namespace/key rules: lowercase letters, digits
 * and `:_.-`), so every part is normalized here, and a key too long for a
 * namespace keeps its readable head plus a short hash of the whole.
 */

/** Longest key: "hl:" + key must fit user_sync_documents' 120-character namespace. */
export const MAX_READING_KEY_LENGTH = 112;

/** FNV-1a, 32-bit, base 36 — short and stable, not cryptographic. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Joins the non-empty parts into a normalized key; null when nothing identifies the content. */
export function readingKey(...parts: (string | number | null | undefined | false)[]): string | null {
  const kept = parts.filter((part): part is string | number => part !== null && part !== undefined && part !== false && String(part).trim() !== "");
  if (kept.length === 0) return null;
  const raw = kept.map((part) => String(part).trim()).join(":");
  let key = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9:_.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[^a-z0-9]+/, "");
  if (!key) return null;
  if (key.length > MAX_READING_KEY_LENGTH) {
    const hash = shortHash(raw);
    key = `${key.slice(0, MAX_READING_KEY_LENGTH - hash.length - 1)}-${hash}`;
  }
  return key;
}
