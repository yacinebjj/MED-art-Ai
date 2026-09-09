import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Background-job state store for a genuinely long-running (100+ second)
 * Studio generation, backed by Supabase Storage (a private bucket, never a
 * new DB table/migration — see this file's own rationale below) instead of
 * a database row.
 *
 * WHY THIS EXISTS — replaces an earlier fix (a heartbeat-streamed HTTP
 * response held open for the whole generation) that itself replaced an even
 * earlier one (a single plain request/response held open for the whole
 * generation). Both were confirmed, via a real production report with
 * concrete forensics (elapsed time + heartbeat count + literal network error
 * surfaced directly in the failure toast), to still fail specifically on
 * mobile: TWO separate mobile attempts at "Explication Ultra-Détaillée"
 * both failed within 2-23 seconds having received ZERO heartbeats — far too
 * early for an idle-connection theory to explain, and inconsistent between
 * attempts (a clean stream end once, a raw network exception once) — the
 * signature of a fundamentally unreliable long-lived connection on that
 * network path (very possibly a carrier/proxy that buffers or otherwise
 * mishandles a long streamed HTTP response), not a fixable timing issue. A
 * SEPARATE, cleanly-diagnosed bug was also found in the same round (Podcast
 * hitting its own `maxDuration` ceiling on PC, after 19 real heartbeats over
 * 285s — an entirely different, already-fixed issue).
 *
 * The only architecture that doesn't depend on any single HTTP request
 * surviving more than a few seconds is: kick off the real work in the
 * BACKGROUND (via Vercel's `waitUntil` — see lib/ai/openrouter.ts's sibling
 * routes for the full mechanism), return an near-instant "pending"
 * acknowledgement, and have the client POLL a few seconds later with a new,
 * short, independently-retryable request — repeating until the job store
 * reports "done" or "error". A single flaky poll on a bad mobile connection
 * costs nothing: the background work continues regardless of whether the
 * client is successfully polling, and the very next poll (or the one after)
 * picks up wherever things actually are.
 *
 * Chose Supabase STORAGE over a new database table deliberately: this
 * project's own history (see project memory: "Pending Supabase migrations")
 * has repeatedly had schema changes go unconfirmed/not-actually-run against
 * the live database, because applying a migration here is a manual,
 * easy-to-miss step — shipping a fix that would 500 on every request until
 * someone remembers to run a migration is a worse failure mode than the bug
 * being fixed. A private Storage bucket is created lazily on first use
 * (mirrors ensurePodcastBucket/ensureInfographicBucket exactly), needs no
 * migration, and a tiny JSON blob per job is a natural fit for this data's
 * actual shape and lifetime.
 */
const JOB_BUCKET = "studio-jobs";

/**
 * A "pending" job older than this is presumed dead (its own background
 * `waitUntil` promise crashed, or the invocation was killed by the route's
 * own `maxDuration` without ever reaching a `completeJob`/`failJob` call) —
 * safe to silently restart rather than have the client poll forever against
 * a job that will never resolve. Set comfortably above every real route's
 * own `maxDuration` in this app (280-300s) so a job already this old could
 * not still be legitimately in flight.
 */
const STALE_JOB_MS = 320_000;

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

export interface JobRecord<TResult> {
  status: "pending" | "done" | "error";
  startedAt: number;
  result?: TResult;
  error?: string;
  errorStatus?: number;
}

async function ensureJobBucket(supabase: SupabaseAdmin): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((bucket: { name: string }) => bucket.name === JOB_BUCKET)) return;

  const { error } = await supabase.storage.createBucket(JOB_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
}

async function writeJob(supabase: SupabaseAdmin, path: string, record: JobRecord<unknown>, upsert: boolean): Promise<{ error: Error | null }> {
  const body = Buffer.from(JSON.stringify(record), "utf-8");
  const { error } = await supabase.storage.from(JOB_BUCKET).upload(path, body, { contentType: "application/json", upsert });
  return { error: error as Error | null };
}

export async function readJob<TResult>(supabase: SupabaseAdmin, path: string): Promise<JobRecord<TResult> | null> {
  const { data, error } = await supabase.storage.from(JOB_BUCKET).download(path);
  if (error || !data) return null;
  try {
    const text = Buffer.from(await data.arrayBuffer()).toString("utf-8");
    return JSON.parse(text) as JobRecord<TResult>;
  } catch {
    return null;
  }
}

function isStalePending(job: JobRecord<unknown>): boolean {
  return job.status === "pending" && Date.now() - job.startedAt > STALE_JOB_MS;
}

export type ClaimResult<TResult> = { claimed: true } | { claimed: false; existing: JobRecord<TResult> };

/**
 * Attempts to atomically claim the right to start fresh background work for
 * `path`. Returns `{claimed: true}` only when this caller is the one that
 * should call `waitUntil(...)` next — either nothing existed yet (the
 * `upsert: false` create is atomic: exactly one concurrent caller can ever
 * win it), or the existing job was stale/errored and safe to restart
 * (a small, bounded residual race window here — same class of risk this
 * codebase already accepts for bucket-creation races, see
 * ensurePodcastBucket's own comment). Every other caller gets
 * `{claimed: false, existing}` and should just report on `existing` instead
 * of starting duplicate (real, billed) work.
 */
export async function claimJob<TResult>(supabase: SupabaseAdmin, path: string): Promise<ClaimResult<TResult>> {
  await ensureJobBucket(supabase);
  const freshMarker: JobRecord<TResult> = { status: "pending", startedAt: Date.now() };

  const created = await writeJob(supabase, path, freshMarker, false);
  if (!created.error) return { claimed: true };

  const existing = await readJob<TResult>(supabase, path);
  if (!existing) {
    // The atomic create failed for some OTHER reason (a real Storage error,
    // not "already exists") and there's nothing readable to report on
    // either — surface this as an immediate, honest error rather than
    // silently retrying forever.
    return { claimed: false, existing: { status: "error", startedAt: Date.now(), error: "Impossible de créer ou lire l'état de la tâche." } };
  }
  if (existing.status === "done") return { claimed: false, existing };
  if (existing.status === "error" || isStalePending(existing)) {
    const overwritten = await writeJob(supabase, path, freshMarker, true);
    if (!overwritten.error) return { claimed: true };
    return { claimed: false, existing };
  }
  // Still genuinely pending and fresh — an earlier call already started it.
  return { claimed: false, existing };
}

export async function completeJob<TResult>(supabase: SupabaseAdmin, path: string, result: TResult): Promise<void> {
  await writeJob(supabase, path, { status: "done", startedAt: Date.now(), result }, true);
}

export async function failJob(supabase: SupabaseAdmin, path: string, error: string, errorStatus: number): Promise<void> {
  await writeJob(supabase, path, { status: "error", startedAt: Date.now(), error, errorStatus }, true);
}
