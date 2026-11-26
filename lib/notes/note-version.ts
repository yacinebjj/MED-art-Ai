/**
 * user_notes.updated_at doubles as a note's version: a save or an append is
 * applied only while the note still has the updated_at it was read with
 * (app/api/notes/route.ts, app/api/notes/[id]/route.ts).
 */

/**
 * A new updated_at for a note, strictly later than `previous`. Two writes
 * stamped with the same millisecond — possible when serverless instances'
 * clocks differ slightly — would leave the version unchanged, and a writer
 * still holding the older copy would then overwrite the newer one.
 *
 * @param previous - The version being replaced, when known (any timestamp Date.parse reads).
 * @returns An ISO timestamp: now, or 1 ms after `previous` when that is later.
 */
export function noteVersionAfter(previous: string | null | undefined): string {
  const now = Date.now();
  const before = previous ? Date.parse(previous) : NaN;
  return new Date(Number.isFinite(before) && before >= now ? before + 1 : now).toISOString();
}
