/**
 * BROWSER-ONLY streaming decoder for long lecture recordings (2 h+, 100 MB+).
 *
 * Real failure this replaces for large files: "Ce fichier audio n'a pas pu
 * être décodé" on a 110 MB / 1 h 58 m .m4a. decodeAudioData() decodes the
 * WHOLE file into one PCM buffer — gigabytes for two hours — and the browser
 * gives up. Here the file is never decoded at once:
 *
 *  - MP4 / M4A / AAC (phones, recorders): the container is demuxed
 *    progressively with mp4box (the file is read in 4 MB slices) and each
 *    AAC frame is decoded by the browser's native WebCodecs AudioDecoder
 *    (off the main thread).
 *  - MP3: the file is decoded in independent ~6 MB byte slices (MP3 is a
 *    stream of self-contained frames, decoders resync at the next header).
 *  - WAV: PCM is read in slices straight from the file.
 *
 * Every decoded block is downmixed to mono, resampled to 16 kHz and fed into
 * a collector that emits EXACT 4-minute WAV chunks as soon as each is full —
 * so memory holds the compressed input plus a few chunks, never the whole
 * recording, and the first chunks are already uploading while the rest
 * decodes. Other formats (OGG, WEBM, FLAC) fall back to whole-file decoding,
 * which remains fine for the sizes those formats are recorded at here.
 */

import { createFile, MP4BoxBuffer, type Movie, type Sample } from "mp4box";
import { CHUNK_SECONDS, TARGET_SAMPLE_RATE, computePeaks, encodeLectureChunk, encodeNormalizedWav, prepareLectureAudio } from "@/lib/audio/browser-chunking";

export interface StreamedChunk {
  index: number;
  blob: Blob;
}

export interface StreamSummary {
  durationSec: number;
  peaks: number[];
}

export interface ChunkStreamOptions {
  signal: AbortSignal;
  /** Best estimate of the total number of chunks, refined as decoding goes. */
  onEstimate?: (chunkCount: number) => void;
}

const CHUNK_SAMPLES = CHUNK_SECONDS * TARGET_SAMPLE_RATE;
const READ_SLICE_BYTES = 4 * 1024 * 1024;
const MP3_SLICE_BYTES = 6 * 1024 * 1024;
/** Whole-file decoding is only attempted below this size (other formats). */
const WHOLE_DECODE_MAX_BYTES = 150 * 1024 * 1024;
/** Peak bars per stored 16 kHz second-block, for the waveform overview. */
const PEAK_BLOCK = TARGET_SAMPLE_RATE / 2;

export class AudioFormatError extends Error {}

function abortIfNeeded(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Annulé", "AbortError");
}

/* ───────────────────────── resampling + chunking ───────────────────────── */

/** Mono resampler to 16 kHz: box-average when downsampling (anti-aliasing for speech), linear when upsampling. Stateful across blocks. */
class MonoResampler {
  private readonly step: number;
  private pos = 0; // fractional input position of the next output sample, relative to the current block
  private acc = 0;
  private accCount = 0;
  private last = 0;
  constructor(private readonly inRate: number) {
    this.step = inRate / TARGET_SAMPLE_RATE;
  }
  push(input: Float32Array): Float32Array {
    if (this.inRate === TARGET_SAMPLE_RATE) return input;
    // Preallocated output (no per-sample JS array growth: a 2-hour file
    // produces ~115 M output samples, so garbage here dominated memory).
    const out = new Float32Array(Math.ceil(input.length / this.step) + 2);
    let n = 0;
    if (this.step >= 1) {
      // Downsample: average every input sample falling into each output slot.
      let boundary = this.pos + this.step;
      for (let i = 0; i < input.length; i++) {
        this.acc += input[i];
        this.accCount++;
        if (i + 1 >= boundary) {
          out[n++] = this.acc / this.accCount;
          this.acc = 0;
          this.accCount = 0;
          boundary += this.step;
        }
      }
      this.pos = boundary - this.step - input.length;
    } else {
      // Upsample (e.g. 8 kHz telephone audio): linear interpolation.
      let p = this.pos;
      while (p < input.length) {
        const i = Math.floor(p);
        const frac = p - i;
        const a = i === 0 ? this.last : input[i - 1];
        const b = input[i];
        out[n++] = a + (b - a) * frac;
        p += this.step;
      }
      this.pos = p - input.length;
      this.last = input[input.length - 1] ?? this.last;
    }
    return out.subarray(0, n);
  }
}

/** Collects 16 kHz mono samples and emits exact CHUNK_SECONDS WAV chunks. */
class ChunkCollector {
  private buffer = new Float32Array(CHUNK_SAMPLES);
  private filled = 0;
  private index = 0;
  private total = 0;
  private peakAcc = 0;
  private peakCount = 0;
  readonly blockPeaks: number[] = [];
  constructor(private readonly emit: (chunk: StreamedChunk) => void) {}
  push(samples: Float32Array) {
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(samples.length - offset, CHUNK_SAMPLES - this.filled);
      this.buffer.set(samples.subarray(offset, offset + take), this.filled);
      for (let i = offset; i < offset + take; i++) {
        const v = Math.abs(samples[i]);
        if (v > this.peakAcc) this.peakAcc = v;
        if (++this.peakCount >= PEAK_BLOCK) {
          this.blockPeaks.push(this.peakAcc);
          this.peakAcc = 0;
          this.peakCount = 0;
        }
      }
      this.filled += take;
      offset += take;
      if (this.filled === CHUNK_SAMPLES) this.flushChunk();
    }
    this.total += samples.length;
  }
  private flushChunk() {
    this.emit({ index: this.index++, blob: encodeNormalizedWav(this.buffer.slice(0, this.filled)) });
    this.buffer = new Float32Array(CHUNK_SAMPLES);
    this.filled = 0;
  }
  finish(): StreamSummary {
    if (this.filled > TARGET_SAMPLE_RATE / 2) this.flushChunk(); // ignore a sub-0.5 s tail
    if (this.peakCount > 0) this.blockPeaks.push(this.peakAcc);
    return { durationSec: this.total / TARGET_SAMPLE_RATE, peaks: downsamplePeaks(this.blockPeaks, 480) };
  }
}

function downsamplePeaks(blocks: number[], bars: number): number[] {
  if (blocks.length === 0) return [];
  const out: number[] = [];
  const per = blocks.length / bars;
  let max = 0;
  for (let b = 0; b < Math.min(bars, blocks.length); b++) {
    let peak = 0;
    const from = Math.floor(b * per);
    const to = Math.max(from + 1, Math.floor((b + 1) * per));
    for (let i = from; i < to && i < blocks.length; i++) peak = Math.max(peak, blocks[i]);
    out.push(peak);
    max = Math.max(max, peak);
  }
  return max > 0 ? out.map((p) => p / max) : out;
}

function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i];
  for (let i = 0; i < out.length; i++) out[i] /= channels.length;
  return out;
}

/* ───────────────────────── async queue (producer → consumer) ───────────────────────── */

class ChunkQueue {
  private items: StreamedChunk[] = [];
  private waiters: (() => void)[] = [];
  private spaceWaiters: (() => void)[] = [];
  done = false;
  error: unknown = null;
  constructor(private readonly capacity: number) {}
  push(chunk: StreamedChunk) {
    this.items.push(chunk);
    this.waiters.splice(0).forEach((w) => w());
  }
  close(error?: unknown) {
    this.done = true;
    if (error) this.error = error;
    this.waiters.splice(0).forEach((w) => w());
    this.spaceWaiters.splice(0).forEach((w) => w());
  }
  /** Producer back-pressure: resolves once fewer than `capacity` chunks wait to be consumed. */
  async waitForSpace() {
    while (this.items.length >= this.capacity && !this.done) await new Promise<void>((r) => this.spaceWaiters.push(r));
  }
  async next(): Promise<StreamedChunk | null> {
    for (;;) {
      if (this.items.length > 0) {
        const item = this.items.shift()!;
        this.spaceWaiters.splice(0).forEach((w) => w());
        return item;
      }
      if (this.error) throw this.error;
      if (this.done) return null;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }
}

/* ───────────────────────── format detection ───────────────────────── */

type Strategy = "mp4" | "mp3" | "wav" | "whole";

async function detectStrategy(file: File): Promise<Strategy> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(head.slice(from, to)));
  if (ascii(4, 8) === "ftyp") return typeof AudioDecoder !== "undefined" ? "mp4" : "whole";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
  if (ascii(0, 3) === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return "mp3";
  return "whole";
}

/* ───────────────────────── MP4 / M4A via mp4box + WebCodecs ───────────────────────── */

/** AudioSpecificConfig bytes (esds → DecoderConfigDescriptor(4) → DecoderSpecificInfo(5)), required by AudioDecoder for AAC. */
function aacDescription(movieFile: ReturnType<typeof createFile>, trackId: number): Uint8Array | undefined {
  type DescriptorLike = { findDescriptor?: (tag: number) => unknown; data?: Uint8Array };
  const trak = movieFile.getTrackById(trackId) as unknown as { mdia?: { minf?: { stbl?: { stsd?: { entries?: unknown[] } } } } };
  for (const entry of trak.mdia?.minf?.stbl?.stsd?.entries ?? []) {
    const esd = (entry as { esds?: { esd?: DescriptorLike } }).esds?.esd;
    const config = esd?.findDescriptor?.(4) as DescriptorLike | undefined;
    const specific = config?.findDescriptor?.(5) as DescriptorLike | undefined;
    if (specific?.data) return specific.data;
  }
  return undefined;
}

/** Walks the top-level MP4 boxes (headers only) to see whether "moov" comes after "mdat". */
async function moovAfterMdat(file: File): Promise<boolean> {
  let offset = 0;
  let seenMdat = false;
  for (let guard = 0; guard < 64 && offset + 8 <= file.size; guard++) {
    const view = new DataView(await file.slice(offset, Math.min(file.size, offset + 16)).arrayBuffer());
    let size = view.getUint32(0);
    const type = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));
    if (size === 1 && view.byteLength >= 16) size = Number(view.getBigUint64(8));
    if (size === 0) size = file.size - offset;
    if (type === "moov") return seenMdat;
    if (type === "mdat") seenMdat = true;
    if (size < 8) return true; // unreadable layout: keep data to be safe
    offset += size;
  }
  return seenMdat;
}

async function decodeMp4(file: File, collector: ChunkCollector, queue: ChunkQueue, options: ChunkStreamOptions): Promise<void> {
  // keepMdatData only when the index (moov) is stored AFTER the media data:
  // it is then parsed last, and the media read before must still be there.
  // With the index first (most recorders), media is released as it is decoded.
  const mp4 = createFile(await moovAfterMdat(file));
  let decoder: AudioDecoder | null = null;
  let resampler: MonoResampler | null = null;
  let failure: unknown = null;

  const ready = new Promise<void>((resolve, reject) => {
    mp4.onError = (_module: string, message: string) => reject(new AudioFormatError(`Fichier MP4/M4A illisible : ${message}`));
    mp4.onReady = (info: Movie) => {
      void (async () => {
        const track = info.audioTracks[0];
        if (!track?.audio) throw new AudioFormatError("Aucune piste audio dans ce fichier.");
        const totalSec = info.duration && info.timescale ? info.duration / info.timescale : 0;
        if (totalSec > 0) options.onEstimate?.(Math.max(1, Math.ceil(totalSec / CHUNK_SECONDS)));
        const config: AudioDecoderConfig = {
          codec: track.codec,
          sampleRate: track.audio.sample_rate,
          numberOfChannels: track.audio.channel_count,
          description: aacDescription(mp4, track.id),
        };
        const support = await AudioDecoder.isConfigSupported(config);
        if (!support.supported) throw new AudioFormatError(`Codec audio non pris en charge par ce navigateur (${track.codec}).`);
        resampler = new MonoResampler(track.audio.sample_rate);
        decoder = new AudioDecoder({
          output: (data) => {
            try {
              const frames = data.numberOfFrames;
              const channels: Float32Array[] = [];
              for (let ch = 0; ch < data.numberOfChannels; ch++) {
                const plane = new Float32Array(frames);
                data.copyTo(plane, { planeIndex: ch, format: "f32-planar" });
                channels.push(plane);
              }
              collector.push(resampler!.push(downmix(channels)));
            } catch (error) {
              failure = error;
            } finally {
              data.close();
            }
          },
          error: (error) => {
            failure = error;
          },
        });
        decoder.configure(config);
        mp4.onSamples = (id: number, _user: unknown, samples: Sample[]) => {
          for (const sample of samples) {
            if (!sample.data) continue;
            decoder!.decode(
              new EncodedAudioChunk({
                type: "key",
                timestamp: Math.round((sample.cts * 1_000_000) / sample.timescale),
                duration: Math.round((sample.duration * 1_000_000) / sample.timescale),
                data: sample.data,
              })
            );
          }
          if (samples.length > 0) mp4.releaseUsedSamples(id, samples[samples.length - 1].number);
        };
        mp4.setExtractionOptions(track.id, undefined, { nbSamples: 100 });
        mp4.start();
      })().then(resolve, reject);
    };
  });

  let readyFired = false;
  const onReadyHandler = mp4.onReady;
  mp4.onReady = (info: Movie) => {
    readyFired = true;
    onReadyHandler?.(info);
  };

  for (let offset = 0; offset < file.size; offset += READ_SLICE_BYTES) {
    abortIfNeeded(options.signal);
    const end = Math.min(file.size, offset + READ_SLICE_BYTES);
    const buffer = MP4BoxBuffer.fromArrayBuffer(await file.slice(offset, end).arrayBuffer(), offset);
    mp4.appendBuffer(buffer, end === file.size);
    if (failure) throw failure;
    if (readyFired) {
      // The decoder must be configured and extraction started BEFORE any
      // further data arrives (or is flushed): mp4box discards analysed
      // buffers on flush, so samples appended before start() would be lost.
      await ready;
      // Back-pressure: let the decoder and the uploads catch up before reading more.
      while (decoder && (decoder as AudioDecoder).decodeQueueSize > 200) await new Promise((r) => setTimeout(r, 10));
      await queue.waitForSpace();
    }
  }
  await ready;
  mp4.flush();
  if (decoder) await (decoder as AudioDecoder).flush();
  if (failure) throw failure;
  (decoder as AudioDecoder | null)?.close();
}

/* ───────────────────────── MP3 / WAV slice decoding ───────────────────────── */

function createDecodeContext(): BaseAudioContext {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  try {
    return new Ctor({ sampleRate: TARGET_SAMPLE_RATE });
  } catch {
    return new Ctor();
  }
}

function bufferChannels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch));
}

async function decodeMp3(file: File, collector: ChunkCollector, queue: ChunkQueue, options: ChunkStreamOptions): Promise<void> {
  const ctx = createDecodeContext();
  let resampler: MonoResampler | null = null;
  try {
    for (let offset = 0; offset < file.size; offset += MP3_SLICE_BYTES) {
      abortIfNeeded(options.signal);
      const end = Math.min(file.size, offset + MP3_SLICE_BYTES);
      let decoded: AudioBuffer;
      try {
        decoded = await ctx.decodeAudioData(await file.slice(offset, end).arrayBuffer());
      } catch {
        if (offset === 0) throw new AudioFormatError("Ce fichier MP3 n'a pas pu être lu.");
        continue; // one damaged slice: skip it rather than failing a 2-hour lecture
      }
      if (offset === 0 && decoded.duration > 0) {
        const estimatedSec = (file.size / (end - offset)) * decoded.duration;
        options.onEstimate?.(Math.max(1, Math.ceil(estimatedSec / CHUNK_SECONDS)));
      }
      resampler = resampler ?? new MonoResampler(decoded.sampleRate);
      collector.push(resampler.push(downmix(bufferChannels(decoded))));
      await queue.waitForSpace();
    }
  } finally {
    if ("close" in ctx && typeof (ctx as AudioContext).close === "function") void (ctx as AudioContext).close();
  }
}

/** Reads a WAV header (fmt + data chunk position). */
async function readWavLayout(file: File): Promise<{ dataStart: number; dataEnd: number; sampleRate: number; channels: number; bits: number; float: boolean }> {
  const head = new DataView(await file.slice(0, Math.min(file.size, 1 << 16)).arrayBuffer());
  let pos = 12;
  let fmt: { sampleRate: number; channels: number; bits: number; float: boolean } | null = null;
  while (pos + 8 <= head.byteLength) {
    const id = String.fromCharCode(head.getUint8(pos), head.getUint8(pos + 1), head.getUint8(pos + 2), head.getUint8(pos + 3));
    const size = head.getUint32(pos + 4, true);
    if (id === "fmt ") {
      const format = head.getUint16(pos + 8, true);
      fmt = { channels: head.getUint16(pos + 10, true), sampleRate: head.getUint32(pos + 12, true), bits: head.getUint16(pos + 22, true), float: format === 3 };
    } else if (id === "data" && fmt) {
      return { ...fmt, dataStart: pos + 8, dataEnd: Math.min(file.size, pos + 8 + size || file.size) };
    }
    pos += 8 + size + (size % 2);
  }
  throw new AudioFormatError("En-tête WAV illisible.");
}

async function decodeWav(file: File, collector: ChunkCollector, queue: ChunkQueue, options: ChunkStreamOptions): Promise<void> {
  const layout = await readWavLayout(file);
  if (!(layout.bits === 16 || (layout.float && layout.bits === 32))) throw new AudioFormatError("Format WAV non pris en charge en streaming.");
  const frameBytes = (layout.bits / 8) * layout.channels;
  const totalSec = (layout.dataEnd - layout.dataStart) / frameBytes / layout.sampleRate;
  options.onEstimate?.(Math.max(1, Math.ceil(totalSec / CHUNK_SECONDS)));
  const resampler = new MonoResampler(layout.sampleRate);
  const sliceBytes = frameBytes * layout.sampleRate * 30; // 30 s per read
  for (let offset = layout.dataStart; offset < layout.dataEnd; offset += sliceBytes) {
    abortIfNeeded(options.signal);
    const end = Math.min(layout.dataEnd, offset + sliceBytes);
    const view = new DataView(await file.slice(offset, end).arrayBuffer());
    const frames = Math.floor(view.byteLength / frameBytes);
    const mono = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let ch = 0; ch < layout.channels; ch++) {
        const at = f * frameBytes + ch * (layout.bits / 8);
        sum += layout.float ? view.getFloat32(at, true) : view.getInt16(at, true) / 32768;
      }
      mono[f] = sum / layout.channels;
    }
    collector.push(resampler.push(mono));
    await queue.waitForSpace();
  }
}

/* ───────────────────────── public API ───────────────────────── */

/**
 * Yields the recording as exact 4-minute 16 kHz mono WAV chunks, in order,
 * while it is still being decoded (memory stays bounded). The generator's
 * return value carries the real duration and the waveform peaks.
 */
export async function* streamLectureChunks(file: File, options: ChunkStreamOptions): AsyncGenerator<StreamedChunk, StreamSummary> {
  const strategy = await detectStrategy(file);

  if (strategy === "whole") {
    if (file.size > WHOLE_DECODE_MAX_BYTES) {
      throw new AudioFormatError("Ce format est trop volumineux pour être décodé dans le navigateur. Convertis-le en M4A ou MP3 (même qualité) puis réessaie.");
    }
    const prepared = await prepareLectureAudio(file);
    options.onEstimate?.(prepared.chunkCount);
    for (let index = 0; index < prepared.chunkCount; index++) {
      abortIfNeeded(options.signal);
      yield { index, blob: await encodeLectureChunk(prepared, index) };
    }
    return { durationSec: prepared.durationSec, peaks: computePeaks(prepared.buffer) };
  }

  const queue = new ChunkQueue(3);
  const collector = new ChunkCollector((chunk) => queue.push(chunk));
  const decode = strategy === "mp4" ? decodeMp4 : strategy === "mp3" ? decodeMp3 : decodeWav;
  let summary: StreamSummary = { durationSec: 0, peaks: [] };
  const producer = decode(file, collector, queue, options).then(
    () => {
      summary = collector.finish();
      queue.close();
    },
    (error: unknown) => queue.close(error ?? new AudioFormatError("Décodage interrompu."))
  );

  try {
    for (;;) {
      const chunk = await queue.next();
      if (!chunk) break;
      yield chunk;
    }
  } finally {
    await producer.catch(() => undefined);
  }
  return summary;
}
