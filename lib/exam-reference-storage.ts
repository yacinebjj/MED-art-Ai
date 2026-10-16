import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { MAX_UPLOAD_FILE_BYTES } from "@/lib/upload-limits";

/**
 * Storage for "Examen Guidé par le Style Prof" reference exams. The browser
 * uploads the file straight to this bucket via a signed URL
 * (app/api/exam/analyze-reference/sign), and app/api/exam/analyze-reference
 * then downloads it server-side — the raw bytes never pass through a Route
 * Handler body, which Vercel caps at ~4.5 MB. Private: the file is only ever
 * read back by the server, and deleted right after its style is extracted.
 */
export const EXAM_REFERENCES_BUCKET = "exam-references";

export const EXAM_REFERENCE_MIME_TO_KIND: Record<string, "pdf" | "image"> = {
  "application/pdf": "pdf",
  "image/png": "image",
  "image/jpeg": "image",
  "image/jpg": "image",
};

export async function ensureExamReferencesBucket(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  // Bucket-level size cap: the signed URL lets the browser PUT bytes we never
  // see, so this (not the client-declared fileSize) is the real limit.
  const config = { public: false, fileSizeLimit: MAX_UPLOAD_FILE_BYTES, allowedMimeTypes: Object.keys(EXAM_REFERENCE_MIME_TO_KIND) };
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((bucket: { name: string }) => bucket.name === EXAM_REFERENCES_BUCKET)) {
    const { error: updateError } = await supabase.storage.updateBucket(EXAM_REFERENCES_BUCKET, config);
    if (updateError) console.error("[exam-reference-storage] Échec mise à jour du bucket (non bloquant):", updateError.message);
    return;
  }
  const { error } = await supabase.storage.createBucket(EXAM_REFERENCES_BUCKET, config);
  // A concurrent upload can win the race to create the bucket — not a real failure.
  if (error && !/already exists/i.test(error.message)) throw error;
}

/** `${userId}/...` namespacing is what analyze-reference checks to refuse another student's file. */
export function buildExamReferencePath(userId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  return `${userId}/${randomUUID()}-${safeName}`;
}
