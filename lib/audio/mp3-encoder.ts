/**
 * PCM16 -> MP3, pure JS (no ffmpeg binary, no child_process — required for a
 * Vercel serverless function). openai/gpt-audio-mini's streaming audio
 * output only supports `format: "pcm16"` (raw 24kHz mono 16-bit samples, no
 * container — see lib/ai/openrouter.ts's generateOpenRouterAudio), and a
 * 10-15 min episode as raw WAV would be 30+ MB; encoding to MP3 here is what
 * keeps the file Supabase Storage actually serves small enough to stream.
 *
 * @breezystack/lamejs ships `"type": "module"` with a broken CJS fallback
 * (its `require` export condition resolves to an IIFE bundle that attaches
 * to nothing when required directly — confirmed live, 2026-09-02: `require()`
 * returns `{}`). A dynamic `import()` forces Node's real ESM resolver, which
 * correctly picks the `import` condition (`dist/lamejs.js`) — confirmed live
 * against this exact PCM16 payload, verified byte-for-byte playable output.
 */
export async function encodePcm16ToMp3(pcm: Buffer, sampleRate: number, channels: 1 | 2): Promise<Buffer> {
  const lamejs = await import("@breezystack/lamejs");

  const sampleCount = pcm.length / 2;
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = pcm.readInt16LE(i * 2);
  }

  const KBPS = 64; // Matches the calibration test — plenty for spoken narration, keeps the file small.
  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, KBPS);
  const BLOCK_SIZE = 1152; // lamejs's required per-call frame size.
  const chunks: Buffer[] = [];

  for (let i = 0; i < samples.length; i += BLOCK_SIZE) {
    const block = samples.subarray(i, i + BLOCK_SIZE);
    const encoded = encoder.encodeBuffer(block);
    if (encoded.length > 0) chunks.push(Buffer.from(encoded));
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(Buffer.from(tail));

  return Buffer.concat(chunks);
}
