"use client";

/**
 * Dashboard "Audio to Smart Notes" — upload a lecture recording (m4a/mp3/wav/
 * ogg, any real length), get back structured Smart Notes in French. A real
 * recording (50-300+ Mo) exceeds OpenRouter's confirmed hard 50 MiB
 * request-body ceiling in one shot (see lib/ai/openrouter.ts's own comment),
 * so this component decodes the file IN THE BROWSER and splits it into small
 * chunks (lib/audio/browser-chunking.ts) before ever sending anything over
 * the network — each chunk is transcribed individually
 * (app/api/lecture-notes/transcribe-chunk), and the joined full transcript
 * is sent once to app/api/lecture-notes/process for the final Smart Notes
 * extraction. Self-contained: drop this anywhere in the Dashboard. No
 * history list here — one recording in, one set of Smart Notes out, matching
 * exactly what was asked; a past-runs view (backed by lecture_notes_jobs,
 * already persisted) is a natural follow-up, not built here.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Maximize2, Mic, RotateCcw, UploadCloud } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { DARK_MARKDOWN_COMPONENTS, DARK_PROSE_CLASSES, MARKDOWN_COMPONENTS, PROSE_CLASSES } from "@/lib/markdown";
import { LectureNotesGeneratingLabel } from "@/components/dashboard/LectureNotesGeneratingLabel";
import { decodeAndChunkAudioFile } from "@/lib/audio/browser-chunking";
import { cn } from "@/lib/utils";

const ACCEPTED_EXTENSIONS = ".m4a,.mp3,.wav,.ogg,audio/mp4,audio/x-m4a,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg";

type Status = "idle" | "processing" | "done" | "error";

export function LectureNotesUploader() {
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [smartNotes, setSmartNotes] = useState<string | null>(null);
  const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number } | null>(null);

  function reset() {
    setStatus("idle");
    setFileName(null);
    setSmartNotes(null);
    setChunkProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFileSelected(file: File) {
    setStatus("processing");
    setFileName(file.name);
    setChunkProgress(null);

    try {
      // Decode + split happens entirely client-side (browser's own codecs,
      // no server involved yet) — see lib/audio/browser-chunking.ts.
      const chunks = await decodeAndChunkAudioFile(file);
      const uploadId = crypto.randomUUID();

      const transcriptParts: string[] = [];
      const audioUrls: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        setChunkProgress({ current: i + 1, total: chunks.length });

        const formData = new FormData();
        formData.append("file", chunks[i], `chunk-${i}.wav`);
        formData.append("uploadId", uploadId);
        formData.append("chunkIndex", String(i));

        const res = await fetch("/api/lecture-notes/transcribe-chunk", { method: "POST", body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data?.error ?? `Échec de la transcription du segment ${i + 1}/${chunks.length}.`);
        }
        transcriptParts.push(data.text);
        audioUrls.push(data.audioUrl);
      }

      setChunkProgress(null);

      const res = await fetch("/api/lecture-notes/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: file.name, transcript: transcriptParts.join(" "), audioUrls }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error ?? "L'extraction des Smart Notes a échoué.");
      }

      setSmartNotes(data.smartNotes);
      setStatus("done");
    } catch (error) {
      setStatus("error");
      setChunkProgress(null);
      toast({
        variant: "error",
        title: "Échec du traitement",
        description: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileSelected(file);
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400">
          <Mic className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">Audio to Smart Notes</h3>
          <p className="text-xs text-muted-foreground">
            Enregistre ton cours magistral (M4A/MP3/WAV/OGG) — l'IA filtre le bruit et en sort des notes structurées.
          </p>
        </div>
        <Link
          href="/dashboard/audio-workspace"
          className="flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-300 hover:bg-accent hover:text-foreground"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Plein écran
        </Link>
      </div>

      <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTENSIONS} onChange={onInputChange} className="hidden" />

      {status === "idle" && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-10 text-sm font-medium text-muted-foreground transition-all duration-300 hover:border-primary-400 hover:bg-accent hover:text-foreground"
        >
          <UploadCloud className="h-6 w-6" />
          Choisir un enregistrement
        </button>
      )}

      {status === "processing" && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600 dark:text-primary-400" />
          <LectureNotesGeneratingLabel className="text-sm font-medium text-foreground" progress={chunkProgress ?? undefined} />
          {fileName && <p className="max-w-xs truncate text-xs text-muted-foreground">{fileName}</p>}
        </div>
      )}

      {status === "error" && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-red-300 py-10 text-sm font-medium text-red-600 transition-all duration-300 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/20"
        >
          <UploadCloud className="h-6 w-6" />
          Réessayer avec un autre fichier
        </button>
      )}

      {status === "done" && smartNotes && (
        <div className="animate-fade-in flex flex-col gap-4">
          <article dir="auto" className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "max-w-none")}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}>
              {smartNotes}
            </ReactMarkdown>
          </article>

          <button
            type="button"
            onClick={reset}
            className="inline-flex w-fit items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary-500 hover:shadow-glow dark:bg-primary-500 dark:hover:bg-primary-400"
          >
            <RotateCcw className="h-4 w-4" />
            Traiter un autre cours
          </button>
        </div>
      )}
    </div>
  );
}
