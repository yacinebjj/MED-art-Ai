"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExamStyleProfile } from "@/lib/ai/exam-schemas";

const ACCEPTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg"];
const ACCEPTED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"];
// Kept in sync with app/api/exam/analyze-reference/route.ts's own MAX_FILE_BYTES — checked here too so an oversized file never even reaches the network.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface ReferenceExamUploaderProps {
  styleProfile: ExamStyleProfile | null;
  onStyleProfileChange: (profile: ExamStyleProfile | null) => void;
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
  const [fileName, setFileName] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  async function analyzeFile(file: File) {
    setError(null);
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      setError("Format non supporté — dépose un fichier PDF, PNG ou JPG.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(`Fichier trop volumineux (max ${MAX_FILE_BYTES / (1024 * 1024)} Mo).`);
      return;
    }

    setFileName(file.name);
    setIsAnalyzing(true);
    onStyleProfileChange(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/exam/analyze-reference", { method: "POST", body: formData });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error ?? "L'analyse du style a échoué. Réessaie.");
        setFileName(null);
        return;
      }
      onStyleProfileChange(body.styleProfile as ExamStyleProfile);
    } catch {
      setError("L'analyse du style a échoué (problème réseau). Réessaie.");
      setFileName(null);
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) void analyzeFile(file);
  }

  function handleClear() {
    setFileName(null);
    setError(null);
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
            <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analyse du style en cours...
            </div>
          ) : styleProfile ? (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-primary-50 px-2 py-1.5 text-xs text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Style détecté : {styleProfile.summary}</span>
            </div>
          ) : null}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{error}</p>}
    </div>
  );
}
