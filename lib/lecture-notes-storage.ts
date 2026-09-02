/**
 * Shared Supabase Storage helper for the "Audio to Smart Notes" feature —
 * used by both app/api/lecture-notes/transcribe-chunk/route.ts (uploads one
 * small chunk) and app/api/lecture-notes/process/route.ts (only needs the
 * bucket to exist; the actual chunk uploads already happened by the time
 * that route runs). Pulled out of a single route file once a second route
 * needed the exact same bucket, instead of duplicating it.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";

export const LECTURE_RECORDINGS_BUCKET = "lecture-recordings";

// Real ceiling confirmed live, 2026-09-02: OpenRouter's transcription
// endpoint hard-caps the WHOLE request body at 52,428,800 bytes (50 MiB
// exactly) regardless of input mode — a chunk this size would already be
// rejected before Supabase Storage even enters the picture. Chunks produced
// by lib/audio/browser-chunking.ts are ~15.4 MB by construction; this is a
// defensive ceiling against a malformed/oversized chunk, not a number chunks
// are expected to approach in practice.
export const MAX_CHUNK_BYTES = 24 * 1024 * 1024;

/**
 * Mirrors every other Studio bucket's ensure-bucket helper — a concurrent
 * request can win the race to create the bucket, which is not a real
 * failure — plus an explicit `fileSizeLimit` (see app/api/lecture-notes
 * /process/route.ts's git history for why this was added: a bucket created
 * with no limit silently inherits the Supabase PROJECT's own global Storage
 * limit, which is unrelated to and can be far below what this feature
 * expects). `updateBucket` also runs when the bucket already exists, since
 * `createBucket`'s options only apply at creation time.
 */
export async function ensureLectureRecordingsBucket(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((bucket: { name: string }) => bucket.name === LECTURE_RECORDINGS_BUCKET);

  if (exists) {
    const { error: updateError } = await supabase.storage.updateBucket(LECTURE_RECORDINGS_BUCKET, {
      public: true,
      fileSizeLimit: MAX_CHUNK_BYTES,
    });
    if (updateError) {
      console.error("[lecture-notes-storage] Échec mise à jour du bucket (non bloquant):", updateError.message);
    }
    return;
  }

  const { error } = await supabase.storage.createBucket(LECTURE_RECORDINGS_BUCKET, {
    public: true,
    fileSizeLimit: MAX_CHUNK_BYTES,
  });
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
}
