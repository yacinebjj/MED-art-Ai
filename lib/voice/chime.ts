/**
 * Subtle start/stop recording chimes (Web Audio, generated — no asset).
 * Start = a soft rising two-note, stop = the falling counterpart.
 */
let context: AudioContext | null = null;

export function playChime(kind: "start" | "stop"): void {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!context) context = new AudioCtx();
    if (context.state === "suspended") void context.resume();
    const notes = kind === "start" ? [660, 990] : [990, 660];
    notes.forEach((frequency, i) => {
      const at = context!.currentTime + i * 0.09;
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.08, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      oscillator.connect(gain);
      gain.connect(context!.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.17);
    });
  } catch {
    // Audio feedback is a nicety — never block recording on it.
  }
}
