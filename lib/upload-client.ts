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
// Every step below gets its own explicit AbortController timeout — without
// this, a stalled network call (dropped wifi mid-upload, a stuck signed-URL
// PUT) left the modal's spinner running FOREVER with zero feedback: the
// single biggest production complaint about this pipeline ("the UI either
// hangs or throws an error"). A clean timeout error at least always resolves
// into something the student can read and retry.
const SIGN_TIMEOUT_MS = 20_000;
// Scales with file size at a conservative ~256 KB/s floor (worse than most
// real mobile connections) — a flat timeout would either be too short for a
// large file on a slow connection or absurdly long for a tiny one. Clamped
// to [60s, 10min] so neither extreme is unreasonable.
function storageUploadTimeoutMs(fileSizeBytes: number): number {
  const estimated = (fileSizeBytes / (256 * 1024)) * 1000;
  return Math.min(Math.max(estimated, 60_000), 600_000);
}
// Comfortably under finalize/route.ts's own 300s maxDuration, giving its
// internal 120s extraction timeout, the Storage download, and the DB writes
// real room to finish rather than racing them.
const FINALIZE_TIMEOUT_MS = 280_000;

/**
 * fetch() + response.json(), both inside the SAME AbortSignal window.
 * IMPORTANT: fetch()'s own returned promise resolves as soon as response
 * HEADERS arrive — the body is a separate stream consumed afterward by
 * .json(). An earlier version of this helper cleared the abort timer the
 * instant fetch() itself settled, which left the subsequent .json() body
 * read completely unguarded: a connection that stalled mid-body (after
 * headers, before the full JSON arrived — a large finalize response on a
 * degraded mobile connection is exactly this shape) could hang forever with
 * zero timeout, reproducing the exact "UI hangs with no feedback" bug this
 * whole file exists to fix. Racing response.json() itself against a second
 * abort-aware rejection closes that gap.
 */
async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout>;
  // ONE timeout, covering fetch() (headers) AND response.json() (body) as a
  // single window — aborting the controller also cancels the underlying
  // network request when the timeout fires during the fetch() phase itself.
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      (async () => {
        const res = await fetch(url, { ...init, signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data: data as Record<string, unknown> };
      })(),
      timeoutPromise,
    ]);
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId!);
  }
}

export async function uploadDocumentDirect(file: File, moduleId?: number): Promise<UploadedDocument> {
  const signOutcome = await fetchJsonWithTimeout(
    "/api/upload/sign",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, fileSize: file.size }) },
    SIGN_TIMEOUT_MS,
    "La préparation de l'envoi a pris trop de temps — vérifie ta connexion puis réessaie."
  );
  const signData = signOutcome.data;
  if (
    !signOutcome.ok ||
    signData?.success !== true ||
    typeof signData.bucket !== "string" ||
    typeof signData.path !== "string" ||
    typeof signData.token !== "string"
  ) {
    throw new Error(typeof signData?.error === "string" ? signData.error : "Impossible de préparer l'envoi du fichier.");
  }
  const { bucket, path, token } = signData as { bucket: string; path: string; token: string };

  // supabase-js's uploadToSignedUrl has no way to accept an AbortSignal (its
  // FileOptions type carries no such field — confirmed by reading
  // @supabase/storage-js's own source, not assumed), so a stalled upload
  // can't actually be CANCELLED here the way fetchJsonWithTimeout cancels a
  // plain fetch above. Racing it against a timeout still fixes the real,
  // reported symptom (the modal's spinner hanging forever with zero
  // feedback): this function returns/throws promptly either way, even
  // though the underlying network request may keep running in the
  // background until it eventually settles on its own.
  const supabase = createClient();
  let uploadTimeoutId: ReturnType<typeof setTimeout>;
  const uploadTimeout = new Promise<never>((_, reject) => {
    uploadTimeoutId = setTimeout(
      () => reject(new Error("L'envoi du fichier a pris trop de temps — vérifie ta connexion (ou réessaie avec un fichier plus léger).")),
      storageUploadTimeoutMs(file.size)
    );
  });
  let uploadError: { message: string } | null;
  try {
    ({ error: uploadError } = await Promise.race([supabase.storage.from(bucket).uploadToSignedUrl(path, token, file), uploadTimeout]));
  } finally {
    clearTimeout(uploadTimeoutId!);
  }
  if (uploadError) {
    const message = uploadError.message ?? "";
    if (/exceeded|too large|maximum allowed size|payload too large/i.test(message)) {
      throw new Error("Ce fichier dépasse la taille maximale autorisée par le stockage — essaie un fichier plus léger.");
    }
    throw new Error(`L'envoi du fichier a échoué : ${message || "erreur inconnue."}`);
  }

  const finalizeOutcome = await fetchJsonWithTimeout(
    "/api/upload/finalize",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, fileName: file.name, ...(moduleId !== undefined ? { moduleId } : {}) }),
    },
    FINALIZE_TIMEOUT_MS,
    "L'extraction du document a pris trop de temps — le fichier est peut-être trop volumineux ou trop complexe. Réessaie, ou essaie un autre fichier."
  );
  const finalizeData = finalizeOutcome.data;
  if (!finalizeOutcome.ok || finalizeData?.success !== true) {
    throw new Error(typeof finalizeData?.error === "string" ? finalizeData.error : "L'extraction du document a échoué.");
  }

  return {
    text: finalizeData.text as string,
    fileName: finalizeData.fileName as string,
    fileUrl: (finalizeData.fileUrl as string | null | undefined) ?? null,
    course: finalizeData.course as StudioCourseSummary | undefined,
  };
}
