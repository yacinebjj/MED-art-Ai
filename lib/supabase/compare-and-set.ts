/**
 * Compare-and-set for the read-modify-write updates of one array or jsonb
 * column — server-only (the service-role client's PostgREST queries).
 *
 * Several routes edit a whole array/jsonb value: read it, change it in
 * memory, write the result back (profiles.flashcard_active_module_ids and
 * flashcard_active_course_ids, profiles.push_subscriptions,
 * profiles.module_global_summaries, chat_messages.reactions). Two requests
 * doing that at the same time each wrote back the value THEY had read, so
 * the other request's change was silently lost — guaranteed, not rare, when
 * the dashboard switches a whole unit's flashcards on (one PATCH per module,
 * all in parallel), and likely when a group votes on a poll at once.
 *
 * Here the UPDATE carries one more condition: "the column still equals the
 * value that was read" (a PostgREST `eq` filter on the same statement, so
 * check and write are a single atomic UPDATE in Postgres). When another write
 * landed first, the UPDATE matches no row; the caller then reads again and
 * re-applies its own change (retryOnWriteConflict). Postgres compares arrays
 * element by element, in order, and jsonb by value (key order and whitespace
 * don't matter) — exactly "unchanged since it was read".
 *
 * A value too long to travel in the request URL (MAX_EXPECTED_VALUE_CHARS),
 * or none read at all (missing row), is written without the condition,
 * exactly as before: this never adds a failure the old code didn't have.
 */

import type { PostgrestError } from "@supabase/supabase-js";

/** An attempt whose write lost the race to another request: read again and retry. */
export const WRITE_CONFLICT: unique symbol = Symbol("WRITE_CONFLICT");
export type WriteConflict = typeof WRITE_CONFLICT;

/** French message for a request that lost the race on every attempt (HTTP 409). */
export const WRITE_CONFLICT_MESSAGE = "Trop de modifications en même temps — réessaie dans un instant.";

/** How the column's value is written as a PostgREST filter value. */
export type ComparableColumnKind = "integer[]" | "jsonb";

/**
 * Longest expected value, URL-encoded, sent as a filter. Keeps the request
 * line far below the API gateway's limits (several KB); above it, the write
 * goes out without the check, as it always did.
 */
const MAX_EXPECTED_VALUE_CHARS = 4000;

/**
 * Giving up: after MAX_ATTEMPTS, or once RETRY_BUDGET_MS have gone by. Writes
 * to one row are serialized, so a burst on the same row (a whole group
 * voting on a poll the moment it's posted) drains at about one write per
 * read+write round trip: what lets every request through is TIME, not a
 * number of attempts. 8 s keeps the request well inside a function's
 * default duration limit; a request still losing then gets a 409 to retry —
 * an explicit failure, never a silently lost change.
 */
const MAX_ATTEMPTS = 40;
const RETRY_BUDGET_MS = 8_000;
/** Random pause between attempts: up to 20 ms, then 40, 80, 160, capped at 300 ms. */
const FIRST_PAUSE_MS = 20;
const MAX_PAUSE_MS = 300;

/**
 * The value read, as the text PostgREST's `eq` filter compares the column
 * with: `{1,2,3}` for an integer/bigint array, the JSON text for jsonb.
 *
 * @param value - The column's value as read (undefined when no row was read).
 * @param kind - The column's type.
 * @returns The filter value, or null when it can't be compared that way
 *          (nothing read, not plain integers, or too long for a URL).
 */
export function expectedValueFilter(value: unknown, kind: ComparableColumnKind): string | null {
  let literal: string;
  if (kind === "integer[]") {
    if (!Array.isArray(value) || !value.every((item) => Number.isSafeInteger(item))) return null;
    literal = `{${value.join(",")}}`;
  } else {
    if (value === undefined || value === null) return null;
    literal = JSON.stringify(value);
  }
  return encodeURIComponent(literal).length <= MAX_EXPECTED_VALUE_CHARS ? literal : null;
}

/** The part of a PostgREST update builder this module needs. */
interface FilterableUpdate {
  filter(column: string, operator: string, value: unknown): FilterableUpdate;
  select(columns: string): PromiseLike<{ data: unknown; error: PostgrestError | null }>;
}

/**
 * Runs an update the caller already built (`supabase.from(t).update(v).eq(key, id)`)
 * only while `column` still holds the value the caller read.
 *
 * @param update - The update, filtered down to its one row.
 * @param column - The array/jsonb column being rewritten.
 * @param valueRead - That column's value as read (undefined: no row was read — no condition).
 * @param kind - The column's type.
 * @param returning - Columns the UPDATE returns (PostgREST `select`).
 * @returns The updated rows; WRITE_CONFLICT when the column changed since it
 *          was read (nothing was written); or the PostgREST error.
 */
export async function updateIfUnchanged<Row = Record<string, unknown>>(
  update: FilterableUpdate,
  column: string,
  valueRead: unknown,
  kind: ComparableColumnKind,
  returning: string
): Promise<{ rows: Row[]; error: null } | { rows: null; error: PostgrestError } | WriteConflict> {
  const expected = expectedValueFilter(valueRead, kind);
  const { data, error } = await (expected === null ? update : update.filter(column, "eq", expected)).select(returning);
  if (error) return { rows: null, error };
  const rows = (Array.isArray(data) ? data : []) as Row[];
  if (expected !== null && rows.length === 0) return WRITE_CONFLICT;
  return { rows, error: null };
}

/**
 * Runs `attempt` (read → change → updateIfUnchanged) until it stops losing
 * the race, with a short random pause between attempts so parallel requests
 * on the same row spread out instead of colliding again — within
 * MAX_ATTEMPTS and RETRY_BUDGET_MS.
 *
 * @param attempt - One read-modify-write; returns WRITE_CONFLICT to be run again.
 * @returns The first result that isn't WRITE_CONFLICT, or WRITE_CONFLICT if every run lost.
 */
export async function retryOnWriteConflict<T>(attempt: () => Promise<T | WriteConflict>): Promise<T | WriteConflict> {
  const giveUpAt = Date.now() + RETRY_BUDGET_MS;
  for (let run = 1; ; run++) {
    const result = await attempt();
    if (result !== WRITE_CONFLICT || run >= MAX_ATTEMPTS || Date.now() >= giveUpAt) return result;
    const ceiling = Math.min(MAX_PAUSE_MS, FIRST_PAUSE_MS * 2 ** (run - 1));
    await new Promise((resolve) => setTimeout(resolve, Math.random() * ceiling));
  }
}
