import type { PomodoroCue } from "./schedule";

/**
 * The Pomodoro chime, synthesized — no sound file to ship or load. Soft bell
 * voices (a sine fundamental plus two quieter overtones that fade first)
 * through a gentle, darkened echo, one recognizable figure per cue.
 *
 * A timer, not a tap, triggers it, and phones are strict about that. So it
 * plays two ways:
 * 1. Through an HTML <audio> player — the primary path. Each cue is rendered
 *    once (OfflineAudioContext) into a small WAV and played by one audio
 *    element a tap unlocked. Media playback is what phones let through: an
 *    iPhone plays it even with the silent switch on, or while music runs in
 *    another app — both mute or interrupt Web Audio.
 * 2. Live through Web Audio (the same graph) — the fallback when the player
 *    isn't unlocked yet, a cue isn't rendered yet, or playback is refused.
 *
 * unlockPomodoroAudio() must run inside a user gesture: the Start/Pause taps
 * call it (PomodoroProvider.toggleActive), the "Tester la sonnerie" button
 * does, and so does the next tap anywhere after a reload restored a running
 * timer.
 */

const FIGURES: Record<PomodoroCue, { notes: number[]; step: number; ring: number }> = {
  // Study → break: a rising E-major arpeggio — the "you earned it" cue.
  break: { notes: [659.25, 830.61, 987.77, 1318.51], step: 0.16, ring: 1.8 },
  // Break → study: two bright notes, a rising fourth — "back to it".
  focus: { notes: [783.99, 1046.5], step: 0.18, ring: 1.4 },
  // Last cycle done: a full C-major flourish.
  complete: { notes: [523.25, 659.25, 783.99, 1046.5, 1318.51], step: 0.14, ring: 2.2 },
};

const CUES = Object.keys(FIGURES) as PomodoroCue[];

/** Bell voice: [frequency ratio, level, share of the note's ring time]. */
const PARTIALS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [2, 0.3, 0.55],
  [3.01, 0.1, 0.3],
];

const NOTE_PEAK = 0.2;
/** The last note of a figure rings longer. */
const LAST_NOTE_RING = 1.3;
/** Time the echo keeps sounding after the last note fades. */
const ECHO_TAIL_S = 1.4;
/** Rendered WAVs: mono, 22.05 kHz — the bell's top overtone (~4 kHz) fits well under it. */
const RENDER_SAMPLE_RATE = 22050;

let sharedContext: AudioContext | null = null;
let player: HTMLAudioElement | null = null;
let playerUnlocked = false;
const cueUrls: Partial<Record<PomodoroCue, string>> = {};
let renderPromise: Promise<void> | null = null;
let silentClipUrl: string | null = null;

function getAudioContext(): AudioContext | null {
  if (sharedContext) return sharedContext;
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    sharedContext = new AudioCtx();
  } catch {
    return null;
  }
  return sharedContext;
}

/** One cue's length in seconds, echo tail included. */
export function pomodoroChimeSeconds(cue: PomodoroCue): number {
  const { notes, step, ring } = FIGURES[cue];
  return (notes.length - 1) * step + ring * LAST_NOTE_RING + ECHO_TAIL_S;
}

/**
 * Builds one cue's whole graph on any context — the live one, or an
 * OfflineAudioContext to render or measure it. Returns its length in seconds.
 */
export function schedulePomodoroChime(ctx: BaseAudioContext, cue: PomodoroCue, startAt = ctx.currentTime): number {
  const { notes, step, ring } = FIGURES[cue];

  const master = ctx.createGain();
  master.gain.value = 0.9;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 10;
  limiter.ratio.value = 4;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  master.connect(limiter);
  limiter.connect(ctx.destination);

  // Echo: a soft, darkened repeat — the sense of space that makes it a chime, not a beep.
  const echo = ctx.createDelay(1);
  echo.delayTime.value = 0.24;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3200;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.3;
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  echo.connect(tone);
  tone.connect(feedback);
  feedback.connect(echo);
  tone.connect(wet);
  wet.connect(master);

  notes.forEach((frequency, index) => {
    const noteStart = startAt + index * step;
    const noteRing = index === notes.length - 1 ? ring * LAST_NOTE_RING : ring;
    for (const [ratio, level, ringShare] of PARTIALS) {
      const noteEnd = noteStart + noteRing * ringShare;
      const oscillator = ctx.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency * ratio, noteStart);
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, noteStart);
      envelope.gain.exponentialRampToValueAtTime(NOTE_PEAK * level, noteStart + 0.006);
      envelope.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      oscillator.connect(envelope);
      envelope.connect(master);
      envelope.connect(echo);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.05);
    }
  });

  return pomodoroChimeSeconds(cue);
}

/** 16-bit PCM mono WAV. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

async function renderCue(cue: PomodoroCue): Promise<string | null> {
  const OfflineCtx =
    window.OfflineAudioContext || (window as typeof window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineCtx) return null;
  const ctx = new OfflineCtx(1, Math.ceil(pomodoroChimeSeconds(cue) * RENDER_SAMPLE_RATE), RENDER_SAMPLE_RATE);
  schedulePomodoroChime(ctx, cue, 0);
  // Older Safari answers through `oncomplete` instead of a promise.
  const rendered = await new Promise<AudioBuffer>((resolve, reject) => {
    ctx.oncomplete = (event) => resolve(event.renderedBuffer);
    const result = ctx.startRendering() as Promise<AudioBuffer> | undefined;
    if (result && typeof result.then === "function") result.then(resolve, reject);
  });
  return URL.createObjectURL(encodeWav(rendered.getChannelData(0), RENDER_SAMPLE_RATE));
}

/** Renders every cue for the audio player once (no gesture needed); resolves when they are ready. */
export function preparePomodoroChimes(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  renderPromise ??= (async () => {
    for (const cue of CUES) {
      try {
        const url = await renderCue(cue);
        if (url) cueUrls[cue] = url;
      } catch {
        // This cue stays on the live Web Audio path.
      }
    }
  })();
  return renderPromise;
}

function silentClip(): string {
  silentClipUrl ??= URL.createObjectURL(encodeWav(new Float32Array(RENDER_SAMPLE_RATE / 10), RENDER_SAMPLE_RATE));
  return silentClipUrl;
}

/** The audio player: playing a silent clip inside the gesture is what lets it play later without one. */
function unlockPlayer(): Promise<boolean> {
  if (playerUnlocked) return Promise.resolve(true);
  if (typeof Audio === "undefined") return Promise.resolve(false);
  try {
    player ??= new Audio();
    player.preload = "auto";
    player.src = silentClip();
    const attempt = player.play();
    return Promise.resolve(attempt).then(
      () => {
        playerUnlocked = true;
        return true;
      },
      () => false
    );
  } catch {
    return Promise.resolve(false);
  }
}

async function unlockContext(): Promise<boolean> {
  const ctx = getAudioContext();
  if (!ctx) return false;
  try {
    // iOS completes the unlock only once something actually plays inside the gesture: one silent sample.
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // No unlock this time — the next gesture tries again.
  }
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch {
      return false;
    }
  }
  return (ctx.state as AudioContextState) === "running";
}

/**
 * Call from a user gesture (click, tap, key): lets later chimes play without
 * one. Both paths start synchronously, inside the gesture. Resolves to
 * whether either can now play.
 */
export async function unlockPomodoroAudio(): Promise<boolean> {
  const playerReady = unlockPlayer();
  const contextReady = unlockContext();
  void preparePomodoroChimes();
  const [playerOk, contextOk] = await Promise.all([playerReady, contextReady]);
  return playerOk || contextOk;
}

export function isPomodoroAudioUnlocked(): boolean {
  return playerUnlocked || sharedContext?.state === "running";
}

function playLive(cue: PomodoroCue): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    schedulePomodoroChime(ctx, cue, ctx.currentTime + 0.05);
  } catch (error) {
    console.warn("Notification sonore indisponible:", error);
  }
}

/** Plays a cue now: the unlocked audio player first, live Web Audio otherwise. Silent when neither can play. */
export function playPomodoroChime(cue: PomodoroCue): void {
  const url = cueUrls[cue];
  if (player && playerUnlocked && url) {
    try {
      player.pause();
      player.src = url;
      void Promise.resolve(player.play()).catch(() => playLive(cue));
      return;
    } catch {
      // Fall through to Web Audio.
    }
  }
  playLive(cue);
}
