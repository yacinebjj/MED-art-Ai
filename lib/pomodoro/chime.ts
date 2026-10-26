import type { PomodoroCue } from "./schedule";

/**
 * The Pomodoro chime, synthesized with Web Audio — no sound file to ship or
 * load. Soft bell voices (a sine fundamental plus two quieter overtones that
 * fade first) through a gentle, darkened echo, one recognizable figure per
 * cue.
 *
 * Browsers only let a page start audio from a user gesture, but phase
 * changes fire from a timer. So unlockPomodoroAudio() runs on the gestures
 * that start the timer (and on the next tap anywhere when a reload restored
 * a running timer): once the shared AudioContext runs, a chime plays from
 * any page of the app, background tab included.
 */

const FIGURES: Record<PomodoroCue, { notes: number[]; step: number; ring: number }> = {
  // Study → break: a rising E-major arpeggio — the "you earned it" cue.
  break: { notes: [659.25, 830.61, 987.77, 1318.51], step: 0.16, ring: 1.8 },
  // Break → study: two bright notes, a rising fourth — "back to it".
  focus: { notes: [783.99, 1046.5], step: 0.18, ring: 1.4 },
  // Last cycle done: a full C-major flourish.
  complete: { notes: [523.25, 659.25, 783.99, 1046.5, 1318.51], step: 0.14, ring: 2.2 },
};

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

let sharedContext: AudioContext | null = null;

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

/**
 * Call from a user gesture (click, tap, key): lets later chimes play without
 * one. Resolves to whether audio now runs.
 */
export async function unlockPomodoroAudio(): Promise<boolean> {
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

export function isPomodoroAudioUnlocked(): boolean {
  return sharedContext?.state === "running";
}

/**
 * Builds one cue's whole graph on any context — the live one, or an
 * OfflineAudioContext to measure it. Returns its length in seconds.
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

  return (notes.length - 1) * step + ring * LAST_NOTE_RING + ECHO_TAIL_S;
}

/** Plays a cue now — silently does nothing when audio is unavailable or still locked. */
export function playPomodoroChime(cue: PomodoroCue): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    schedulePomodoroChime(ctx, cue, ctx.currentTime + 0.05);
  } catch (error) {
    console.warn("Notification sonore indisponible:", error);
  }
}
