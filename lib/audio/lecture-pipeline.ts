/**
 * BROWSER-ONLY orchestration of "Audio to Smart Notes" for recordings of up
 * to 2 hours and more, built so that no single request ever has to last
 * long, and nothing is lost when one fails:
 *
 *   decode once (16 kHz) ─▶ for each 4-min chunk, 3 in parallel:
 *        encode WAV ─▶ signed URL ─▶ PUT straight to Supabase Storage
 *        ─▶ transcribe (server downloads it; tiny JSON request)
 *   ─▶ POST /process → { jobId } (background job) ─▶ poll /status
 *
 * - Every chunk retries up to 4 times with backoff (honours Retry-After).
 * - Finished chunks are checkpointed in localStorage per file fingerprint:
 *   re-running the same file (after a network drop, a closed tab, a
 *   reload) resumes from the first missing chunk — already-transcribed
 *   minutes are never re-uploaded nor re-billed.
 */

import { createClient } from "@/lib/supabase/client";
import { CHUNK_SECONDS, computePeaks, encodeLectureChunk, prepareLectureAudio, type PreparedLectureAudio } from "@/lib/audio/browser-chunking";
import { buildTimestampedTranscript } from "@/lib/lecture-transcript";

export type PipelineStage = "decoding" | "transcribing" | "analyzing";

export interface PipelineProgress {
  stage: PipelineStage;
  /** 0..1 over the whole pipeline. */
  ratio: number;
  label: string;
  chunksDone?: number;
  chunksTotal?: number;
}

interface ChunkResult {
  text: string;
  audioUrl: string;
}

interface Checkpoint {
  uploadId: string;
  total: number;
  results: Record<string, ChunkResult>;
  savedAt: number;
}

const CONCURRENCY = 3;
const MAX_ATTEMPTS = 4;
const CHECKPOINT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 120_000;

export class LecturePipelineError extends Error {
  /** True when some chunks are checkpointed: re-running the same file resumes. */
  resumable: boolean;
  constructor(message: string, resumable: boolean) {
    super(message);
    this.name = "LecturePipelineError";
    this.resumable = resumable;
  }
}

function checkpointKey(file: File): string {
  return `medart:lecture-progress:${file.name}:${file.size}:${file.lastModified}`;
}

function readCheckpoint(file: File): Checkpoint | null {
  try {
    const raw = window.localStorage.getItem(checkpointKey(file));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Checkpoint;
    if (!parsed.uploadId || typeof parsed.total !== "number" || Date.now() - parsed.savedAt > CHECKPOINT_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCheckpoint(file: File, checkpoint: Checkpoint): void {
  try {
    window.localStorage.setItem(checkpointKey(file), JSON.stringify({ ...checkpoint, savedAt: Date.now() }));
  } catch {
    // Storage full or blocked: the run continues, it just cannot be resumed.
  }
}

export function clearLectureCheckpoint(file: File): void {
  try {
    window.localStorage.removeItem(checkpointKey(file));
  } catch {
    // ignore
  }
}

/** How many chunks of this file are already transcribed (for a "Reprendre" hint before starting). */
export function checkpointedChunkCount(file: File): number {
  return Object.keys(readCheckpoint(file)?.results ?? {}).length;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("Annulé", "AbortError"));
    });
  });

class HttpError extends Error {
  status: number;
  retryAfterMs: number | null;
  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

async function postJson<T>(url: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string } & T;
  if (!res.ok || !data.success) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    throw new HttpError(data.error ?? `Erreur serveur (HTTP ${res.status}).`, res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null);
  }
  return data;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (error instanceof HttpError) return error.status >= 500 || [404, 408, 409, 425, 429].includes(error.status);
  return true; // network errors, timeouts, storage hiccups
}

async function uploadAndTranscribe(prepared: PreparedLectureAudio, uploadId: string, index: number, signal: AbortSignal): Promise<ChunkResult> {
  const blob = await encodeLectureChunk(prepared, index);
  const signed = await postJson<{ bucket: string; path: string; token: string }>("/api/lecture-notes/upload-url", { uploadId, chunkIndex: index }, signal);

  const supabase = createClient();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Envoi du segment trop lent — nouvelle tentative.")), UPLOAD_TIMEOUT_MS);
  });
  try {
    const { error } = await Promise.race([supabase.storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, blob, { contentType: "audio/wav", upsert: true }), timeout]);
    if (error) throw new Error(`Envoi du segment ${index + 1} échoué : ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const result = await postJson<{ text: string; audioUrl: string }>("/api/lecture-notes/transcribe-chunk", { uploadId, chunkIndex: index }, signal);
  return { text: result.text ?? "", audioUrl: result.audioUrl };
}

/**
 * Decodes, uploads and transcribes `file`. Resolves with the timestamped
 * transcript and the ordered chunk URLs (the saved recording).
 */
export async function transcribeLecture(
  file: File,
  options: { onProgress: (p: PipelineProgress) => void; onPeaks?: (peaks: number[], durationSec: number) => void; signal: AbortSignal }
): Promise<{ transcript: string; audioUrls: string[]; durationSec: number }> {
  const { onProgress, onPeaks, signal } = options;
  onProgress({ stage: "decoding", ratio: 0.02, label: "Décodage et compression de l'audio…" });

  const prepared = await prepareLectureAudio(file);
  onPeaks?.(computePeaks(prepared.buffer), prepared.durationSec);
  const total = prepared.chunkCount;

  const existing = readCheckpoint(file);
  const checkpoint: Checkpoint =
    existing && existing.total === total ? existing : { uploadId: crypto.randomUUID(), total, results: {}, savedAt: Date.now() };

  const pending = Array.from({ length: total }, (_, i) => i).filter((i) => !checkpoint.results[String(i)]);
  let done = total - pending.length;
  const report = () =>
    onProgress({
      stage: "transcribing",
      ratio: 0.06 + 0.86 * (done / total),
      label: `Transcription Whisper — segment ${Math.min(done + 1, total)}/${total} (${Math.round((done / total) * 100)}%)`,
      chunksDone: done,
      chunksTotal: total,
    });
  report();

  const outcome: { failure: unknown } = { failure: null };
  async function worker() {
    while (pending.length > 0 && !outcome.failure) {
      const index = pending.shift()!;
      for (let attempt = 1; ; attempt++) {
        if (signal.aborted) throw new DOMException("Annulé", "AbortError");
        try {
          checkpoint.results[String(index)] = await uploadAndTranscribe(prepared, checkpoint.uploadId, index, signal);
          writeCheckpoint(file, checkpoint);
          done++;
          report();
          break;
        } catch (error) {
          if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) {
            outcome.failure = error;
            return;
          }
          const wait = error instanceof HttpError && error.retryAfterMs ? error.retryAfterMs : 1500 * 2 ** (attempt - 1);
          await sleep(Math.min(wait, 60_000), signal);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, pending.length)) }, worker));

  const failure = outcome.failure;
  if (failure) {
    if (failure instanceof DOMException && failure.name === "AbortError") throw failure;
    const message = failure instanceof Error ? failure.message : "Erreur inconnue.";
    const saved = Object.keys(checkpoint.results).length;
    throw new LecturePipelineError(
      saved > 0 ? `${message} — ${saved}/${total} segments sont sauvegardés : relance pour reprendre là où ça s'est arrêté.` : message,
      saved > 0
    );
  }

  const ordered = Array.from({ length: total }, (_, i) => checkpoint.results[String(i)]);
  return {
    transcript: buildTimestampedTranscript(ordered.map((r, i) => ({ startSec: i * CHUNK_SECONDS, text: r.text }))),
    audioUrls: ordered.map((r) => r.audioUrl),
    durationSec: prepared.durationSec,
  };
}

/** Starts (or relaunches, with `jobId`) the background extraction job. */
export async function startNotesJob(payload: { title: string; transcript: string; audioUrls: string[] } | { jobId: number }): Promise<{ jobId: number; status: string }> {
  return postJson<{ jobId: number; status: string }>("/api/lecture-notes/process", payload);
}

export class StaleJobError extends Error {
  jobId: number;
  constructor(jobId: number) {
    super("L'analyse s'est interrompue côté serveur. Relance-la : ta transcription est sauvegardée, rien n'est perdu.");
    this.jobId = jobId;
  }
}

/** Polls the job until it is done; resolves with the Smart Notes. */
export async function waitForNotes(jobId: number, options: { signal: AbortSignal; onTick?: (elapsedMs: number) => void }): Promise<string> {
  const started = Date.now();
  for (let i = 0; ; i++) {
    await sleep(i === 0 ? 2500 : 4000, options.signal);
    options.onTick?.(Date.now() - started);
    let data: { status?: string; smartNotes?: string | null; error?: string | null; stale?: boolean; success?: boolean };
    try {
      const res = await fetch(`/api/lecture-notes/status?jobId=${jobId}`, { cache: "no-store", signal: options.signal });
      data = await res.json();
      if (!res.ok || !data.success) continue; // transient — keep polling
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      continue; // offline for a moment: the job keeps running server-side
    }
    if (data.status === "done" && data.smartNotes) return data.smartNotes;
    if (data.status === "failed") throw new Error(data.error ?? "L'analyse IA a échoué.");
    if (data.stale) throw new StaleJobError(jobId);
  }
}
