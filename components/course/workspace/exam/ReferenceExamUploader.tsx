"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExamStyleProfile } from "@/lib/ai/exam-schemas";
import { postJsonWithHeartbeat } from "@/lib/heartbeat-fetch";
import { uploadFileToSignedStorage } from "@/lib/upload-client";
import { MAX_UPLOAD_FILE_BYTES } from "@/lib/upload-limits";

const ACCEPTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg"];
const ACCEPTED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"];
// Same cap app/api/exam/analyze-reference/route.ts enforces — checked here too so an oversized file never even reaches the network.
const MAX_FILE_BYTES = MAX_UPLOAD_FILE_BYTES;
const ANALYSIS_CLIENT_TIMEOUT_MS = 310_000;
const MIME_BY_EXTENSION: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

/** The file's media type — from its extension when the browser gave none (or a generic one), as some file pickers do. */
function resolveMimeType(file: File): string | null {
  if (ACCEPTED_MIME_TYPES.includes(file.type)) return file.type;
  return MIME_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

interface ReferenceExamUploaderProps {
  styleProfile: ExamStyleProfile | null;
  /** `seal`: issued by the server with the profile (lib/exam-style-seal.ts) — sent back with it so the exam can use its style's shared bank. */
  onStyleProfileChange: (profile: ExamStyleProfile | null, seal?: string | null) => void;
  disabled?: boolean;
}

/**
 * "Examen Guidé par le Style Prof" — optional reference-exam upload in the
 * exam generator's Sources panel. Fully self-contained: owns the file input,
 * drag-and-drop, the upload + POST /api/exam/analyze-reference call, and its
 * own loading/error/success display. The parent
 * (app/dashboard/module/[id]/exam/page.tsx) only holds the final extracted
 * `styleProfile` (via onStyleProfileChange) to thread verbatim into its own
 * POST /api/exam/generate body — this component never talks to that route.
 */
export function ReferenceExamUploader({ styleProfile, onStyleProfileChange, disabled }: ReferenceExamUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Only the latest analysis may update the UI: a cleared or replaced upload
  // must never bring its (late) style profile back into the exam request.
  const analysisIdRef = useRef(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The file of a failed analysis, so "Réessayer" works without picking it again.
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  async function analyzeFile(file: File) {
    setError(null);
    setRetryFile(null);
    const mimeType = resolveMimeType(file);
    if (!mimeType) {
      setError("Format non supporté — dépose un fichier PDF, PNG ou JPG.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(`Fichier trop volumineux (max ${MAX_FILE_BYTES / (1024 * 1024)} Mo).`);
      return;
    }
    // Storage checks the uploaded Content-Type against the bucket's allowed types.
    const upload = file.type === mimeType ? file : new File([file], file.name, { type: mimeType });

    const analysisId = ++analysisIdRef.current;
    const isCurrent = () => analysisIdRef.current === analysisId;
    const fail = (message: string) => {
      if (!isCurrent()) return;
      setError(message);
      setRetryFile(file);
      setFileName(null);
    };

    setFileName(file.name);
    setIsAnalyzing(true);
    onStyleProfileChange(null);
    try {
      // Straight to Storage first — a Route Handler body is capped at ~4.5 MB,
      // below the 10 MB upload limit — then only the path goes to the analysis.
      let path: string;
      try {
        ({ path } = await uploadFileToSignedStorage("/api/exam/analyze-reference/sign", { mimeType }, upload));
      } catch (err) {
        fail(err instanceof Error ? err.message : "L'envoi du fichier a échoué. Réessaie.");
        return;
      }
      // Heartbeat-streamed route (see app/api/exam/analyze-reference) — a scanned
      // PDF can take a minute or two to read; the timeout sits just above its maxDuration.
      const outcome = await postJsonWithHeartbeat("/api/exam/analyze-reference", { path, fileName: file.name, mimeType }, ANALYSIS_CLIENT_TIMEOUT_MS);
      if (!isCurrent()) return;
      if (!outcome.ok || !outcome.data.styleProfile) {
        const serverError = typeof outcome.data.error === "string" ? outcome.data.error : null;
        fail(serverError ?? (outcome.status === 0 ? `L'analyse du style a été interrompue (${outcome.diagnostic}). Réessaie.` : "L'analyse du style a échoué. Réessaie."));
        return;
      }
      onStyleProfileChange(outcome.data.styleProfile as ExamStyleProfile, typeof outcome.data.styleProfileSeal === "string" ? outcome.data.styleProfileSeal : null);
    } catch {
      fail("L'analyse du style a échoué (problème réseau). Réessaie.");
    } finally {
      if (isCurrent()) setIsAnalyzing(false);
    }
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) void analyzeFile(file);
  }

  function handleClear() {
    analysisIdRef.current++;
    setFileName(null);
    setError(null);
    setRetryFile(null);
    setIsAnalyzing(false);
    onStyleProfileChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const hasContent = fileName !== null;

  return (
    <div className="border-b border-white/40 p-4 dark:border-white/10">
      <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">Style de l&apos;examen (optionnel)</h3>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Optionnel : Dépose un ancien examen ou une correction type de ton prof pour que l&apos;IA clone exactement son style, sa logique de pièges et sa
        formulation de QCM
      </p>

      {!hasContent ? (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            "mt-3 flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-4 text-center transition-colors",
            isDragOver
              ? "border-primary-400 bg-primary-50/60 dark:bg-primary-950/30"
              : "border-gray-200/70 hover:bg-white/50 dark:border-neutral-700/70 dark:hover:bg-neutral-800/50",
            disabled && "pointer-events-none opacity-50"
          )}
        >
          <FileUp className="h-5 w-5 text-gray-400 dark:text-gray-500" />
          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Glisse un fichier ou clique pour parcourir</span>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">PDF, PNG ou JPG — max 10 Mo</span>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS.join(",")}
            disabled={disabled}
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      ) : (
        <div className="mt-3 rounded-xl border border-gray-200/70 bg-white/50 p-3 dark:border-neutral-700/70 dark:bg-neutral-800/50">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">{fileName}</span>
            <button
              type="button"
              onClick={handleClear}
              aria-label="Retirer le fichier"
              className="shrink-0 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-neutral-700 dark:hover:text-gray-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {isAnalyzing ? (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
              <span>
                Analyse du style en cours...
                <span className="block text-[11px] text-gray-400 dark:text-gray-500">Jusqu&apos;à 1 à 2 minutes pour un document scanné.</span>
              </span>
            </div>
          ) : styleProfile ? (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-primary-50 px-2 py-1.5 text-xs text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Style détecté : {styleProfile.summary}</span>
            </div>
          ) : null}
        </div>
      )}

      {error && (
        <div className="mt-2 flex items-start justify-between gap-2">
          <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          {retryFile && (
            <button
              type="button"
              onClick={() => void analyzeFile(retryFile)}
              disabled={disabled}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gray-200/70 px-2 py-0.5 text-[11px] font-medium text-gray-600 transition-colors hover:bg-white/60 disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-700/70 dark:text-gray-300 dark:hover:bg-neutral-800/60"
            >
              <RotateCcw className="h-3 w-3" />
              Réessayer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
