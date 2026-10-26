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
    // A compact one-row card (it used to be a heading, a paragraph and a tall
    // dropzone): the whole row is the drop target and the file picker; the
    // full explanation is its tooltip.
    <div className="border-b border-white/40 px-3 py-2.5 dark:border-white/10">
      {!hasContent ? (
        <label
          title="Dépose un ancien examen ou une correction type de ton prof : l'IA reprend son style, sa logique de pièges et sa formulation de QCM."
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
            "flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed px-3 py-2.5 transition-colors",
            isDragOver
              ? "border-primary-400 bg-primary-50/60 dark:bg-primary-950/30"
              : "border-gray-200/70 hover:bg-white/50 dark:border-neutral-700/70 dark:hover:bg-neutral-800/50",
            disabled && "pointer-events-none opacity-50"
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400">
            <FileUp className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold text-foreground">Style de l&apos;examen</span>
            <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">Optionnel · ancien examen du prof (PDF, PNG ou JPG, 10 Mo max)</span>
          </span>
          <span className="shrink-0 rounded-full border border-gray-200/70 px-2.5 py-1 text-[11px] font-semibold text-foreground dark:border-neutral-700/70">Importer</span>
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
        <div className="flex items-center gap-3 rounded-2xl border border-gray-200/70 bg-white/50 px-3 py-2.5 dark:border-neutral-700/70 dark:bg-neutral-800/50">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
              styleProfile && !isAnalyzing ? "bg-primary-500/15 text-primary-600 dark:text-primary-300" : "bg-gray-500/10 text-muted-foreground"
            )}
          >
            {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : styleProfile ? <CheckCircle2 className="h-4 w-4" /> : <FileUp className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold text-foreground">{fileName}</span>
            {isAnalyzing ? (
              <span className="block truncate text-[11px] text-muted-foreground">Analyse du style… jusqu&apos;à 1 à 2 min pour un scan</span>
            ) : styleProfile ? (
              <span className="line-clamp-2 text-[11px] text-primary-700 dark:text-primary-300">Style détecté : {styleProfile.summary}</span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={handleClear}
            aria-label="Retirer le fichier"
            className="touch-target relative shrink-0 rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-neutral-700 dark:hover:text-gray-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
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
