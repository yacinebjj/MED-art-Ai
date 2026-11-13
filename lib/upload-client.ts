"use client";

import { createClient } from "@/lib/supabase/client";
import { RELAY_CHUNK_BYTES, relayUploadId } from "@/lib/upload-relay";
import type { StudioCourseSummary } from "@/types/studio-course";

export interface UploadedDocument {
  text: string;
  fileName: string;
  fileUrl: string | null;
  /** Only present when `moduleId` was passed to uploadDocumentDirect — the server created the studio_courses row directly, avoiding a second round-trip that would resend this same (possibly large) text back to this app's own server. */
  course?: StudioCourseSummary;
}

/**
 * Thrown instead of a plain Error when /api/upload/finalize detected a
 * PDF with no real text layer (a scanned/rasterized document) AND a real
 * OCR fallback is available for it (see app/api/upload/finalize-ocr/route.ts).
 * `path`/`fileName` are exactly what that fallback route needs — the file is
 * already sitting in Storage from this same upload, no re-upload needed.
 * Callers (UploadModal) can `instanceof` this to offer a one-click "Essayer
 * l'OCR" action instead of a dead-end error.
 */
export class OcrSuggestedError extends Error {
  path: string;
  fileName: string;
  constructor(message: string, path: string, fileName: string) {
    super(message);
    this.name = "OcrSuggestedError";
    this.path = path;
    this.fileName = fileName;
  }
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

/**
 * Steps 1-2 of the direct-to-storage pipeline, shared by every caller: ask
 * `signUrl` for a signed upload URL, then PUT the file straight to Supabase
 * Storage. Returns where it landed; the caller's own finalize/analyze step
 * takes it from there.
 */
export async function uploadFileToSignedStorage(signUrl: string, signBody: Record<string, unknown>, file: File): Promise<{ bucket: string; path: string }> {
  const signOutcome = await fetchJsonWithTimeout(
    signUrl,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, fileSize: file.size, ...signBody }) },
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

  // Step 2, directly: the browser PUTs the file to Storage. A failure where
  // Storage never answered (the browser's "Failed to fetch": a network that
  // can't reach supabase.co, a Storage incident — Code Red 2026-11-13) gets
  // two more tries, then the relay: the same bytes, the same signed token,
  // carried by MedArt's own server (app/api/upload/relay). A real answer from
  // Storage (too large, refused…) is final, as before.
  const supabase = createClient();
  for (let attempt = 0; attempt <= DIRECT_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(DIRECT_RETRY_DELAYS_MS[attempt - 1]);
    // supabase-js's uploadToSignedUrl has no way to accept an AbortSignal (its
    // FileOptions type carries no such field — confirmed by reading
    // @supabase/storage-js's own source, not assumed), so a stalled upload
    // can't actually be CANCELLED here the way fetchJsonWithTimeout cancels a
    // plain fetch above. Racing it against a timeout still fixes the real,
    // reported symptom (the modal's spinner hanging forever with zero
    // feedback): this function returns/throws promptly either way, even
    // though the underlying network request may keep running in the
    // background until it eventually settles on its own.
    let uploadTimeoutId: ReturnType<typeof setTimeout>;
    const uploadTimeout = new Promise<"timeout">((resolve) => {
      uploadTimeoutId = setTimeout(() => resolve("timeout"), storageUploadTimeoutMs(file.size));
    });
    let outcome: { error: StorageErrorLike | null } | "timeout";
    try {
      outcome = await Promise.race([supabase.storage.from(bucket).uploadToSignedUrl(path, token, file), uploadTimeout]);
    } catch (error) {
      outcome = { error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) } };
    } finally {
      clearTimeout(uploadTimeoutId!);
    }
    // A stalled direct upload: don't wait that long again — the relay takes over.
    if (outcome === "timeout") break;
    const uploadError = outcome.error;
    if (!uploadError) return { bucket, path };
    const message = uploadError.message ?? "";
    // An earlier try landed although the browser never heard back: the file is already there.
    if (attempt > 0 && /already exists|duplicate/i.test(message)) return { bucket, path };
    if (isTransientFailure(uploadError)) continue;
    if (/exceeded|too large|maximum allowed size|payload too large/i.test(message)) {
      throw new Error("Ce fichier dépasse la taille maximale autorisée par le stockage — essaie un fichier plus léger.");
    }
    throw new Error(`L'envoi du fichier a échoué : ${message || "erreur inconnue."}`);
  }

  await relayUpload(bucket, path, token, file);
  return { bucket, path };
}

/** Waits between direct tries when Storage never answered (a blip, a dropped connection). */
const DIRECT_RETRY_DELAYS_MS = [1_200, 3_500];

/** Generous: a relay request carries up to 3.5 MB through MedArt's server, which uploads it in turn. */
const RELAY_TIMEOUT_MS = 120_000;

interface StorageErrorLike {
  name?: string;
  message: string;
  /** HTTP status of a StorageApiError (an answer Storage did send). */
  status?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Not the file's fault: Storage never answered (supabase-js wraps a failed fetch() as a StorageUnknownError), or answered with a server error. */
function isTransientFailure(error: StorageErrorLike): boolean {
  if (error.name === "StorageUnknownError") return true;
  if (typeof error.status === "number" && error.status >= 500) return true;
  return /failed to fetch|networkerror|network error|load failed|network request failed|fetch failed|err_/i.test(error.message ?? "");
}

const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** One relay request; a failure that never reached MedArt's server reads as a connection problem, never as "Failed to fetch". */
async function relayRequest(mode: "whole" | "part" | "complete", headers: Record<string, string>, body: BodyInit): Promise<void> {
  let outcome: Awaited<ReturnType<typeof fetchJsonWithTimeout>>;
  try {
    outcome = await fetchJsonWithTimeout(
      `/api/upload/relay?mode=${mode}`,
      { method: "POST", headers, body },
      RELAY_TIMEOUT_MS,
      "L'envoi du fichier a pris trop de temps — vérifie ta connexion (ou réessaie avec un fichier plus léger)."
    );
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Connexion perdue pendant l'envoi du fichier — vérifie ta connexion puis réessaie.");
    throw error;
  }
  if (!outcome.ok || outcome.data?.success !== true) {
    throw new Error(typeof outcome.data?.error === "string" ? outcome.data.error : "L'envoi du fichier a échoué — réessaie dans un instant.");
  }
}

/** Step 2 through MedArt's own server (app/api/upload/relay): whole when it fits one request, else in parts assembled there. */
async function relayUpload(bucket: string, path: string, token: string, file: File): Promise<void> {
  const contentType = file.type || CONTENT_TYPES_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream";
  if (file.size <= RELAY_CHUNK_BYTES) {
    await relayRequest(
      "whole",
      {
        "content-type": "application/octet-stream",
        "x-upload-bucket": bucket,
        "x-upload-path": encodeURIComponent(path),
        "x-upload-token": token,
        "x-upload-content-type": contentType,
      },
      file
    );
    return;
  }
  const uploadId = relayUploadId();
  const parts = Math.ceil(file.size / RELAY_CHUNK_BYTES);
  for (let index = 0; index < parts; index++) {
    await relayRequest(
      "part",
      { "content-type": "application/octet-stream", "x-upload-id": uploadId, "x-upload-part": String(index), "x-upload-parts": String(parts) },
      file.slice(index * RELAY_CHUNK_BYTES, (index + 1) * RELAY_CHUNK_BYTES)
    );
  }
  await relayRequest("complete", { "content-type": "application/json" }, JSON.stringify({ bucket, path, token, uploadId, parts, size: file.size, contentType }));
}

export async function uploadDocumentDirect(file: File, moduleId?: number): Promise<UploadedDocument> {
  const { path } = await uploadFileToSignedStorage("/api/upload/sign", {}, file);

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
    const message = typeof finalizeData?.error === "string" ? finalizeData.error : "L'extraction du document a échoué.";
    if (finalizeData?.suggestOcr === true && typeof finalizeData.path === "string" && typeof finalizeData.fileName === "string") {
      throw new OcrSuggestedError(message, finalizeData.path, finalizeData.fileName);
    }
    throw new Error(message);
  }

  return {
    text: finalizeData.text as string,
    fileName: finalizeData.fileName as string,
    fileUrl: (finalizeData.fileUrl as string | null | undefined) ?? null,
    course: finalizeData.course as StudioCourseSummary | undefined,
  };
}

// OCR (mistral-ocr via OpenRouter) genuinely takes longer than normal
// extraction — real per-page server-side processing, not something this
// client controls. Comfortably under finalize-ocr/route.ts's own 280s
// maxDuration.
const FINALIZE_OCR_TIMEOUT_MS = 260_000;

/**
 * Explicit, student-initiated retry via OCR after uploadDocumentDirect threw
 * an OcrSuggestedError — a real, billed OpenRouter call (see
 * app/api/upload/finalize-ocr/route.ts's own header comment), so this is
 * never triggered automatically. `path`/`fileName` come straight from that
 * error; no re-upload needed, the file is already in Storage.
 */
export async function retryUploadWithOcr(path: string, fileName: string, moduleId?: number): Promise<UploadedDocument> {
  const outcome = await fetchJsonWithTimeout(
    "/api/upload/finalize-ocr",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, fileName, ...(moduleId !== undefined ? { moduleId } : {}) }),
    },
    FINALIZE_OCR_TIMEOUT_MS,
    "L'extraction OCR a pris trop de temps — réessaie dans un instant, ou essaie un autre fichier."
  );
  const data = outcome.data;
  if (!outcome.ok || data?.success !== true) {
    throw new Error(typeof data?.error === "string" ? data.error : "L'extraction OCR a échoué.");
  }
  return {
    text: data.text as string,
    fileName: data.fileName as string,
    fileUrl: (data.fileUrl as string | null | undefined) ?? null,
    course: data.course as StudioCourseSummary | undefined,
  };
}
