import { randomUUID } from "crypto";
import type { getSupabaseAdmin } from "@/lib/supabase/server";
import { MAX_UPLOAD_FILE_BYTES } from "@/lib/upload-limits";

/**
 * EXAM GENOME — where the papers' files live: a PRIVATE bucket. The browser
 * PUTs a file straight to it through a signed upload URL
 * (app/api/exam-genome/ingest/sign), so the bytes never cross a Route
 * Handler body (Vercel's ~4.5 MB ceiling); the ingest route then reads it
 * server-side. A file that turns out not to be an in-scope exam is deleted;
 * the others stay as the evidence behind each stored paper (eg_sources).
 */
export const GENOME_BUCKET = "exam-genome";

export const GENOME_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type GenomeMimeType = (typeof GENOME_MIME_TYPES)[number];

export function isGenomeMimeType(value: unknown): value is GenomeMimeType {
  return typeof value === "string" && (GENOME_MIME_TYPES as readonly string[]).includes(value);
}

type Admin = ReturnType<typeof getSupabaseAdmin>;

export async function ensureGenomeBucket(supabase: Admin): Promise<void> {
  // Bucket-level limits: the signed URL lets the browser PUT bytes we never see, so these (not the declared size) are the real ones.
  const config = { public: false, fileSizeLimit: MAX_UPLOAD_FILE_BYTES, allowedMimeTypes: [...GENOME_MIME_TYPES] };
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((bucket: { name: string }) => bucket.name === GENOME_BUCKET)) return;
  const { error } = await supabase.storage.createBucket(GENOME_BUCKET, config);
  // A concurrent upload can win the race to create the bucket — not a real failure.
  if (error && !/already exists/i.test(error.message)) throw error;
}

/** `${userId}/…`: the ingest route only accepts a path under the caller's own folder. */
export function buildGenomePath(userId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-80);
  return `${userId}/${randomUUID()}-${safeName}`;
}

export function isOwnGenomePath(userId: string, path: unknown): path is string {
  return typeof path === "string" && path.startsWith(`${userId}/`) && !path.includes("..") && path.length <= 300;
}
