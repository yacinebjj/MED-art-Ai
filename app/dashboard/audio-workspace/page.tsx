"use client";

/**
 * "Audio to Smart Notes" Workspace — a dedicated, full-viewport split-screen
 * page (left: sources/upload, right: results/save), distinct from the
 * compact Dashboard-home card (components/dashboard/LectureNotesUploader.tsx,
 * still there for a quick one-shot upload without leaving the home screen).
 * This page adds the pieces that only make sense in a dedicated workspace:
 * an explicit "Générer par l'IA" trigger (upload and generation are two
 * separate steps here, not one), and a real "Sauvegarder" action.
 *
 * Same underlying pipeline as LectureNotesUploader (decode+chunk client-side
 * — lib/audio/browser-chunking.ts — then transcribe each chunk, then
 * extract) — see that component's own header comment for WHY: a real
 * recording exceeds OpenRouter's confirmed 50 MiB request-body ceiling in
 * one shot, so nothing here ever sends the raw file to our own backend
 * directly.
 */

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, CheckCircle2, FileAudio, Loader2, Mic, Save, Sparkles, Square, UploadCloud, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { DARK_MARKDOWN_COMPONENTS, DARK_PROSE_CLASSES, MARKDOWN_COMPONENTS, PROSE_CLASSES } from "@/lib/markdown";
import { LectureNotesGeneratingLabel } from "@/components/dashboard/LectureNotesGeneratingLabel";
import { decodeAndChunkAudioFile } from "@/lib/audio/browser-chunking";
import { cn } from "@/lib/utils";

const ACCEPTED_EXTENSIONS = ".m4a,.mp3,.wav,.ogg,audio/mp4,audio/x-m4a,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg";

type Status = "idle" | "staged" | "processing" | "done" | "error";

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function AudioWorkspacePage() {
  const router = useRouter();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number } | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [smartNotes, setSmartNotes] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);

  function stageFile(selected: File) {
    setFile(selected);
    setTitle(selected.name);
    setStatus("staged");
    setSmartNotes(null);
    setJobId(null);
    setIsSaved(false);
  }

  function clearFile() {
    setFile(null);
    setStatus("idle");
    setSmartNotes(null);
    setJobId(null);
    setIsSaved(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    // Defensive cleanup — recordingStreamRef should already be null by the
    // time a file is staged (onstop clears it), but a stray open mic stream
    // must never survive past this point regardless.
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) stageFile(selected);
  }

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) stageFile(dropped);
  }, []);

  /**
   * Records straight from the mic (getUserMedia + MediaRecorder) so a student
   * can capture a live lecture without a separate voice-memo app. The
   * resulting Blob (typically audio/webm — already a supported format end to
   * end, see lib/audio/browser-chunking.ts/lib/ai/openrouter.ts's
   * TranscriptionFormat) is wrapped into a plain File and fed through the
   * EXACT SAME stageFile()/handleGenerate() pipeline as an uploaded file —
   * no separate backend path needed for this input method.
   */
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      recordedChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const extension = (recorder.mimeType || "audio/webm").includes("ogg") ? "ogg" : "webm";
        const recordedFile = new File([blob], `enregistrement-${Date.now()}.${extension}`, { type: blob.type });
        stageFile(recordedFile);
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
      };

      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch (error) {
      toast({
        variant: "error",
        title: "Micro inaccessible",
        description: error instanceof Error ? error.message : "Autorise l'accès au micro pour enregistrer directement.",
      });
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  async function handleGenerate() {
    if (!file) return;
    setStatus("processing");
    setChunkProgress(null);

    try {
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
        body: JSON.stringify({ title, transcript: transcriptParts.join(" "), audioUrls }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error ?? "L'extraction des Smart Notes a échoué.");
      }

      setJobId(data.jobId);
      setSmartNotes(data.smartNotes);
      setStatus("done");
    } catch (error) {
      setStatus("staged"); // Back to "staged", not "error" — the file is still there, ready to retry.
      setChunkProgress(null);
      toast({
        variant: "error",
        title: "Échec du traitement",
        description: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    }
  }

  async function handleSave() {
    if (jobId === null) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/lecture-notes/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error ?? "La sauvegarde a échoué.");
      }
      setIsSaved(true);
      toast({ variant: "success", title: "Enregistré", description: "Tes Smart Notes sont dans tes révisions." });
    } catch (error) {
      toast({
        variant: "error",
        title: "Échec de la sauvegarde",
        description: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  const isBusy = status === "processing";

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-all duration-300 hover:bg-accent hover:text-foreground"
          aria-label="Retour au Dashboard"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </button>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 shadow-sm dark:bg-orange-950/40 dark:text-orange-400">
          <FileAudio className="h-4.5 w-4.5" />
        </div>
        <div>
          <h1 className="text-base font-bold tracking-tight text-foreground">Audio to Smart Notes</h1>
          <p className="text-xs text-muted-foreground">Transforme un enregistrement de cours en notes structurées.</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* -------- Left panel: Sources -------- */}
        <section className="flex min-h-0 w-full flex-col gap-4 overflow-y-auto border-b border-border p-6 md:w-1/2 md:border-b-0 md:border-r">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Sources</h2>

          <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTENSIONS} onChange={onInputChange} className="hidden" />

          {isRecording ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-red-300 bg-red-50/50 p-10 text-center dark:border-red-900/50 dark:bg-red-950/20">
              <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-600 shadow-sm dark:bg-red-950/40 dark:text-red-400">
                <span className="absolute inset-0 animate-ping rounded-2xl bg-red-400/40" />
                <Mic className="relative h-7 w-7" />
              </span>
              <p className="text-sm font-semibold text-foreground">Enregistrement en cours...</p>
              <p className="font-mono text-2xl font-bold text-red-600 dark:text-red-400">{formatDuration(recordingSeconds)}</p>
              <button
                type="button"
                onClick={stopRecording}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-red-500 hover:shadow-md"
              >
                <Square className="h-4 w-4" />
                Arrêter et transcrire
              </button>
            </div>
          ) : !file ? (
            <div className="flex flex-1 flex-col gap-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-300",
                  isDragOver
                    ? "border-primary-400 bg-primary-50/50 dark:bg-primary-950/20"
                    : "border-border hover:border-primary-400 hover:bg-accent"
                )}
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 shadow-sm dark:bg-orange-950/40 dark:text-orange-400">
                  <UploadCloud className="h-7 w-7" />
                </span>
                <p className="text-sm font-semibold text-foreground">Glisse-dépose ton enregistrement ici</p>
                <p className="text-xs text-muted-foreground">ou clique pour choisir un fichier — M4A, MP3, WAV, OGG</p>
              </div>

              <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                ou
                <span className="h-px flex-1 bg-border" />
              </div>

              <button
                type="button"
                onClick={startRecording}
                className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-4 text-sm font-semibold text-foreground shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-red-300 hover:bg-red-50/50 hover:shadow-md dark:hover:border-red-900/50 dark:hover:bg-red-950/20"
              >
                <Mic className="h-4 w-4 text-red-600 dark:text-red-400" />
                Enregistrer le prof en direct
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400">
                  <FileAudio className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                </div>
                {!isBusy && (
                  <button
                    type="button"
                    onClick={clearFile}
                    aria-label="Retirer le fichier"
                    className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-all duration-300 hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {isBusy && (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-border p-8 text-center shadow-sm">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-600 dark:text-primary-400" />
                  <LectureNotesGeneratingLabel className="text-sm font-medium text-foreground" progress={chunkProgress ?? undefined} />
                </div>
              )}

              {status === "staged" && !isBusy && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-fit text-xs font-medium text-primary-600 underline-offset-2 hover:underline dark:text-primary-400"
                >
                  Choisir un autre fichier
                </button>
              )}
            </div>
          )}
        </section>

        {/* -------- Right panel: Résultats -------- */}
        <section className="flex min-h-0 w-full flex-col gap-4 overflow-y-auto p-6 md:w-1/2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Résultats</h2>

          {status !== "done" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border p-10 text-center">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!file || isBusy}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary-600 px-8 py-4 text-base font-bold text-white shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary-500 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 dark:bg-primary-500 dark:hover:bg-primary-400"
              >
                {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                Générer par l&apos;IA
              </button>
              {!file && <p className="text-xs text-muted-foreground">Choisis d&apos;abord un enregistrement à gauche.</p>}
            </div>
          ) : (
            <div className="animate-fade-in flex flex-1 flex-col gap-4">
              <article
                dir="auto"
                className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "max-w-none rounded-2xl border border-border bg-card p-6 shadow-sm")}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}>
                  {smartNotes ?? ""}
                </ReactMarkdown>
              </article>

              <div className="mt-auto flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
                <label className="text-xs font-semibold text-muted-foreground">Titre de la note</label>
                <input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setIsSaved(false);
                  }}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary-400"
                />
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || isSaved}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary-500 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70 dark:bg-primary-500 dark:hover:bg-primary-400"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isSaved ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {isSaved ? "Enregistré dans tes révisions" : "Sauvegarder"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
