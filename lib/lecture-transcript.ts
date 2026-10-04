/**
 * Timestamped lecture transcripts — shared by the browser pipeline, the
 * extraction route and the workspace viewer.
 *
 * Storage format (plain text in `lecture_notes_jobs.transcript`, no schema
 * change): one block per transcribed audio segment, each starting with a
 * `[HH:MM:SS]` marker = the segment's real start offset in the recording.
 * Transcripts saved before this format have no marker and parse as a single
 * segment starting at 0.
 */

export interface TranscriptSegment {
  startSec: number;
  text: string;
}

export interface TranscriptSentence {
  /** Estimated start: the segment's exact start + a share of its duration proportional to the character offset. */
  startSec: number;
  /** True for the first sentence of a segment, whose timestamp is exact (not estimated). */
  exact: boolean;
  text: string;
}

const MARKER_RE = /^\[(\d{2}):(\d{2}):(\d{2})\][ \t]?/;

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

function marker(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `[${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}]`;
}

export function buildTimestampedTranscript(segments: TranscriptSegment[]): string {
  return segments
    .filter((seg) => seg.text.trim())
    .map((seg) => `${marker(seg.startSec)} ${seg.text.trim()}`)
    .join("\n\n");
}

export function parseTranscript(transcript: string | null | undefined): TranscriptSegment[] {
  if (!transcript?.trim()) return [];
  const blocks = transcript.split(/\n{2,}/);
  const segments: TranscriptSegment[] = [];
  for (const block of blocks) {
    const m = block.match(MARKER_RE);
    if (m) {
      segments.push({ startSec: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]), text: block.slice(m[0].length).trim() });
    } else if (segments.length > 0) {
      segments[segments.length - 1].text += `\n\n${block.trim()}`;
    } else {
      segments.push({ startSec: 0, text: block.trim() });
    }
  }
  return segments.filter((seg) => seg.text);
}

/** The plain spoken text, markers removed — what the extraction model reads. */
export function stripTimestamps(transcript: string): string {
  return parseTranscript(transcript)
    .map((seg) => seg.text)
    .join("\n\n");
}

/**
 * Splits each segment into sentences with a start time. Whisper (via
 * OpenRouter) returns plain text per segment, so only the segment start is
 * exact; inside a segment the time is interpolated by character position
 * (speech rate is roughly constant over a few minutes).
 */
export function toSentences(segments: TranscriptSegment[], totalDurationSec: number | null): TranscriptSentence[] {
  const out: TranscriptSentence[] = [];
  segments.forEach((seg, i) => {
    const next = segments[i + 1]?.startSec ?? totalDurationSec ?? null;
    const span = next !== null && next > seg.startSec ? next - seg.startSec : null;
    const sentences = seg.text.match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [seg.text];
    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0) || 1;
    let consumed = 0;
    sentences.forEach((sentence, j) => {
      out.push({ startSec: span === null ? seg.startSec : seg.startSec + (consumed / totalChars) * span, exact: j === 0, text: sentence });
      consumed += sentence.length;
    });
  });
  return out;
}
