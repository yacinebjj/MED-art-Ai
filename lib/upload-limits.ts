/**
 * App-wide caps on what a student can upload. Single source of truth for
 * every upload route AND its client-side pre-check (UploadModal, the
 * co-pilot drop zone, the study planner, group chat media…) — client-safe
 * on purpose (no server imports) so both sides read the exact same numbers.
 */
export const MAX_UPLOAD_FILE_MB = 10;
export const MAX_UPLOAD_FILE_BYTES = MAX_UPLOAD_FILE_MB * 1024 * 1024;

/** Max files a student can send in one go (batch upload, multi-file drop). */
export const MAX_UPLOAD_FILES = 10;
