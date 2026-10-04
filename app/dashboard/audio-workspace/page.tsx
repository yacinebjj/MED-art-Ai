"use client";

/**
 * "Audio to Smart Notes" Studio — dual-panel workspace.
 *
 * Left: sources (drop zone, live recording HUD with dB meter, the lecture
 * player with waveform/speeds/scrub/boost, and the live pipeline progress).
 * Right: a tabbed output suite built from ONE generation — structured
 * résumé, verbatim transcript with clickable timestamps and search,
 * flashcards, high-yield exam points, mind map + quick quiz — plus exports.
 *
 * Long lectures (2 h and more) never depend on one long request: see
 * lib/audio/lecture-pipeline.ts (4-minute chunks uploaded straight to
 * Storage, resumable) and app/api/lecture-notes/process (background job +
 * polling). `?jobId=` reopens a saved note in the same workspace.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  AudioLines,
  BookOpenText,
  Brain,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  FileAudio,
  FileDown,
  FileText,
  History,
  Layers,
  Loader2,
  Mic,
  Network,
  NotebookPen,
  RefreshCw,
  Save,
  Sparkles,
  Target,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import { MedicalMarkdown } from "@/components/reader/MedicalMarkdown";
import { LectureQuizPanel } from "@/components/dashboard/LectureQuizPanel";
import { StudioAudioPlayer, type PlayerSource, type StudioAudioPlayerHandle } from "@/components/audio-studio/StudioAudioPlayer";
import { RecorderHud } from "@/components/audio-studio/RecorderHud";
import { TranscriptPanel } from "@/components/audio-studio/TranscriptPanel";
import { FlashcardsView, HighYieldView, KitGate, MindmapView, useStudyKit } from "@/components/audio-studio/StudyKitViews";
import { copyText, downloadText, printElementAsPdf, safeFileName } from "@/components/audio-studio/exports";
import {
  LecturePipelineError,
  StaleJobError,
  checkpointedChunkCount,
  clearLectureCheckpoint,
  startNotesJob,
  transcribeLecture,
  waitForNotes,
  type PipelineProgress,
} from "@/lib/audio/lecture-pipeline";
import { formatClock, stripTimestamps } from "@/lib/lecture-transcript";
import { formatRelativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

const ACCEPTED = ".mp3,.wav,.m4a,.ogg,.oga,.webm,.flac,.aac,.mp4,audio/*";
const FORMAT_BADGES = ["MP3", "WAV", "M4A", "OGG", "WEBM", "FLAC"];
/** Above this, decoding a lecture can exhaust a phone browser's memory — warned, not blocked. */
const HEAVY_FILE_BYTES = 400 * 1024 * 1024;

type TabId = "resume" | "transcript" | "flashcards" | "highyield" | "mindmap";

const TABS: { id: TabId; label: string; short: string; icon: typeof FileText; tint: string }[] = [
  { id: "resume", label: "Résumé structuré", short: "Résumé", icon: BookOpenText, tint: "text-emerald-500" },
  { id: "transcript", label: "Transcription", short: "Verbatim", icon: AudioLines, tint: "text-rose-500" },
  { id: "flashcards", label: "Flashcards", short: "Cartes", icon: Layers, tint: "text-amber-500" },
  { id: "highyield", label: "Points clés", short: "High-Yield", icon: Target, tint: "text-red-500" },
  { id: "mindmap", label: "Mindmap & Quiz", short: "Mindmap", icon: Network, tint: "text-violet-500" },
];

const STEPS: { stage: PipelineProgress["stage"] | "done"; label: string }[] = [
  { stage: "decoding", label: "Compression" },
  { stage: "transcribing", label: "Transcription" },
  { stage: "analyzing", label: "Smart Notes" },
  { stage: "done", label: "Prêt" },
];

interface SavedJobSummary {
  id: number;
  title: string;
  status: "processing" | "done" | "failed";
  updatedAt: string;
}

interface JobDetail {
  id: number;
  title: string;
  audioUrls: string[];
  transcript: string | null;
  smartNotes: string | null;
  status: "processing" | "done" | "failed";
}

type Phase = "idle" | "staged" | "running" | "done";

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024 ? `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go` : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m));
}

function PipelineProgressCard({ progress, phase, onCancel }: { progress: PipelineProgress | null; phase: Phase; onCancel: () => void }) {
  const stageIndex = phase === "done" ? 3 : progress ? STEPS.findIndex((s) => s.stage === progress.stage) : 0;
  const ratio = phase === "done" ? 1 : progress?.ratio ?? 0;
  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-soft">
      <div className="mb-3 grid grid-cols-4 gap-1.5">
        {STEPS.map((step, i) => (
          <div key={step.stage} className="flex flex-col items-center gap-1.5 text-center">
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black transition-colors",
                i < stageIndex ? "bg-emerald-500 text-white" : i === stageIndex ? "bg-rose-500 text-white shadow-[0_0_16px_rgba(244,63,94,0.6)]" : "bg-muted text-muted-foreground"
              )}
            >
              {i < stageIndex ? <CheckCircle2 className="h-4 w-4" /> : i === stageIndex && phase === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : i + 1}
            </span>
            <span className={cn("text-[10px] font-bold uppercase tracking-wide", i <= stageIndex ? "text-foreground" : "text-muted-foreground")}>{step.label}</span>
          </div>
        ))}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <motion.div className="h-full rounded-full bg-gradient-to-r from-rose-500 via-orange-400 to-amber-300" animate={{ width: `${Math.round(ratio * 100)}%` }} transition={{ ease: "easeOut", duration: 0.4 }} />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs font-semibold text-foreground">{phase === "done" ? "Terminé — tes Smart Notes sont prêtes." : progress?.label ?? "Préparation…"}</p>
        {phase === "running" && progress?.stage !== "analyzing" && (
          <button type="button" onClick={onCancel} className="shrink-0 text-xs font-bold text-muted-foreground hover:text-destructive">
            Annuler
          </button>
        )}
      </div>
      {phase === "running" && progress?.stage === "analyzing" && (
        <p className="mt-1 text-[11px] text-muted-foreground">L&apos;analyse tourne sur le serveur : tu peux verrouiller ton téléphone ou quitter la page, la note t&apos;attendra dans « Notes récentes ».</p>
      )}
    </div>
  );
}

function AudioWorkspaceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewJobId = searchParams.get("jobId");
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<StudioAudioPlayerHandle>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [recentJobs, setRecentJobs] = useState<SavedJobSummary[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [savedAudioUrls, setSavedAudioUrls] = useState<string[] | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [failure, setFailure] = useState<{ message: string; resumable: boolean; staleJobId?: number } | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [smartNotes, setSmartNotes] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [savedTitle, setSavedTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [tab, setTab] = useState<TabId>("resume");
  const [currentTime, setCurrentTime] = useState(0);
  const [loadingJob, setLoadingJob] = useState(false);

  // Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordPaused, setRecordPaused] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const kit = useStudyKit(smartNotes);

  const refreshRecentJobs = useCallback(() => {
    fetch("/api/lecture-notes")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.success) setRecentJobs(body.jobs as SavedJobSummary[]);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshRecentJobs();
  }, [refreshRecentJobs]);

  // Leaving mid-recording or mid-upload would lose work: ask first.
  useEffect(() => {
    if (!isRecording && !(phase === "running" && progress?.stage !== "analyzing")) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isRecording, phase, progress?.stage]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const pollJob = useCallback(
    async (id: number) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase("running");
      setFailure(null);
      setProgress({ stage: "analyzing", ratio: 0.93, label: "Génération des Smart Notes médicales…" });
      try {
        const notes = await waitForNotes(id, {
          signal: controller.signal,
          onTick: (elapsed) => setProgress({ stage: "analyzing", ratio: Math.min(0.99, 0.93 + elapsed / 4_000_000), label: `Génération des Smart Notes médicales… ${formatClock(elapsed / 1000)}` }),
        });
        setSmartNotes(notes);
        setPhase("done");
        setTab("resume");
        refreshRecentJobs();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhase("staged");
        setFailure({
          message: error instanceof Error ? error.message : "L'analyse a échoué.",
          resumable: true,
          staleJobId: id,
        });
      }
    },
    [refreshRecentJobs]
  );

  // ── Reopen a saved note (?jobId=) ────────────────────────────────────
  useEffect(() => {
    if (!viewJobId) return;
    let cancelled = false;
    abortRef.current?.abort();
    setLoadingJob(true);
    setFile(null);
    setPeaks(null);
    setFailure(null);
    fetch(`/api/lecture-notes/${viewJobId}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.success) throw new Error(body?.error ?? "Impossible de charger cette note.");
        if (cancelled) return;
        const job = body.job as JobDetail;
        setJobId(job.id);
        setTitle(job.title);
        setSavedTitle(job.title);
        setSavedAudioUrls(job.audioUrls);
        setTranscript(job.transcript);
        setSmartNotes(job.smartNotes);
        setTab(job.smartNotes ? "resume" : "transcript");
        if (job.status === "done" && job.smartNotes) setPhase("done");
        else if (job.status === "processing") void pollJob(job.id);
        else {
          setPhase("staged");
          setFailure({ message: "L'analyse de cette note avait échoué. Relance-la : la transcription est sauvegardée.", resumable: true, staleJobId: job.id });
        }
      })
      .catch((error) => {
        if (!cancelled) toast({ variant: "error", title: "Note introuvable", description: error instanceof Error ? error.message : undefined });
      })
      .finally(() => {
        if (!cancelled) setLoadingJob(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewJobId, pollJob, toast]);

  function resetOutputs() {
    setJobId(null);
    setTranscript(null);
    setSmartNotes(null);
    setFailure(null);
    setProgress(null);
    setSavedAudioUrls(null);
    setTab("resume");
  }

  function stageFile(selected: File) {
    if (viewJobId) router.replace("/dashboard/audio-workspace");
    resetOutputs();
    setFile(selected);
    setPeaks(null);
    setDurationSec(null);
    const base = selected.name.replace(/\.[^.]+$/, "");
    setTitle(base);
    setSavedTitle(base);
    setPhase("staged");
    if (selected.size > HEAVY_FILE_BYTES) {
      toast({ variant: "info", title: "Fichier très volumineux", description: "Le décodage peut être lent sur un téléphone. Sur ordinateur, aucun souci." });
    }
  }

  function clearFile() {
    abortRef.current?.abort();
    setFile(null);
    setPeaks(null);
    setDurationSec(null);
    resetOutputs();
    setPhase("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer.files ?? []).find((f) => f.type.startsWith("audio/") || /\.(mp3|wav|m4a|ogg|oga|webm|flac|aac|mp4)$/i.test(f.name));
    if (dropped) stageFile(dropped);
    else toast({ variant: "error", title: "Format non reconnu", description: "Dépose un fichier audio : MP3, WAV, M4A, OGG, WEBM ou FLAC." });
  }

  // ── Live recording ───────────────────────────────────────────────────
  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        setWakeLockActive(true);
        wakeLockRef.current.addEventListener("release", () => setWakeLockActive(false));
      }
    } catch {
      setWakeLockActive(false);
    }
  }

  useEffect(() => {
    if (!isRecording) return;
    // The browser drops the wake lock whenever the tab is hidden; take it back on return.
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!wakeLockRef.current || wakeLockRef.current.released)) void acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isRecording]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
      const mimeType = pickRecorderMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const stamp = new Date().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/[/:]/g, "-");
        stageFile(new File(recordedChunksRef.current, `Cours enregistré ${stamp}.${ext}`, { type }));
        stream.getTracks().forEach((t) => t.stop());
        setLiveStream(null);
      };
      // 1-second slices: a crash or a dead battery keeps everything recorded so far in memory.
      recorder.start(1000);
      recorderRef.current = recorder;
      setLiveStream(stream);
      setIsRecording(true);
      setRecordPaused(false);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => {
        if (recorderRef.current?.state === "recording") setRecordSeconds((s) => s + 1);
      }, 1000);
      void acquireWakeLock();
    } catch (error) {
      toast({ variant: "error", title: "Micro inaccessible", description: error instanceof Error ? error.message : "Autorise l'accès au micro pour enregistrer." });
    }
  }

  function togglePauseRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      setRecordPaused(true);
    } else if (recorder.state === "paused") {
      recorder.resume();
      setRecordPaused(false);
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setIsRecording(false);
    setRecordPaused(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    void wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
  }

  // ── Generation ───────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!file) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("running");
    setFailure(null);
    try {
      const result = await transcribeLecture(file, {
        signal: controller.signal,
        onProgress: setProgress,
        onPeaks: (p, d) => {
          setPeaks(p);
          setDurationSec(d);
        },
      });
      setTranscript(result.transcript);
      setProgress({ stage: "analyzing", ratio: 0.93, label: "Génération des Smart Notes médicales…" });
      const job = await startNotesJob({ title: title.trim() || "Cours enregistré", transcript: result.transcript, audioUrls: result.audioUrls });
      clearLectureCheckpoint(file);
      setJobId(job.jobId);
      setSavedTitle(title.trim() || "Cours enregistré");
      refreshRecentJobs();
      await pollJob(job.jobId);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setPhase("staged");
        setProgress(null);
        return;
      }
      setPhase("staged");
      setFailure({
        message: error instanceof Error ? error.message : "Erreur inconnue.",
        resumable: error instanceof LecturePipelineError ? error.resumable : false,
      });
    }
  }

  async function handleRelaunch(id: number) {
    try {
      await startNotesJob({ jobId: id });
      await pollJob(id);
    } catch (error) {
      setFailure({ message: error instanceof Error ? error.message : "Relance impossible.", resumable: true, staleJobId: id });
    }
  }

  async function handleRename() {
    if (jobId === null || !title.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/lecture-notes/${jobId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "La sauvegarde a échoué.");
      setSavedTitle(title.trim());
      refreshRecentJobs();
      toast({ variant: "success", title: "Titre enregistré" });
    } catch (error) {
      toast({ variant: "error", title: "Échec de la sauvegarde", description: error instanceof Error ? error.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }

  const displayTitle = savedTitle || title || "Cours enregistré";

  async function pushToNotes(markdown: string, label: string) {
    try {
      const res = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `${displayTitle} — ${label}`, content: markdown }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) throw new Error(data?.error ?? "Envoi impossible.");
      toast({ variant: "success", title: "Ajouté à Mes Notes", description: `${label} · ${displayTitle}` });
    } catch (error) {
      toast({ variant: "error", title: "Échec de l'envoi vers Mes Notes", description: error instanceof Error ? error.message : undefined });
    }
  }

  function fullMarkdown(withTranscript: boolean): string {
    const parts = [`# ${displayTitle}`, smartNotes ?? ""];
    if (withTranscript && transcript) parts.push("---", "## Transcription intégrale", transcript);
    return parts.join("\n\n");
  }

  async function handleCopy(kind: "all" | "notion") {
    const ok = await copyText(fullMarkdown(kind === "all"));
    toast(
      ok
        ? { variant: "success", title: kind === "notion" ? "Copié pour Notion" : "Tout est copié", description: kind === "notion" ? "Colle dans une page Notion : titres, listes et tableaux sont convertis automatiquement." : undefined }
        : { variant: "error", title: "Copie refusée par le navigateur" }
    );
  }

  function handlePdf() {
    if (!printRef.current || !printElementAsPdf(printRef.current, displayTitle)) {
      toast({ variant: "error", title: "Fenêtre bloquée", description: "Autorise les pop-ups pour exporter en PDF." });
    }
  }

  const playerSource = useMemo<PlayerSource | null>(() => {
    if (file) return { kind: "file", file };
    if (savedAudioUrls && savedAudioUrls.length > 0) return { kind: "segments", urls: savedAudioUrls };
    return null;
  }, [file, savedAudioUrls]);

  const hasNotes = Boolean(smartNotes);
  const resumableChunks = useMemo(() => (file && phase === "staged" ? checkpointedChunkCount(file) : 0), [file, phase]);
  const busy = phase === "running";

  function renderTab() {
    if (tab === "transcript") {
      return transcript ? (
        <TranscriptPanel transcript={transcript} durationSec={durationSec} currentTime={currentTime} onSeek={(s) => playerRef.current?.seekTo(s)} />
      ) : (
        <EmptyOutput busy={busy} />
      );
    }
    if (!smartNotes) return <EmptyOutput busy={busy} />;
    if (tab === "resume") {
      return (
        <article className="mx-auto max-w-[75ch] text-[16px] [--reader-leading:1.75]">
          <MedicalMarkdown markdown={smartNotes} />
        </article>
      );
    }
    if (!kit.kit) {
      const what = tab === "flashcards" ? "les flashcards" : tab === "highyield" ? "les points clés d'examen" : "la carte mentale";
      return (
        <div className="space-y-6">
          <KitGate loading={kit.loading} error={kit.error} onGenerate={() => void kit.generate()} what={what} />
          {tab === "mindmap" && <LectureQuizPanel smartNotes={smartNotes} />}
        </div>
      );
    }
    if (tab === "flashcards") return <FlashcardsView kit={kit.kit} title={displayTitle} onPushToNotes={(md, label) => void pushToNotes(md, label)} />;
    if (tab === "highyield") return <HighYieldView kit={kit.kit} />;
    return (
      <div className="space-y-8">
        <MindmapView kit={kit.kit} />
        <LectureQuizPanel smartNotes={smartNotes} />
      </div>
    );
  }

  return (
    <div className="aurora-canvas-bg relative flex h-full flex-col overflow-hidden">
      <div aria-hidden className="aurora-mesh-bg animate-mesh-pulse pointer-events-none fixed inset-0 -z-10" />

      <header className="glass-panel relative z-10 flex shrink-0 items-center gap-3 px-4 py-3 shadow-glass sm:px-6 dark:shadow-glass-dark">
        <button
          type="button"
          onClick={() => (viewJobId ? router.push("/dashboard/audio-workspace") : router.push("/dashboard"))}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-95"
          aria-label="Retour"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-fuchsia-600 text-white shadow-[0_8px_22px_-8px_rgba(244,63,94,0.9)]">
          <FileAudio className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-black tracking-tight text-foreground">Audio to Smart Notes</h1>
          <p className="truncate text-xs text-muted-foreground">Cours jusqu&apos;à 2 h et plus · transcription Whisper · notes médicales fidèles</p>
        </div>
        {hasNotes && (
          <span className="hidden items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-700 sm:flex dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Note sauvegardée
          </span>
        )}
      </header>

      <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-1 gap-3 overflow-y-auto p-2 sm:p-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-4 lg:overflow-hidden">
        {/* ────────────── Left: Audio Studio Control Hub ────────────── */}
        <section className="glass-card flex flex-col gap-4 rounded-3xl p-4 shadow-glass max-lg:rounded-2xl sm:p-5 lg:min-h-0 lg:overflow-y-auto dark:shadow-glass-dark">
          <input ref={fileInputRef} type="file" accept={ACCEPTED} onChange={(e) => e.target.files?.[0] && stageFile(e.target.files[0])} className="hidden" />

          {loadingJob ? (
            <div className="flex flex-1 items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
            </div>
          ) : isRecording ? (
            <RecorderHud stream={liveStream} seconds={recordSeconds} paused={recordPaused} wakeLockActive={wakeLockActive} onPauseToggle={togglePauseRecording} onStop={stopRecording} />
          ) : !playerSource ? (
            <>
              <motion.div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                animate={{ scale: isDragOver ? 1.02 : 1 }}
                transition={{ type: "spring", stiffness: 380, damping: 26 }}
                className={cn(
                  "group relative flex cursor-pointer flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                  isDragOver ? "border-rose-400 bg-rose-500/10" : "border-border bg-white/40 hover:border-rose-400/70 dark:bg-white/[0.03]"
                )}
              >
                <div aria-hidden className={cn("pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(244,63,94,0.18),transparent_65%)] transition-opacity", isDragOver ? "opacity-100" : "opacity-0 group-hover:opacity-100")} />
                <motion.span
                  animate={isDragOver ? { y: -6, rotate: -4 } : { y: 0, rotate: 0 }}
                  className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-[0_14px_34px_-12px_rgba(244,63,94,0.9)]"
                >
                  <UploadCloud className="h-8 w-8" />
                </motion.span>
                <div className="relative">
                  <p className="text-base font-black text-foreground">{isDragOver ? "Lâche ton enregistrement ici" : "Glisse-dépose ton cours audio"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">ou clique pour choisir un fichier · cours de 2 h et plus acceptés</p>
                </div>
                <div className="relative flex flex-wrap justify-center gap-1.5">
                  {FORMAT_BADGES.map((f) => (
                    <span key={f} className="rounded-md border border-border bg-card px-2 py-0.5 text-[10px] font-black tracking-wider text-muted-foreground">
                      {f}
                    </span>
                  ))}
                </div>
              </motion.div>

              <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                ou
                <span className="h-px flex-1 bg-border" />
              </div>

              <button
                type="button"
                onClick={() => void startRecording()}
                className="group flex min-h-14 items-center justify-center gap-3 rounded-2xl border border-rose-400/40 bg-gradient-to-r from-rose-500/10 to-fuchsia-500/10 px-4 text-sm font-black text-foreground transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-16px_rgba(244,63,94,0.9)]"
              >
                <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-rose-500 text-white">
                  <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/40 [animation-duration:2.2s]" />
                  <Mic className="relative h-4 w-4" />
                </span>
                Enregistrer le cours en direct
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-300">
                  <FileAudio className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">{file ? file.name : displayTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    {file ? formatBytes(file.size) : `${savedAudioUrls?.length ?? 0} segment(s) sauvegardé(s)`}
                    {durationSec ? ` · ${formatClock(durationSec)}` : ""}
                  </p>
                </div>
                {!busy && (
                  <button type="button" onClick={viewJobId ? () => router.push("/dashboard/audio-workspace") : clearFile} aria-label="Fermer cette source" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <StudioAudioPlayer ref={playerRef} source={playerSource} peaks={peaks} title={displayTitle} onTime={setCurrentTime} onDuration={setDurationSec} />

              {(busy || phase === "done" || progress) && file && <PipelineProgressCard progress={progress} phase={phase} onCancel={() => abortRef.current?.abort()} />}
              {busy && !file && <PipelineProgressCard progress={progress} phase={phase} onCancel={() => abortRef.current?.abort()} />}

              {failure && (
                <div className="flex gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-3">
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{failure.message}</p>
                    {failure.staleJobId !== undefined ? (
                      <button type="button" onClick={() => void handleRelaunch(failure.staleJobId!)} className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-destructive px-3 py-1.5 text-xs font-bold text-white">
                        <RefreshCw className="h-3.5 w-3.5" /> Relancer l&apos;analyse
                      </button>
                    ) : null}
                  </div>
                </div>
              )}

              {file && phase === "staged" && (
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 via-rose-600 to-fuchsia-600 px-6 text-base font-black text-white shadow-[0_16px_40px_-16px_rgba(244,63,94,1)] transition hover:-translate-y-0.5 active:scale-[0.98]"
                >
                  {resumableChunks > 0 ? <RefreshCw className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                  {resumableChunks > 0 ? `Reprendre (${resumableChunks} segment${resumableChunks > 1 ? "s" : ""} déjà transcrit${resumableChunks > 1 ? "s" : ""})` : "Générer les Smart Notes"}
                </button>
              )}
            </>
          )}

          {!isRecording && recentJobs && recentJobs.length > 0 && (
            <div className="mt-auto flex flex-col gap-2 pt-2">
              <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">
                <History className="h-3.5 w-3.5" /> Notes récentes
              </div>
              <ul className="flex flex-col gap-1.5">
                {recentJobs.slice(0, 8).map((recent) => (
                  <li key={recent.id}>
                    <button
                      type="button"
                      onClick={() => router.push(`/dashboard/audio-workspace?jobId=${recent.id}`)}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-soft",
                        String(recent.id) === viewJobId ? "border-rose-400/60 bg-rose-500/10" : "border-border bg-card"
                      )}
                    >
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", recent.status === "done" ? "bg-emerald-500" : recent.status === "processing" ? "animate-pulse bg-amber-400" : "bg-destructive")} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{recent.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(recent.updatedAt, "fr")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ────────────── Right: Multi-output AI suite ────────────── */}
        <section className="glass-card flex min-h-[28rem] flex-col rounded-3xl shadow-glass max-lg:rounded-2xl lg:min-h-0 lg:overflow-hidden dark:shadow-glass-dark">
          <div className="flex shrink-0 flex-col gap-2 border-b border-border p-2 sm:p-3">
            <div role="tablist" aria-label="Sorties IA" className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
              {TABS.map((t) => {
                const Icon = t.icon;
                const enabled = t.id === "transcript" ? Boolean(transcript) : hasNotes;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    disabled={!enabled}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "relative flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab === t.id && <motion.span layoutId="audio-tab-pill" className="absolute inset-0 rounded-xl bg-accent" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                    <Icon className={cn("relative h-4 w-4", t.tint)} />
                    <span className="relative hidden sm:inline">{t.label}</span>
                    <span className="relative sm:hidden">{t.short}</span>
                  </button>
                );
              })}
            </div>

            {hasNotes && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 max-sm:basis-full">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handleRename()}
                    aria-label="Titre de la note"
                    className="h-9 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm font-semibold text-foreground outline-none focus:border-rose-400"
                  />
                  {title.trim() !== savedTitle && jobId !== null && (
                    <button type="button" onClick={() => void handleRename()} disabled={isSaving} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-rose-500 px-3 text-xs font-bold text-white disabled:opacity-60">
                      {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Renommer
                    </button>
                  )}
                </div>
                <button type="button" onClick={() => void pushToNotes(fullMarkdown(false), "Smart Notes")} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-bold text-foreground hover:bg-accent">
                  <NotebookPen className="h-3.5 w-3.5 text-indigo-500" /> Mes Notes
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-foreground px-3 text-xs font-bold text-background hover:opacity-90">
                    <FileDown className="h-3.5 w-3.5" /> Exporter <ChevronDown className="h-3 w-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem onSelect={handlePdf}>
                      <FileText className="h-4 w-4 text-rose-500" /> PDF (mise en page médicale)
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => downloadText(`${safeFileName(displayTitle)}.md`, fullMarkdown(true))}>
                      <FileDown className="h-4 w-4 text-slate-500" /> Markdown (.md + transcription)
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void handleCopy("notion")}>
                      <Brain className="h-4 w-4 text-violet-500" /> Copier pour Notion
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void handleCopy("all")}>
                      <ClipboardCopy className="h-4 w-4 text-emerald-500" /> Copier tout (notes + verbatim)
                    </DropdownMenuItem>
                    {transcript && (
                      <DropdownMenuItem onSelect={() => downloadText(`${safeFileName(displayTitle)} - transcription.txt`, stripTimestamps(transcript), "text/plain;charset=utf-8")}>
                        <AudioLines className="h-4 w-4 text-rose-500" /> Transcription seule (.txt)
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          <div className="p-3 sm:p-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div key={tab + (hasNotes ? "-ready" : "")} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                {renderTab()}
              </motion.div>
            </AnimatePresence>
          </div>
        </section>
      </div>

      {/* Off-screen render of the notes, used as the PDF export source. */}
      {smartNotes && (
        <div aria-hidden className="pointer-events-none fixed -left-[9999px] top-0 w-[760px] opacity-0">
          <div ref={printRef}>
            <MedicalMarkdown markdown={smartNotes} />
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyOutput({ busy }: { busy: boolean }) {
  return (
    <div className="flex flex-col items-center gap-5 px-4 py-16 text-center">
      <span className="relative flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-rose-500/15 to-violet-500/15 text-rose-600 dark:text-rose-300">
        {busy ? <Loader2 className="h-7 w-7 animate-spin" /> : <Sparkles className="h-7 w-7" />}
      </span>
      <div>
        <p className="text-base font-black text-foreground">{busy ? "Ton cours est en cours de traitement" : "Tes sorties IA apparaîtront ici"}</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
          Une seule génération produit : un résumé médical structuré (perles cliniques, algorithmes, posologies exactes), la transcription mot à mot horodatée, des
          flashcards, les points High-Yield d&apos;examen, une carte mentale et un quiz.
        </p>
      </div>
      <div className="grid w-full max-w-md grid-cols-2 gap-2 text-left sm:grid-cols-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <span key={t.id} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground">
              <Icon className={cn("h-4 w-4", t.tint)} />
              {t.short}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function AudioWorkspacePage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center bg-background" />}>
      <AudioWorkspaceContent />
    </Suspense>
  );
}
