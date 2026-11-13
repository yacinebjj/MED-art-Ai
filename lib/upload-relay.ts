/**
 * The upload relay — the fallback of the direct-to-storage pipeline
 * (lib/upload-client.ts). Client-safe: shared by the browser side and
 * app/api/upload/relay/route.ts, no server imports.
 *
 * Normally the browser PUTs a file straight to Supabase Storage with a signed
 * URL. When Storage never answers from the student's side — the browser's
 * "Failed to fetch": a network that can't reach supabase.co, or a Storage
 * incident (Code Red 2026-11-13) — the same bytes go to MedArt's own server
 * instead, which uploads them itself with the very same signed token. Vercel
 * caps a request body at ~4.5 MB, so a larger file travels in parts, kept in
 * a private bucket until the server assembles them.
 */

/** One relay request's body at most — safely under Vercel's ~4.5 MB request ceiling. */
export const RELAY_CHUNK_BYTES = 3.5 * 1024 * 1024;

/** The buckets the signed-upload routes hand out tokens for (app/api/upload/sign, app/api/exam/analyze-reference/sign). */
export const RELAY_BUCKETS: readonly string[] = ["course-sources", "exam-references"];

/** Content types a relayed file may carry: the documents and pictures those routes accept. */
export const RELAY_CONTENT_TYPES: readonly string[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/octet-stream",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isRelayUploadId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** A v4 UUID, also where crypto.randomUUID is missing (older mobile browsers). */
export function relayUploadId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
