"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * getUserMedia rejects with a DOMException whose `.name` is standardized but
 * whose `.message` is not (Firefox's NotFoundError reads "The object can not
 * be found here.") — branching on `.name` gives an actionable French reason.
 * Same mapping as the MedArt Assistant page's own dictation.
 */
export function describeMicError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "Aucun microphone détecté sur cet appareil. Vérifie qu'un micro est branché et sélectionné comme périphérique par défaut.";
      case "NotAllowedError":
      case "PermissionDeniedError":
      case "SecurityError":
        return "Accès au micro refusé. Autorise le micro pour ce site dans les réglages de ton navigateur, puis réessaie.";
      case "NotReadableError":
      case "TrackStartError":
        return "Le micro est déjà utilisé par une autre application. Ferme-la puis réessaie.";
      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        return "Le microphone détecté ne convient pas. Réessaie avec un autre micro si possible.";
      default:
        break;
    }
  }
  return error instanceof Error ? error.message : "Autorise l'accès au micro pour dicter ta question.";
}

export type DictationState = "idle" | "recording" | "transcribing";

interface UseVoiceDictationOptions {
  /** Receives the transcript of each finished clip (already trimmed, never empty). */
  onTranscript: (text: string) => void;
  onError: (title: string, description: string) => void;
}

/**
 * MediaRecorder → /api/assistant/transcribe (server-side Whisper) dictation,
 * the pipeline already proven on the MedArt Assistant composer. One clip per
 * start/stop; the recording stream is always released on stop and unmount.
 */
export function useVoiceDictation({ onTranscript, onError }: UseVoiceDictationOptions) {
  const [state, setState] = useState<DictationState>("idle");
  const [supported, setSupported] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  // Set while the mic permission prompt / getUserMedia is pending — the state
  // is still "idle" then, so without this a second click started a second
  // recorder and orphaned the first stream (microphone left on).
  const startingRef = useRef(false);
  // Latest callbacks without re-creating start/stop on every parent render.
  const callbacksRef = useRef({ onTranscript, onError });
  callbacksRef.current = { onTranscript, onError };

  useEffect(() => {
    mountedRef.current = true;
    setSupported(typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined");
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const transcribe = useCallback(async (blob: Blob) => {
    if (blob.size === 0) {
      if (mountedRef.current) setState("idle");
      return;
    }
    setState("transcribing");
    try {
      const extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : blob.type.includes("wav") ? "wav" : "webm";
      const formData = new FormData();
      formData.append("file", blob, `dictation.${extension}`);
      const res = await fetch("/api/assistant/transcribe", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(typeof data?.error === "string" ? data.error : "La transcription a échoué.");
      const transcript = typeof data.text === "string" ? data.text.trim() : "";
      if (!mountedRef.current) return;
      if (!transcript) {
        callbacksRef.current.onError("Rien entendu", "Aucune parole détectée dans l'enregistrement — réessaie en parlant un peu plus fort.");
        return;
      }
      callbacksRef.current.onTranscript(transcript);
    } catch (error) {
      if (mountedRef.current) {
        callbacksRef.current.onError("Transcription impossible", error instanceof Error ? error.message : "La dictée vocale a échoué. Réessaie.");
      }
    } finally {
      if (mountedRef.current) setState("idle");
    }
  }, []);

  const start = useCallback(async () => {
    if (!supported || startingRef.current || recorderRef.current?.state === "recording") return;
    startingRef.current = true;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        // Unmounted while the permission prompt was open — release the mic now.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const activeStream = stream;
      streamRef.current = activeStream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(activeStream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        activeStream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (timerRef.current) clearInterval(timerRef.current);
        void transcribe(blob);
      };
      recorder.start();
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
      setState("recording");
    } catch (error) {
      // e.g. MediaRecorder unsupported for this stream — never leave the mic on.
      stream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (mountedRef.current) {
        setState("idle");
        callbacksRef.current.onError("Micro inaccessible", describeMicError(error));
      }
    } finally {
      startingRef.current = false;
    }
  }, [supported, transcribe]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const toggle = useCallback(() => {
    if (state === "recording") stop();
    else if (state === "idle") void start();
  }, [state, start, stop]);

  return { state, supported, elapsedSeconds, start, stop, toggle };
}
