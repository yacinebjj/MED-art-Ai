/**
 * BROWSER-ONLY — uses AudioContext/OfflineAudioContext, never import this
 * from server code.
 *
 * Turns any recording the browser can play (MP3, M4A, WAV, OGG, WEBM, FLAC…)
 * into small, self-contained 16 kHz mono WAV chunks for Whisper:
 *
 *  - Decoded ONCE, directly at 16 kHz (Whisper's working rate): the decode
 *    context is created with `sampleRate: 16000`, so decodeAudioData resamples
 *    while decoding instead of materialising the source's native 44.1/48 kHz
 *    PCM first. For a 2-hour mono lecture that is ~460 MB of float PCM instead
 *    of ~1.3 GB, and the old full-length OfflineAudioContext copy and the full
 *    Int16 copy are gone entirely — each chunk is downmixed/encoded on demand.
 *    Browsers that refuse a 16 kHz context fall back to native-rate decoding
 *    plus per-chunk resampling (still no full-length copies).
 *  - Chunks are 4 minutes (~7.7 MB WAV): small enough to upload reliably over
 *    a phone connection, and they double as the transcript's timestamp grid.
 *  - Each chunk is peak-normalised (bounded gain) so a quiet amphitheatre
 *    recording reaches Whisper at a healthy level.
 *
 * Chunks are uploaded straight to Supabase Storage by the caller (see
 * lib/audio/lecture-pipeline.ts) — never through a Next.js route body.
 */

export const TARGET_SAMPLE_RATE = 16000;
export const CHUNK_SECONDS = 4 * 60;

/** Peak target (~-1 dBFS) and the maximum boost applied to a quiet chunk. */
const NORMALIZE_TARGET = 0.89;
const NORMALIZE_MAX_GAIN = 4;

export interface PreparedLectureAudio {
  buffer: AudioBuffer;
  durationSec: number;
  chunkCount: number;
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor {
  const ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!ctor) throw new Error("Ton navigateur ne sait pas décoder l'audio (Web Audio indisponible).");
  return ctor;
}

export async function prepareLectureAudio(file: File): Promise<PreparedLectureAudio> {
  const Ctor = getAudioContextCtor();
  let context: AudioContext;
  try {
    context = new Ctor({ sampleRate: TARGET_SAMPLE_RATE });
  } catch {
    context = new Ctor();
  }
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    return { buffer, durationSec: buffer.duration, chunkCount: Math.max(1, Math.ceil(buffer.duration / CHUNK_SECONDS)) };
  } catch {
    throw new Error("Ce fichier audio n'a pas pu être décodé. Essaie un MP3, M4A, WAV ou OGG.");
  } finally {
    void context.close?.();
  }
}

/** Mono 16 kHz samples for [startSec, startSec + durSec). */
async function monoWindow(buffer: AudioBuffer, startSec: number, durSec: number): Promise<Float32Array> {
  if (buffer.sampleRate === TARGET_SAMPLE_RATE) {
    const from = Math.floor(startSec * TARGET_SAMPLE_RATE);
    const to = Math.min(buffer.length, from + Math.ceil(durSec * TARGET_SAMPLE_RATE));
    const out = new Float32Array(Math.max(0, to - from));
    const channels = buffer.numberOfChannels;
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < out.length; i++) out[i] += data[from + i];
    }
    if (channels > 1) for (let i = 0; i < out.length; i++) out[i] /= channels;
    return out;
  }
  // Fallback path: resample just this window.
  const length = Math.max(1, Math.ceil(Math.min(durSec, buffer.duration - startSec) * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, length, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0, startSec, durSec);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

function normalize(samples: Float32Array): void {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  if (peak < 0.001 || peak >= NORMALIZE_TARGET) return;
  const gain = Math.min(NORMALIZE_MAX_GAIN, NORMALIZE_TARGET / peak);
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
}

function encodeMonoWav(samples: Float32Array, sampleRate: number): Blob {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Encodes chunk `index` (0-based) as a normalised mono 16 kHz WAV. */
export async function encodeLectureChunk(prepared: PreparedLectureAudio, index: number): Promise<Blob> {
  const start = index * CHUNK_SECONDS;
  const samples = await monoWindow(prepared.buffer, start, Math.min(CHUNK_SECONDS, prepared.durationSec - start));
  normalize(samples);
  return encodeMonoWav(samples, TARGET_SAMPLE_RATE);
}

/** Bar heights (0..1) for a waveform overview — strided scan, fast even on a 2-hour buffer. */
export function computePeaks(buffer: AudioBuffer, bars = 480): number[] {
  const data = buffer.getChannelData(0);
  const block = Math.max(1, Math.floor(data.length / bars));
  const step = Math.max(1, Math.floor(block / 1500));
  const peaks: number[] = [];
  let max = 0;
  for (let b = 0; b < bars; b++) {
    let peak = 0;
    const from = b * block;
    const to = Math.min(data.length, from + block);
    for (let i = from; i < to; i += step) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
    if (peak > max) max = peak;
  }
  return max > 0 ? peaks.map((p) => p / max) : peaks;
}

/** Normalises then encodes a run of 16 kHz mono samples as a WAV chunk (shared with lib/audio/streaming-decode.ts). */
export function encodeNormalizedWav(samples: Float32Array): Blob {
  normalize(samples);
  return encodeMonoWav(samples, TARGET_SAMPLE_RATE);
}
