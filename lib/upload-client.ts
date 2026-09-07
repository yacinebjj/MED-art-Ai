"use client";

import { createClient } from "@/lib/supabase/client";
import type { StudioCourseSummary } from "@/types/studio-course";

export interface UploadedDocument {
  text: string;
  fileName: string;
  fileUrl: string | null;
  /** Only present when `moduleId` was passed to uploadDocumentDirect — the server created the studio_courses row directly, avoiding a second round-trip that would resend this same (possibly large) text back to this app's own server. */
  course?: StudioCourseSummary;
}

/**
 * Direct-to-storage document upload — the browser uploads the raw file
 * bytes straight to Supabase Storage (via a short-lived signed URL this app
 * requests for it), completely bypassing this app's own Next.js Route
 * Handlers for the actual file transfer. This is the real fix for large
 * course PDFs failing to upload: Vercel enforces a hard ~4.5 MB request-body
 * ceiling on every Node.js Function on every plan, with no way to raise it
 * from application code — a route that receives the file bytes directly (the
 * old /api/upload) can declare whatever size limit it wants, but Vercel
 * rejects anything over that ceiling before the route's own code ever runs.
 * A signed Storage upload has no such limit (subject only to Supabase's own
 * project-level Storage limits, which are far more generous).
 *
 * Replaces the old single `POST /api/upload` (multipart body) call with
 * three small steps, none of which ever carries the file bytes through this
 * app's own server except the final, server-to-server download in step 3
 * (which isn't bound by the request-body limit either — that's an outbound
 * call this server makes to Supabase, not an inbound request from a
 * browser):
 *   1. POST /api/upload/sign — ask for a signed upload URL/token for this
 *      file's future path.
 *   2. supabase.storage.uploadToSignedUrl(...) — the browser's own upload,
 *      straight to Supabase, using the anon-key client (the token itself is
 *      the authorization; no bucket RLS write policy is needed for this).
 *   3. POST /api/upload/finalize — tell the server the upload is done; it
 *      downloads the file from Storage, extracts its text, and returns it.
 *
 * Returns the exact same shape the old /api/upload did ({text, fileName,
 * fileUrl}), so every caller's downstream logic (creating a studio_courses
 * row, feeding text to the Assistant, etc.) needs no changes beyond calling
 * this instead of doing its own `fetch("/api/upload", {body: formData})`.
 */
export async function uploadDocumentDirect(file: File, moduleId?: number): Promise<UploadedDocument> {
  const signRes = await fetch("/api/upload/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
  });
  const signData = await signRes.json().catch(() => ({}));
  if (!signRes.ok || !signData?.success) {
    throw new Error(signData?.error ?? "Impossible de préparer l'envoi du fichier.");
  }

  const supabase = createClient();
  const { error: uploadError } = await supabase.storage
    .from(signData.bucket)
    .uploadToSignedUrl(signData.path, signData.token, file);
  if (uploadError) {
    throw new Error(`L'envoi du fichier a échoué : ${uploadError.message}`);
  }

  const finalizeRes = await fetch("/api/upload/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: signData.path, fileName: file.name, ...(moduleId !== undefined ? { moduleId } : {}) }),
  });
  const finalizeData = await finalizeRes.json().catch(() => ({}));
  if (!finalizeRes.ok || !finalizeData?.success) {
    throw new Error(finalizeData?.error ?? "L'extraction du document a échoué.");
  }

  return {
    text: finalizeData.text,
    fileName: finalizeData.fileName,
    fileUrl: finalizeData.fileUrl ?? null,
    course: finalizeData.course,
  };
}
