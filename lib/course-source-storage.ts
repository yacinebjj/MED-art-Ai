import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Shared Supabase Storage config for uploaded course source files — used by
 * both the direct-to-storage upload pipeline (app/api/upload/sign,
 * app/api/upload/finalize) and, historically, the legacy in-body upload
 * (app/api/upload/route.ts). Extracted here so neither route duplicates the
 * bucket-provisioning logic.
 */
export const SOURCE_FILES_BUCKET = "course-sources";

export const SOURCE_FILE_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
};

// Same 100 MB ceiling every other upload route declares (app/api/upload/route.ts,
// app/api/study-planner/upload/route.ts, components/dashboard/UploadModal.tsx's
// client-side check) — SECURITY: without this on the BUCKET itself, that
// ceiling was only ever enforced against a client-DECLARED `fileSize` number
// in /api/upload/sign's request body, never against the actual bytes later PUT
// straight to Supabase Storage's signed URL. A caller could declare a tiny
// fileSize to pass that check, then PUT an arbitrarily large real file — the
// bucket had no limit of its own to reject it. Mirrors
// lib/lecture-notes-storage.ts's own fix for the identical gap.
export const MAX_SOURCE_FILE_BYTES = 100 * 1024 * 1024;

export async function ensureSourceFilesBucket(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((bucket: { name: string }) => bucket.name === SOURCE_FILES_BUCKET);

  if (exists) {
    const { error: updateError } = await supabase.storage.updateBucket(SOURCE_FILES_BUCKET, {
      public: true,
      fileSizeLimit: MAX_SOURCE_FILE_BYTES,
    });
    if (updateError) {
      console.error("[course-source-storage] Échec mise à jour du bucket (non bloquant):", updateError.message);
    }
    return;
  }

  const { error } = await supabase.storage.createBucket(SOURCE_FILES_BUCKET, {
    public: true,
    fileSizeLimit: MAX_SOURCE_FILE_BYTES,
  });
  // A concurrent upload can win the race to create the bucket between the
  // listBuckets check above and this call — not a real failure.
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
}

/** A safe, unique storage path for one student's uploaded file — same shape the old in-body upload route used, so existing objects in the bucket stay valid. */
export function buildSourceFilePath(userId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  return `${userId}/${randomUUID()}-${safeName}`;
}
