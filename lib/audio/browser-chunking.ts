/**
 * BROWSER-ONLY — uses AudioContext/OfflineAudioContext, never import this
 * from server code. Exists because a real lecture recording (50-300+ Mo)
 * blows past OpenRouter's confirmed HARD 50 MiB request-body ceiling
 * (52,428,800 bytes exactly — confirmed live, 2026-09-02, via a real 413) no
 * matter which of its two input modes is used (multipart caps at a
 * documented 25 Mo; JSON base64 has no documented cap but is subject to the
 * SAME 50 MiB platform-wide limit, confirmed by the same real error). There
 * is no "streamed/chunked upload" parameter on this endpoint — HTTP
 * multipart is a content-type, not a resumable-upload protocol; the whole
 * request body still has to fit in one shot either way.
 *
 * The fix: decode the ENTIRE file once using the browser's own built-in
 * codecs (m4a/mp3/wav/ogg — whatever the browser can play, it can decode via
 * decodeAudioData, no server-side ffmpeg needed at all), resample down to
 * 16kHz mono (Whisper's own internal working rate — this loses nothing the
 * model wouldn't already discard, while shrinking raw PCM ~3-6x versus a
 * typical 44.1/48kHz source), then slice the resulting PCM into fixed-
 * duration WAV chunks small enough to always take the safe multipart path
 * server-side (see lib/ai/openrouter.ts's MULTIPART_SAFE_MAX_BYTES).
 *
 * UNVERIFIED on a genuine 2-hour file: decodeAudioData decodes the WHOLE
 * file into memory before any chunking happens (there's no way to decode
 * only part of a compressed container without proper demuxing) — a 2h
 * source at a typical 44.1kHz stereo native rate is well over 1 GB of raw
 * PCM in memory, however briefly. This has only been reasoned through, never
 * tested on a file that long; a lower-end phone browser could plausibly run
 * out of memory partway through. Only confirmed to work at the ~53 Mo scale
 * that just failed.
 */

// Matches Whisper's own internal expected sample rate.
const TARGET_SAMPLE_RATE = 16000;

// 8 min * 16000 samples/s * 2 bytes/sample = ~15.4 MB per chunk (mono
// 16-bit PCM + a 44-byte WAV header) — comfortably under
// MULTIPART_SAFE_MAX_BYTES (24 MB) with real margin, even accounting for
// a source whose actual chunk boundaries land a little unevenly.
const CHUNK_DURATION_SECONDS = 8 * 60;

/** Decodes the whole file via the browser's own codecs, then resamples to mono TARGET_SAMPLE_RATE via OfflineAudioContext (which does real resampling when its own sampleRate differs from the source's, not just a naive re-tag). */
async function decodeToResampledMono(file: File): Promise<Float32Array> {
  const arrayBuffer = await file.arrayBuffer();
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const decodeContext = new AudioContextCtor();

  let decoded: AudioBuffer;
  try {
    decoded = await decodeContext.decodeAudioData(arrayBuffer);
  } finally {
    // Not awaited — releasing the context's own resources is best-effort
    // cleanup, not something the caller needs to wait on.
    void decodeContext.close?.();
  }

  const offlineContext = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
  const source = offlineContext.createBufferSource();
  source.buffer = decoded;
  // Connecting a multi-channel buffer to a 1-channel destination triggers
  // the Web Audio API's own standard downmix — no manual stereo averaging.
  source.connect(offlineContext.destination);
  source.start(0);

  const resampled = await offlineContext.startRendering();
  return resampled.getChannelData(0);
}

function floatTo16BitPCM(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/** Browser-safe equivalent of lib/audio/mp3-encoder.ts's server-side WAV wrapping — Buffer isn't available here, so this builds the same 44-byte header directly on an ArrayBuffer via DataView. */
function encodeMonoWav(samples: Int16Array, sampleRate: number): Blob {
  const blockAlign = 2; // mono, 16-bit
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * 2;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    view.setInt16(offset, samples[i], true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Decodes `file` and splits it into an ordered array of small, standalone
 * mono 16kHz WAV blobs — each one independently uploadable/transcribable,
 * safely under the server's multipart-safe size ceiling. The caller
 * (components/dashboard/LectureNotesUploader.tsx) uploads them in order to
 * app/api/lecture-notes/transcribe-chunk, one request per chunk.
 */
export async function decodeAndChunkAudioFile(file: File): Promise<Blob[]> {
  const mono = await decodeToResampledMono(file);
  const pcm16 = floatTo16BitPCM(mono);

  const samplesPerChunk = TARGET_SAMPLE_RATE * CHUNK_DURATION_SECONDS;
  const chunks: Blob[] = [];
  for (let start = 0; start < pcm16.length; start += samplesPerChunk) {
    const slice = pcm16.subarray(start, Math.min(start + samplesPerChunk, pcm16.length));
    chunks.push(encodeMonoWav(slice, TARGET_SAMPLE_RATE));
  }
  return chunks;
}
