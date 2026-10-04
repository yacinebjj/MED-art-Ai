"use client";

/**
 * Immersive voice conversation with MedArt Assistant (Siri / Gemini Live
 * style). One turn = listen → transcribe → ask → speak, then it listens again.
 *
 *  - Listening: microphone level drives the orb (Web Audio analyser); the turn
 *    ends by itself after ~1.3 s of silence once speech was detected, or on a
 *    tap / Space.
 *  - Thinking: transcription + the assistant's answer (same conversation as the
 *    chat — every turn also appears in the thread).
 *  - Speaking: the reply is read aloud with the browser's speech synthesis
 *    (French or Arabic voice picked from the reply's script); the orb pulses on
 *    word boundaries.
 * HUD: mute (stop listening between turns), pause/resume speech, switch voice,
 * exit. Everything is released on exit/unmount (mic tracks, audio context,
 * speech queue).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, Mic, MicOff, Pause, Play, Volume2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { playChime } from "@/lib/voice/chime";

type VoiceState = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

const SPEECH_THRESHOLD = 0.045;
const SILENCE_AFTER_SPEECH_MS = 1300;
const MAX_TURN_MS = 45_000;

const STATE_COPY: Record<VoiceState, string> = {
  idle: "En pause — touche l'orbe pour parler",
  listening: "Je t'écoute…",
  transcribing: "Je transcris…",
  thinking: "Je réfléchis…",
  speaking: "Je te réponds…",
};

const STATE_TONES: Record<VoiceState, { core: string; glow: string }> = {
  idle: { core: "from-slate-300 via-slate-500 to-slate-700", glow: "rgba(148,163,184,0.35)" },
  listening: { core: "from-emerald-200 via-cyan-400 to-sky-600", glow: "rgba(34,211,238,0.55)" },
  transcribing: { core: "from-cyan-200 via-sky-400 to-indigo-600", glow: "rgba(56,189,248,0.5)" },
  thinking: { core: "from-fuchsia-300 via-violet-500 to-indigo-700", glow: "rgba(139,92,246,0.6)" },
  speaking: { core: "from-cyan-200 via-blue-500 to-violet-600", glow: "rgba(59,130,246,0.6)" },
};

/** Text that reads well aloud: no markdown, no URLs, no emoji noise. */
function toSpeakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\|/g, ", ")
    .replace(/[*_~>#]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

function isArabicText(text: string): boolean {
  const arabic = text.match(/[؀-ۿ]/g)?.length ?? 0;
  return arabic > text.length * 0.2;
}

/** Splits long replies into sentence chunks (some engines stop on very long utterances). */
function chunkForSpeech(text: string): string[] {
  const sentences = text.match(/[^.!?؟]+[.!?؟]*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > 220 && current) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function VoiceModeOverlay({ open, onClose, onAsk }: { open: boolean; onClose: () => void; onAsk: (text: string) => Promise<string> }) {
  const reduceMotion = useReducedMotion();
  const [state, setState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [caption, setCaption] = useState<{ you: string; assistant: string }>({ you: "", assistant: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceIndex, setVoiceIndex] = useState(0);
  const [mounted, setMounted] = useState(false);

  const orbRef = useRef<HTMLDivElement>(null);
  const levelRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const rafRef = useRef(0);
  const activeRef = useRef(false);
  const mutedRef = useRef(false);
  const stateRef = useRef<VoiceState>("idle");
  const listenRef = useRef<() => void>(() => undefined);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Available synthesis voices (they load asynchronously in most browsers).
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter((v) => /^(fr|ar)/i.test(v.lang)));
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // Orb animation: writes the live level into CSS variables (no re-render per frame).
  useEffect(() => {
    if (!open) return;
    const tick = () => {
      levelRef.current *= 0.9;
      const el = orbRef.current;
      if (el) el.style.setProperty("--level", levelRef.current.toFixed(3));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [open]);

  const releaseMic = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }, []);

  const speak = useCallback(
    (text: string): Promise<void> =>
      new Promise((resolve) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) {
          resolve();
          return;
        }
        const synth = window.speechSynthesis;
        synth.cancel();
        const arabic = isArabicText(text);
        const pool = voices.filter((v) => (arabic ? /^ar/i.test(v.lang) : /^fr/i.test(v.lang)));
        const voice = pool.length > 0 ? pool[voiceIndex % pool.length] : undefined;
        const chunks = chunkForSpeech(text);
        let index = 0;
        const next = () => {
          if (!activeRef.current || index >= chunks.length) {
            resolve();
            return;
          }
          const utterance = new SpeechSynthesisUtterance(chunks[index++]);
          utterance.lang = voice?.lang ?? (arabic ? "ar-DZ" : "fr-FR");
          if (voice) utterance.voice = voice;
          utterance.rate = 0.98;
          utterance.onboundary = () => {
            levelRef.current = Math.min(1, levelRef.current + 0.55);
          };
          utterance.onend = next;
          utterance.onerror = next;
          synth.speak(utterance);
        };
        next();
      }),
    [voices, voiceIndex]
  );

  const finishTurn = useCallback(
    async (blob: Blob) => {
      if (!activeRef.current) return;
      if (blob.size < 2000) {
        setNotice("Je n'ai rien entendu. Réessaie.");
        if (!mutedRef.current) listenRef.current();
        else setState("idle");
        return;
      }
      setState("transcribing");
      try {
        const form = new FormData();
        form.append("file", blob, blob.type.includes("mp4") ? "voice.mp4" : "voice.webm");
        const res = await fetch("/api/assistant/transcribe", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        const text = typeof data?.text === "string" ? data.text.trim() : "";
        if (!res.ok || !text) throw new Error(typeof data?.error === "string" ? data.error : "Je n'ai pas compris. Réessaie.");
        if (!activeRef.current) return;
        setCaption({ you: text, assistant: "" });
        setState("thinking");
        const reply = await onAsk(text);
        if (!activeRef.current) return;
        const speakable = toSpeakable(reply);
        setCaption({ you: text, assistant: speakable });
        setState("speaking");
        await speak(speakable);
        if (!activeRef.current) return;
        if (!mutedRef.current) listenRef.current();
        else setState("idle");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Une erreur est survenue.");
        if (activeRef.current && !mutedRef.current) listenRef.current();
        else setState("idle");
      }
    },
    [onAsk, speak]
  );

  const listen = useCallback(async () => {
    if (!activeRef.current) return;
    releaseMic();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!activeRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioCtx();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        playChime("stop");
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        releaseMic();
        void finishTurn(blob);
      };
      recorder.start();
      playChime("start");
      setNotice(null);
      setState("listening");

      const startedAt = performance.now();
      let heardSpeech = false;
      let lastLoud = performance.now();
      const monitor = () => {
        if (recorderRef.current !== recorder || recorder.state === "inactive") return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        levelRef.current = Math.max(levelRef.current, Math.min(1, rms * 9));
        const now = performance.now();
        if (rms > SPEECH_THRESHOLD) {
          heardSpeech = true;
          lastLoud = now;
        }
        if ((heardSpeech && now - lastLoud > SILENCE_AFTER_SPEECH_MS) || now - startedAt > MAX_TURN_MS) {
          recorder.stop();
          return;
        }
        requestAnimationFrame(monitor);
      };
      requestAnimationFrame(monitor);
    } catch {
      setNotice("Micro inaccessible : autorise l'accès au micro dans ton navigateur.");
      setState("idle");
    }
  }, [finishTurn, releaseMic]);

  useEffect(() => {
    listenRef.current = () => void listen();
  }, [listen]);

  // Open → start listening. Close/unmount → release everything.
  useEffect(() => {
    if (!open) return;
    activeRef.current = true;
    setCaption({ you: "", assistant: "" });
    setNotice(null);
    setPaused(false);
    void listen();
    return () => {
      activeRef.current = false;
      releaseMic();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
      setState("idle");
    };
    // Only on open/close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleOrbTap() {
    const current = stateRef.current;
    if (current === "listening") recorderRef.current?.stop();
    else if (current === "speaking") {
      window.speechSynthesis.cancel();
    } else if (current === "idle") void listen();
  }

  // Keyboard: Space ends your turn / skips the reply, Escape exits (latest handler via ref).
  const orbTapRef = useRef(handleOrbTap);
  orbTapRef.current = handleOrbTap;
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.code === "Space") {
        e.preventDefault();
        orbTapRef.current();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (next && stateRef.current === "listening") {
      if (recorderRef.current) recorderRef.current.onstop = null;
      releaseMic();
      setState("idle");
    } else if (!next && stateRef.current === "idle") void listen();
  }

  function togglePause() {
    if (!("speechSynthesis" in window)) return;
    if (paused) window.speechSynthesis.resume();
    else window.speechSynthesis.pause();
    setPaused(!paused);
  }

  const tone = STATE_TONES[state];
  const voiceLabel = voices.filter((v) => /^fr/i.test(v.lang))[voiceIndex % Math.max(1, voices.filter((v) => /^fr/i.test(v.lang)).length)]?.name;

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Mode vocal MedArt"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9998] flex flex-col items-center justify-between overflow-hidden bg-[#020617] px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] text-white"
        >
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,211,238,0.12),transparent_60%)]" />

          <div className="relative flex w-full max-w-xl items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300/80">Mode vocal · MedArt</p>
            <button type="button" onClick={onClose} aria-label="Quitter le mode vocal" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* 3D neural orb */}
          <button type="button" onClick={handleOrbTap} aria-label={STATE_COPY[state]} className="relative flex h-72 w-72 items-center justify-center [perspective:900px] focus:outline-none sm:h-80 sm:w-80">
            <div ref={orbRef} className="relative flex h-full w-full items-center justify-center" style={{ ["--level" as string]: 0 }}>
              <span
                aria-hidden
                className="absolute inset-6 rounded-full blur-3xl transition-colors duration-700"
                style={{ background: tone.glow, transform: "scale(calc(0.85 + var(--level) * 0.5))" }}
              />
              {(state === "thinking" || state === "transcribing") && !reduceMotion && (
                <>
                  <motion.span aria-hidden className="absolute inset-4 rounded-full border-2 border-violet-400/60" style={{ transformStyle: "preserve-3d" }} animate={{ rotateX: [65, 65], rotateZ: [0, 360] }} transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }} />
                  <motion.span aria-hidden className="absolute inset-10 rounded-full border-2 border-cyan-300/50" style={{ transformStyle: "preserve-3d" }} animate={{ rotateY: [70, 70], rotateZ: [360, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }} />
                </>
              )}
              {state === "speaking" && !reduceMotion && (
                <span aria-hidden className="absolute inset-8 rounded-full border border-sky-300/40" style={{ transform: "scale(calc(1 + var(--level) * 0.25))", transition: "transform 80ms linear" }} />
              )}
              <motion.span
                aria-hidden
                className={cn("relative h-40 w-40 rounded-full bg-gradient-to-br shadow-[inset_-18px_-22px_40px_rgba(2,6,23,0.55),inset_14px_16px_30px_rgba(255,255,255,0.35)] sm:h-44 sm:w-44", tone.core)}
                style={{ transform: "scale(calc(1 + var(--level) * 0.28))", transition: "transform 70ms linear" }}
                animate={reduceMotion || state === "listening" || state === "speaking" ? undefined : { scale: [1, 1.04, 1] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              >
                <span className="absolute left-[22%] top-[18%] h-10 w-14 rotate-[-25deg] rounded-full bg-white/40 blur-md" />
              </motion.span>
            </div>
          </button>

          <div className="relative w-full max-w-xl text-center" aria-live="polite">
            <p className="text-lg font-black">{STATE_COPY[state]}</p>
            {notice && <p className="mt-1 text-sm text-amber-300">{notice}</p>}
            {caption.you && <p className="mt-3 line-clamp-2 text-sm text-slate-400">Toi : « {caption.you} »</p>}
            {caption.assistant && <p className="mt-2 max-h-28 overflow-y-auto text-sm leading-relaxed text-slate-200">{caption.assistant}</p>}
            <p className="mt-3 hidden text-[11px] text-slate-500 sm:block">Espace : terminer ton tour / passer la réponse · Échap : quitter</p>
          </div>

          {/* Floating HUD */}
          <div className="relative flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] p-2 sm:gap-3">
            <button
              type="button"
              onClick={toggleMute}
              aria-pressed={muted}
              aria-label={muted ? "Réactiver le micro" : "Couper le micro"}
              className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors", muted ? "bg-rose-500 text-white" : "bg-white/10 hover:bg-white/20")}
            >
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={togglePause}
              disabled={state !== "speaking"}
              aria-label={paused ? "Reprendre la réponse" : "Mettre la réponse en pause"}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20 disabled:opacity-40"
            >
              {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => setVoiceIndex((i) => i + 1)}
              disabled={voices.length < 2}
              title={voiceLabel ? `Voix : ${voiceLabel}` : "Changer de voix"}
              aria-label="Changer de voix"
              className="flex h-12 min-w-0 items-center gap-2 rounded-full bg-white/10 px-3 text-xs font-bold sm:px-4 transition-colors hover:bg-white/20 disabled:opacity-40"
            >
              {state === "transcribing" || state === "thinking" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
              <span className="max-w-[4.5rem] truncate sm:max-w-[7rem]">{voiceLabel ?? "Voix"}</span>
            </button>
            <button type="button" onClick={onClose} className="flex h-12 shrink-0 items-center rounded-full bg-gradient-to-r from-rose-500 to-pink-600 px-4 text-sm font-black sm:px-5">
              Quitter
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
