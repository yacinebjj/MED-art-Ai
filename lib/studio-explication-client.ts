"use client";

import { postJsonWithHeartbeat } from "@/lib/heartbeat-fetch";
import { AiRunGovernor, classifyUpstreamStatus, type GovernorStopReason } from "@/lib/ai-run-governor";
import {
  buildVariantKey,
  clearResumableRun,
  loadResumableParts,
  saveResumableParts,
  type ResumeIdentity,
} from "@/lib/studio-explication-resume";

/**
 * Browser-side driver for the client-driven, multi-request Explication
 * pipeline — see lib/studio-explication-delta.ts's ARCHITECTURE comment and
 * app/api/studio/generate/explication-start/route.ts's own header comment
 * for the full rationale (replaces a single in-process server call/loop that
 * was the real cause of repeated "échec de génération" + truncation on long
 * "ultra-détaillée" generations: a multi-minute generation could not
 * reliably survive Vercel's own real serverless duration ceiling, which can
 * be far tighter than this app's own `maxDuration` config).
 *
 * Four-step contract, in order:
 *  1. POST explication-start EXACTLY ONCE, never retried by this driver.
 *     Either resolves the whole generation immediately (cache hit /
 *     cross-university-delta — `needsFinalize: false`), or reserves quota
 *     and returns `{reserved: true, totalParts}`. A code review
 *     caught a real quota-integrity bug in an earlier version where this
 *     reservation step WAS retried (bundled with the slow AI call) —
 *     reserving 2-3x courseCap for one delivered generation. Never retrying
 *     this call, and only ever treating a reservation as real when this
 *     call explicitly confirms it, is what closes that.
 *  2. Every part: POST explication-part, CONCURRENTLY — every missing
 *     partIndex fired at once instead of one-at-a-time, bounded by
 *     MAX_CONCURRENT_REQUESTS (see its own comment for why this isn't
 *     unbounded) — see runGenerationInParts. Each streams a heartbeat over
 *     one held-open connection for the whole real ~30-150+ second generation
 *     time (see that route's own header comment for the full,
 *     three-architecture history behind why this — not a background-job/
 *     poll design — is the one actually proven reliable). Automatic retry
 *     on any clean, retryable failure — safe to retry freely because this
 *     route never touches quota (see its own header comment). Each retry
 *     only ever redoes the ONE part that failed, never the whole generation.
 *  3. Once every part has succeeded: POST explication-stitch, once per SEAM
 *     between two adjacent parts, same bounded concurrency — see
 *     stitchSeams. Product decision, explicitly accepting the trade-off this
 *     creates (see stitchSeams' own comment): concurrent generation means a
 *     part can no longer see the immediately-preceding part's actual text
 *     while it's being written, so this is an after-the-fact repair pass
 *     instead of the old in-flight `previousPartTail` continuity signal.
 *     Best-effort — a failed stitch call never fails the whole generation,
 *     it just leaves that one seam unrepaired.
 *  4. POST explication-finalize once, only if step 1 returned
 *     `needsFinalize: true` — assembles + persists the (stitched) parts.
 *
 * If the whole flow gives up (step 1 failed, or step 2/4 exhausted every
 * retry), calls explication-abandon EXACTLY ONCE, but ONLY when step 1
 * explicitly confirmed `reserved: true` — never when step 1 itself failed
 * (nothing to refund) or was never reached (a pure network failure before
 * any response arrived).
 *
 * CRASH-RESUME across step 2. Completed parts used to live ONLY in an
 * in-memory array here, so anything that killed this driver mid-run — a part
 * exhausting its retries, a reload, mobile Chrome evicting a backgrounded tab
 * — destroyed every part already generated and forced the next attempt to
 * start again from part 0, re-billing work that had already succeeded. Each
 * completed part is now checkpointed (see lib/studio-explication-resume.ts)
 * and a later run resumes only the parts still missing. The checkpoint is
 * bound to explication-start's `sourceFingerprint`, so it is silently
 * discarded — never partially reused — if the course's source text, language
 * or custom prompt changed in the meantime. The checkpoint is SPARSE (an
 * index can complete out of order now that generation is concurrent), unlike
 * the old sequential-prefix shape — see that module's own v2 comment.
 *
 * Note this does NOT reuse the original quota reservation: a resumed run
 * calls explication-start again and so reserves again, exactly as a plain
 * retry always has. Resume is therefore never more expensive in quota than
 * the retry it replaces, and is dramatically cheaper in time and tokens.
 * Reusing the original reservation needs server-side part storage, which
 * needs a schema migration — see the resume module's own header comment.
 */

export interface ExplicationGenerationResult {
  success: boolean;
  data?: unknown;
  cached?: boolean;
  cacheMode?: string;
  error?: string;
}

/**
 * Aggregate progress across every part CURRENTLY in flight — replaces the
 * old single-part view (partIndex/attempt/subPart...) now that parts
 * generate concurrently instead of one at a time, so there is no longer one
 * "current" part to describe. `isRecovering` is true whenever ANY in-flight
 * part is on a retry or a post-timeout subdivision, so the UI can still show
 * "je réessaie" instead of looking frozen.
 */
export interface ExplicationGenerationProgress {
  completedParts: number;
  totalParts: number;
  /** How many parts are actively generating right now (0 once every part has succeeded). */
  inFlightParts: number;
  isRecovering: boolean;
  /** "generating" while parts are being produced, "stitching" during the post-pass that repairs seams between independently-generated parts. */
  phase: "generating" | "stitching";
}

const MAX_PART_ATTEMPTS = 3;
// Exponential backoff (2s, 6s, 18s) rather than the previous near-flat
// 2s/5s — a retry that fires while the upstream provider is still degraded
// just burns another full attempt against the same condition.
const PART_RETRY_BASE_DELAY_MS = 2000;
const PART_RETRY_BACKOFF_FACTOR = 3;

/**
 * How far a single part may be subdivided after timing out: 1 (whole) -> 2
 * -> 4 -> 8.
 *
 * IMPORTANT, so this isn't mistaken for the primary defence: live evidence
 * proved subdivision alone does NOT fix a timeout here. A part timed out at
 * ~200s, its half timed out at ~200s, and its quarter (≈1,500 chars of
 * source) timed out at ~200s too — because generation time was bounded by
 * the max_tokens ceiling, not by input size (the system prompt orders the
 * model never to stop for length, so it generated flat out to the ceiling
 * whatever it was given). That is fixed at the source now: a concrete
 * per-part word budget plus a much lower EXPLICATION_PART_MAX_TOKENS (see
 * lib/studio-explication-delta.ts).
 *
 * Subdivision stays as a genuine safety net for the case where one slice
 * really does carry more content than its budget can cover — raised to 8 so
 * that net is deeper — but it is no longer load-bearing, and going wider
 * would not have helped on its own.
 */
const MAX_SUBDIVISION = 8;

function backoffDelayMs(attempt: number): number {
  return PART_RETRY_BASE_DELAY_MS * Math.pow(PART_RETRY_BACKOFF_FACTOR, attempt - 1);
}
// explication-start/-finalize/-stitch are still plain, synchronous
// request/response calls (fast — DB reads/writes only, or a tiny two-excerpt
// AI call, never a fresh long-form generation) — each client-side timeout is
// kept ABOVE its route's own `maxDuration`, same margin discipline as
// everywhere else in this app: explication-start is never retried by this
// driver (see this file's header comment), so if the client gave up BEFORE
// the server could possibly finish, it would have no way to know whether a
// reservation happened right as it stopped waiting.
const START_FETCH_TIMEOUT_MS = 70_000;
const FINALIZE_FETCH_TIMEOUT_MS = 70_000;
const STITCH_FETCH_TIMEOUT_MS = 70_000;
// explication-part streams heartbeats over one held-open connection for the
// whole real generation time (see that route's own header comment for why
// this — not a background-job/poll design — is the architecture actually
// proven reliable this session). Kept comfortably above the route's own
// maxDuration=280 so a genuine platform kill (not client impatience) is the
// only way this client-side timeout fires first.
const PART_FETCH_TIMEOUT_MS = 300_000;

// How much of each side of a seam is shown to explication-stitch — long
// enough to reliably include a full heading + its opening paragraph on
// either side (what a duplicated/restarted chapter actually looks like),
// short and cheap enough that firing one of these per seam, all concurrently,
// is negligible next to the parts they stitch together. See
// buildExplicationSeamStitchPrompt (lib/prompts/public-course-sections.ts)
// for the full rationale on why this pass exists at all.
const SEAM_WINDOW_CHARS = 1500;

/**
 * Concurrency ceiling for BOTH the part fan-out and the seam-stitch fan-out
 * below — deliberately NOT "fire every part/seam at once" despite generation
 * itself being fully concurrent now. Two independent reasons this cap exists,
 * not one:
 *
 *  1. THIS APP'S OWN PER-USER RATE LIMIT. explication-part and
 *     explication-stitch each enforce RATE_LIMITS.ai (20 requests/5min) PER
 *     ROUTE PER USER (lib/rate-limit.ts). computeExplicationSlices runs on
 *     the FULL raw_text, uncapped by MAX_SOURCE_CHARS (see
 *     app/api/studio/generate/explication-start/route.ts) — a genuinely
 *     large upload can produce well over 20 parts, so firing literally every
 *     missing part at once could trip the student's OWN rate limit against
 *     their OWN generation, which unbounded concurrency would make worse,
 *     not better.
 *  2. OpenRouter/DeepSeek's real per-account concurrency tolerance for a
 *     sudden burst from ONE course has never been measured live (every call
 *     site in this app was one-at-a-time until this pipeline). A bounded
 *     pool is the conservative first real-world test of concurrent calls
 *     from this account — raise this once that's confirmed safe in
 *     production, per this codebase's standing "confirm it live, don't
 *     assume" discipline (see lib/ai/openrouter.ts's own model-choice
 *     comments for the same discipline applied elsewhere).
 *
 * A pool this size still gives close to the full speedup for the common
 * case (totalParts ⩽ this constant generates in one wave, i.e. wall-clock ≈
 * one part's generation time instead of totalParts × that time) and degrades
 * gracefully — never catastrophically — for an unusually large course.
 */
const MAX_CONCURRENT_REQUESTS = 8;

/**
 * RUN GOVERNOR (lib/ai-run-governor.ts) — added after a real production
 * report: one Explication spun for 20+ minutes, then failed with "MedArt
 * Neural Engine est très sollicité" (an upstream 429) after 11 attempts.
 * Nothing bounded the run as a whole: a part timing out was subdivided into
 * 2, 4, then 8 SEQUENTIAL sub-parts, each with its own retries and its own
 * ~180 s server ceiling (worst case ≈ 45 min for ONE part), while up to 8
 * parts kept hitting an already-saturated provider in parallel. The
 * endpoints and models are unchanged; the governor only decides when and
 * whether the next request is sent:
 *  - RUN_BUDGET_MS (12 min: 3 waves of parts for a 20+ part polycopié): hard
 *    ceiling for the whole generation. No attempt starts
 *    with less than MIN_ATTEMPT_WINDOW_MS left, and each request's own
 *    timeout is clamped to the budget that remains.
 *  - adaptive concurrency: a 429/503 halves the requests in flight and pauses
 *    new ones (Retry-After honoured); each success adds a slot back.
 *  - circuit breaker: BREAKER_THRESHOLD consecutive upstream failures stop
 *    the run at once (fail fast) rather than waiting out the budget.
 * Every finished part stays checkpointed, so stopping early never loses
 * work: the next run only generates what is missing.
 */
const RUN_BUDGET_MS = 12 * 60_000;
const MIN_ATTEMPT_WINDOW_MS = 45_000;
const BREAKER_THRESHOLD = 3;
/** Total requests one part may spend across retries and subdivision, whatever the budget left. */
const MAX_REQUESTS_PER_PART = 8;

/** Student-facing failure text: what happened, what is already saved, and what to do — never a raw transport trace. */
function stopMessage(reason: GovernorStopReason | "failed", completed: number, total: number, detail?: string): string {
  const saved =
    completed > 0
      ? ` ${completed}/${total} partie${completed > 1 ? "s sont" : " est"} déjà prête${completed > 1 ? "s" : ""} et sauvegardée${completed > 1 ? "s" : ""} : relance la génération, seules les parties manquantes seront produites.`
      : " Rien n'a été perdu : relance la génération dans quelques minutes.";
  if (reason === "overload") return `MedArt Neural Engine est saturé en ce moment (forte demande).${saved}`;
  if (reason === "deadline") return `La génération prend plus de temps que prévu, je l'ai arrêtée pour ne pas te faire attendre.${saved}`;
  return `Une partie du cours n'a pas pu être générée${detail ? ` (${detail})` : ""}.${saved}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` over every item, at most `limit` in flight at once — a simple
 * worker-pool, not a library dependency, since this is the only place in the
 * app that needs bounded fan-out. Order-preserving in the RETURNED array
 * (`results[i]` always corresponds to `items[i]`) even though completion
 * order is not guaranteed, so callers can safely zip results back against
 * their inputs.
 */
async function mapWithConcurrencyLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 4xx client errors (bad request, forbidden/quota) are never retried —
 * retrying the exact same broken request just wastes attempts and delays
 * the real error reaching the student. Everything else (network failure,
 * 5xx, a clean timeout) is retryable.
 *
 * 401 IS THE ONE DELIBERATE EXCEPTION, added after a real, confirmed
 * production incident matching this exact symptom on mobile: a persistent
 * "échec de génération" with no truncation and no timeout involved. See
 * lib/supabase/session-server.ts's own header comment for the full
 * mechanism — Supabase rotates refresh tokens on use (single-use), so TWO
 * genuinely concurrent authenticated requests sharing the same
 * not-yet-refreshed session cookie (this app's own architecture explicitly
 * allows a Studio generation to keep running in the background while the
 * student navigates elsewhere or opens another tile — see
 * trackGeneration's "survives navigation" design) can race: one wins and
 * gets a fresh rotated cookie written back to the browser, the other
 * hard-fails with "Invalid Refresh Token: Already Used". That failure is
 * PERMANENT for the token that just died, but NOT for the session as a
 * whole — the browser's cookie has already been updated by the winning
 * response by the time a retry (after this file's own 2s/5s backoff) fires,
 * so simply trying again, now carrying the browser's current cookie, is
 * genuinely likely to succeed rather than repeat the same failure. Treating
 * 401 as a hard, permanent stop (the previous behavior) meant losing the
 * WHOLE multi-minute generation to a one-time, self-resolving race that a
 * single retry would have survived.
 *
 * This race is now MORE likely, not less, now that every part fires
 * concurrently instead of one at a time — exactly the scenario this
 * exception already exists for, just at higher odds.
 */
function isRetryable(status: number): boolean {
  // 429 is retryable too now: the run governor paces the retry (Retry-After,
  // halved concurrency) and its circuit breaker stops a sustained overload.
  return status === 0 || status === 401 || status === 429 || status >= 500;
}

async function abandon(courseId: number): Promise<void> {
  try {
    await postJson("/api/studio/generate/explication-abandon", { courseId }, 15_000);
  } catch {
    // Best-effort — a failed refund call must never mask the real error
    // already being returned to the caller below.
  }
}

/**
 * Minimal wrapper around the standard Screen Wake Lock API
 * (https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) —
 * added defensively after a real production report of "échec de génération"
 * on mobile specifically (not PC), for the exact same course pipeline. The
 * overall flow still spans several minutes for a multi-part course while the
 * student waits — requesting a wake lock keeps the screen on for that
 * duration, a cheap, well-supported mitigation against a mobile browser
 * throttling a backgrounded tab if the student's screen locks mid-wait.
 * Feature-detected and best-effort throughout: a browser without support (or
 * a user who denies it) just gets no wake lock, never an error — this is a
 * defensive improvement, not a load-bearing requirement for correctness.
 */
async function acquireWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock) return null;
    return await nav.wakeLock.request("screen");
  } catch {
    return null;
  }
}

type OnePartOutcome = { ok: true; markdown: string } | { ok: false; error: string; stoppedBy?: GovernorStopReason };

interface PartStatus {
  attempt: number;
  subPartIndex: number;
  subPartCount: number;
  isRecovering: boolean;
}

/**
 * Generates ONE part, with two distinct recovery strategies chosen by what
 * actually went wrong — this is the "make the frontend actually resilient"
 * layer, and the distinction matters more than the retry count:
 *
 *  - A TIMEOUT (504, the server's own AbortController firing because the
 *    model could not finish this much source in time) is NOT retried
 *    identically. Re-sending the same slice hits the same wall for the same
 *    reason — it is real generation time, not a flake. Instead the part is
 *    subdivided (whole -> halves -> quarters) and the pieces are generated
 *    sequentially and concatenated. Each piece is strictly less work, so
 *    each is strictly likelier to land inside the budget.
 *  - Any OTHER retryable failure (network drop, 5xx, the single-use-refresh-
 *    token 401 race) IS retried identically, with exponential backoff —
 *    those genuinely are transient and the same request can succeed.
 *
 * Every attempt reports through onStatus, so the caller can aggregate a
 * cross-part view for the UI ("je réessaie…" instead of a frozen spinner)
 * instead of sitting frozen for minutes. The error returned on final give-up
 * names how many attempts were actually burned, so a future report can never
 * again be ambiguous about whether retries happened at all.
 *
 * Deliberately does NOT accept cross-part continuity context anymore (the
 * old `previousPartTail` param) — parts now generate concurrently, so the
 * immediately-preceding part's real text is not necessarily available yet
 * when this one starts. See stitchSeams for what replaces that signal.
 * Continuity WITHIN this part's own timeout-driven subdivision (a sub-piece
 * still sees the previous sub-piece's real text) is unaffected — that
 * sequencing is internal to one part and unrelated to cross-part ordering.
 */
async function generateOnePart(
  courseId: number,
  partIndex: number,
  totalParts: number,
  extra: { language?: string; customPrompt?: string },
  governor: AiRunGovernor,
  onStatus?: (status: PartStatus) => void
): Promise<OnePartOutcome> {
  let subPartCount = 1;
  let lastError = "La génération a échoué.";
  let totalAttempts = 0;

  for (;;) {
    const collected: string[] = [];
    let needsSmallerSlice = false;
    let gaveUp = false;

    for (let subPartIndex = 0; subPartIndex < subPartCount && !needsSmallerSlice && !gaveUp; subPartIndex++) {
      let subSucceeded = false;

      for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS && !subSucceeded; attempt++) {
        // Ask the governor first: it may pause (upstream pressure), or stop
        // the run (budget spent / provider down) — then nothing is sent.
        if (totalAttempts >= MAX_REQUESTS_PER_PART) {
          return { ok: false, error: `${lastError} (${totalAttempts} tentative(s))` };
        }
        if (!(await governor.acquire())) {
          return { ok: false, error: lastError, stoppedBy: governor.stopped ?? "deadline" };
        }
        totalAttempts++;
        onStatus?.({
          attempt,
          subPartIndex,
          subPartCount,
          isRecovering: attempt > 1 || subPartCount > 1,
        });

        // postJsonWithHeartbeat never throws — every outcome, including a raw
        // network failure mid-stream, comes back as a normal result carrying a
        // `diagnostic` string (see lib/heartbeat-fetch.ts's own comment) so a
        // failure surfaced to the student names concretely what happened,
        // instead of another guess from a bare "échec de génération".
        //
        // previousPartTail — continuity context WITHIN this part's own
        // subdivision only (the previous SUB-piece's real text). No longer
        // carries cross-part context — see this function's own doc comment.
        const previousPartTail = collected.length > 0 ? collected[collected.length - 1] : undefined;
        let outcome: Awaited<ReturnType<typeof postJsonWithHeartbeat>>;
        try {
          outcome = await postJsonWithHeartbeat(
            "/api/studio/generate/explication-part",
            {
              courseId,
              partIndex,
              ...(subPartCount > 1 ? { subPartIndex, subPartCount } : {}),
              previousPartTail,
              ...extra,
            },
            governor.timeoutFor(PART_FETCH_TIMEOUT_MS)
          );
        } finally {
          governor.release();
        }

        if (outcome.ok && outcome.data.success === true) {
          governor.reportSuccess();
          collected.push(String(outcome.data.partMarkdown ?? ""));
          subSucceeded = true;
          break;
        }
        const upstream = classifyUpstreamStatus(outcome.status);
        if (upstream) governor.reportUpstreamFailure(upstream, outcome.retryAfterSeconds);

        const baseError = typeof outcome.data.error === "string" ? outcome.data.error : `Erreur ${outcome.status}.`;
        lastError = `${baseError} [${outcome.diagnostic}]`;

        // Two DIFFERENT failures, one correct response: ask for less work.
        //  - 504: the server's own generation timeout (too slow for the budget).
        //  - truncated: the model hit the max_tokens ceiling mid-answer
        //    (too LONG for the budget). Arrives as status 502 like any other
        //    upstream error, which is exactly why it needs its own explicit
        //    flag — a verification pass caught that matching on 504 alone
        //    left truncation burning all 3 identical retries against a
        //    deterministic ceiling and then abandoning the whole
        //    generation, discarding every already-billed completed part.
        // Both are systematic, not flaky: an identical retry reproduces them
        // identically. Subdividing is the only retry that changes the odds.
        if (outcome.status === 504 || outcome.data.truncated === true) {
          needsSmallerSlice = true;
          break;
        }

        if (isRetryable(outcome.status) && attempt < MAX_PART_ATTEMPTS) {
          // Overload pauses are applied by the governor itself (next acquire()).
          if (upstream !== "overload") await wait(Math.min(backoffDelayMs(attempt), Math.max(0, governor.remainingMs() - MIN_ATTEMPT_WINDOW_MS)));
          continue;
        }

        gaveUp = true;
        break;
      }
    }

    if (!needsSmallerSlice && !gaveUp && collected.length > 0) {
      return { ok: true, markdown: collected.join("\n\n") };
    }
    if (gaveUp || !needsSmallerSlice) {
      return { ok: false, error: `${lastError} (${totalAttempts} tentative(s))` };
    }

    // Timed out — escalate to smaller pieces, or stop if already at the floor.
    if (subPartCount >= MAX_SUBDIVISION) {
      return {
        ok: false,
        error: `${lastError} (${totalAttempts} tentative(s), découpage jusqu'à ${subPartCount} sous-parties)`,
      };
    }
    subPartCount *= 2;
    await wait(backoffDelayMs(1));
  }
}

/**
 * Post-generation repair pass — see buildExplicationSeamStitchPrompt's own
 * doc comment (lib/prompts/public-course-sections.ts) for the full
 * rationale. Fires one request PER SEAM (N-1 seams for N parts), bounded
 * concurrently (see MAX_CONCURRENT_REQUESTS), each touching only the
 * last/first SEAM_WINDOW_CHARS of two adjacent parts.
 *
 * Best-effort by design: a network failure, a timeout, or a malformed
 * response on any one seam just leaves that seam's original (unstitched)
 * text in place — it can never fail or retry-loop the overall generation,
 * since the underlying content is already complete and valid, just possibly
 * carrying an un-repaired duplicate/restarted heading at that one boundary.
 *
 * KNOWN, ACCEPTED EDGE CASE: if a part's own length is shorter than
 * 2×SEAM_WINDOW_CHARS, the seam before it and the seam after it both see
 * (and may both want to rewrite) overlapping — in the extreme, identical —
 * spans of that same part. The two writes are applied independently and the
 * later one wins outright for the overlapping span; a real but rare case
 * (parts target 550-1800 words, i.e. comfortably longer than 2×1,500 chars
 * in practice — see buildPartLengthBudget in lib/studio-explication-delta.ts)
 * not worth the extra complexity of a proper merge for.
 */
async function stitchSeams(parts: string[]): Promise<string[]> {
  if (parts.length < 2) return parts;

  const seamIndices = parts.slice(0, -1).map((_, i) => i);
  const fixes = await mapWithConcurrencyLimit(seamIndices, MAX_CONCURRENT_REQUESTS, async (seamIndex) => {
    const tail = parts[seamIndex].slice(-SEAM_WINDOW_CHARS);
    const head = parts[seamIndex + 1].slice(0, SEAM_WINDOW_CHARS);
    try {
      const outcome = await postJson("/api/studio/generate/explication-stitch", { tail, head }, STITCH_FETCH_TIMEOUT_MS);
      if (!outcome.ok || outcome.data.success !== true) return null;
      const fixedTail = typeof outcome.data.tail === "string" ? outcome.data.tail : null;
      const fixedHead = typeof outcome.data.head === "string" ? outcome.data.head : null;
      if (fixedTail === null || fixedHead === null) return null;
      return { seamIndex, fixedTail, fixedHead };
    } catch {
      return null;
    }
  });

  const stitched = [...parts];
  for (const fix of fixes) {
    if (!fix) continue;
    const { seamIndex, fixedTail, fixedHead } = fix;
    stitched[seamIndex] = stitched[seamIndex].slice(0, -SEAM_WINDOW_CHARS) + fixedTail;
    stitched[seamIndex + 1] = fixedHead + stitched[seamIndex + 1].slice(SEAM_WINDOW_CHARS);
  }
  return stitched;
}

export async function generateExplicationInParts(
  courseId: number,
  extra: { language?: string; customPrompt?: string } = {},
  onProgress?: (progress: ExplicationGenerationProgress) => void
): Promise<ExplicationGenerationResult> {
  const wakeLock = await acquireWakeLock();
  try {
    return await runGenerationInParts(courseId, extra, onProgress);
  } finally {
    await wakeLock?.release().catch(() => {});
  }
}

async function runGenerationInParts(
  courseId: number,
  extra: { language?: string; customPrompt?: string },
  onProgress?: (progress: ExplicationGenerationProgress) => void
): Promise<ExplicationGenerationResult> {
  // Step 1 — reserve, exactly once, never retried FOR AMBIGUOUS OUTCOMES.
  // See this file's header comment for why a 5xx/network failure here is
  // never safely retryable (a reservation may have already happened,
  // server-side, before the response was lost). A 401 is the ONE
  // unambiguous exception: getAuthenticatedUser() is the very first thing
  // explication-start's route handler does, before touching quota/cache/
  // anything else, so a 401 here PROVES no reservation was even attempted —
  // there is nothing an unambiguous, one-time retry could double-charge.
  // Added after a confirmed production incident (see isRetryable's own
  // comment for the full mechanism: a genuinely-concurrent request racing
  // this app's own Supabase refresh-token rotation) — a single 401 here used
  // to permanently fail the whole flow before it ever started, even though
  // the browser's session cookie is very likely already valid again by the
  // time a short, deliberate retry fires.
  let startOutcome: { ok: boolean; status: number; data: Record<string, unknown> };
  try {
    startOutcome = await postJson("/api/studio/generate/explication-start", { courseId, ...extra }, START_FETCH_TIMEOUT_MS);
    if (startOutcome.status === 401) {
      await wait(1500);
      startOutcome = await postJson("/api/studio/generate/explication-start", { courseId, ...extra }, START_FETCH_TIMEOUT_MS);
    }
  } catch (error) {
    // Never reached the server (or the response never arrived) — no
    // confirmation of a reservation exists, so no abandon() call either.
    return { success: false, error: error instanceof Error ? error.message : "Erreur réseau." };
  }
  const startData = startOutcome.data;
  if (!startOutcome.ok || startData.success !== true) {
    // A clean error RESPONSE did arrive — explication-start's own contract
    // guarantees it already self-refunded internally for every path that
    // reserves-then-fails (see that route's header comment), so still no
    // abandon() call here.
    return { success: false, error: typeof startData.error === "string" ? startData.error : "La génération a échoué." };
  }
  if (startData.needsFinalize === false) {
    // Fully resolved by start itself (cache hit / cross-university-delta) —
    // nothing left to do. Any checkpoint left over from an earlier failed
    // run of this course is now permanently unreachable: drop it.
    clearResumableRun(courseId);
    return {
      success: true,
      data: startData.partMarkdown,
      cached: Boolean(startData.servedFromCache),
      cacheMode: typeof startData.cacheMode === "string" ? startData.cacheMode : undefined,
    };
  }
  // From here on, a reservation is confirmed to exist — abandon() is now the
  // correct thing to call if the rest of the flow fails.
  const totalParts = typeof startData.totalParts === "number" ? startData.totalParts : 1;

  // CRASH-RESUME. Parts already generated for this exact course+source+options
  // are reloaded from the previous, failed or interrupted run instead of being
  // regenerated — see lib/studio-explication-resume.ts for why this exists and
  // why it is bound to a fingerprint. `resume` is null when the server did not
  // send a fingerprint (an older deployment): with nothing to bind a
  // checkpoint to, this driver does not read or write one at all rather than
  // risk reusing parts across a changed course.
  const resume: ResumeIdentity | null =
    typeof startData.sourceFingerprint === "string" && startData.sourceFingerprint.length > 0
      ? {
          courseId,
          fingerprint: startData.sourceFingerprint,
          totalParts,
          variant: buildVariantKey(extra),
        }
      : null;

  // Sparse — see lib/studio-explication-resume.ts's v2 comment: an index can
  // complete out of order now that every missing part fires concurrently.
  const parts: (string | null)[] = resume ? loadResumableParts(resume) : new Array(totalParts).fill(null);
  const missingIndices: number[] = [];
  for (let i = 0; i < totalParts; i++) if (parts[i] === null) missingIndices.push(i);

  if (missingIndices.length > 0) {
    const completedFromResume = totalParts - missingIndices.length;
    let completedCount = completedFromResume;
    const activeStatusByPart = new Map<number, PartStatus>();
    let firstFailure: string | null = null;
    let stoppedBy: GovernorStopReason | null = null;
    const governor = new AiRunGovernor({
      deadlineMs: RUN_BUDGET_MS,
      maxConcurrency: MAX_CONCURRENT_REQUESTS,
      breakerThreshold: BREAKER_THRESHOLD,
      minAttemptWindowMs: MIN_ATTEMPT_WINDOW_MS,
    });

    const emitProgress = () => {
      onProgress?.({
        completedParts: completedCount,
        totalParts,
        inFlightParts: activeStatusByPart.size,
        isRecovering: governor.isThrottled || [...activeStatusByPart.values()].some((s) => s.isRecovering),
        phase: "generating",
      });
    };

    // CONCURRENT (bounded — see MAX_CONCURRENT_REQUESTS' own comment) rather
    // than sequential. See this file's header comment for the trade-off this
    // creates (no more in-flight `previousPartTail` continuity between
    // parts) and stitchSeams below for the repair pass that replaces it.
    // A part's own failure does not cancel its siblings — every already
    // in-flight part is left to finish (its work is real and already
    // billed), and only once everything has settled does a real failure
    // stop the generation, so nothing already-succeeded is ever discarded.
    await mapWithConcurrencyLimit(missingIndices, MAX_CONCURRENT_REQUESTS, async (partIndex) => {
      activeStatusByPart.set(partIndex, { attempt: 1, subPartIndex: 0, subPartCount: 1, isRecovering: false });
      emitProgress();

      const outcome = await generateOnePart(courseId, partIndex, totalParts, extra, governor, (status) => {
        activeStatusByPart.set(partIndex, status);
        emitProgress();
      });

      activeStatusByPart.delete(partIndex);
      if (outcome.ok) {
        parts[partIndex] = outcome.markdown;
        completedCount++;
        // Checkpoint after every part, not once at the end — the whole
        // point is to survive a process that never reaches the end.
        if (resume) saveResumableParts(resume, parts);
      } else {
        firstFailure = firstFailure ?? outcome.error;
        stoppedBy = stoppedBy ?? outcome.stoppedBy ?? governor.stopped;
      }
      emitProgress();
    });

    // Read back through a typed snapshot: both are assigned inside the worker
    // callbacks above, which TypeScript's flow analysis cannot see.
    const failure = firstFailure as string | null;
    const stopReason = stoppedBy as GovernorStopReason | null;
    if (failure) {
      // The raw per-attempt trace (status, heartbeats, attempt count) stays in the console for diagnosis.
      console.warn("[explication] Génération interrompue:", failure);
      const detail = failure.split(" [")[0].replace(/\s*\(\d+ tentative.*$/, "").trim();
      firstFailure = stopReason ? stopMessage(stopReason, completedCount, totalParts) : stopMessage("failed", completedCount, totalParts, detail);
      // Deliberately does NOT clear the checkpoint: everything generated so
      // far is exactly what makes the student's next attempt cheap, and it
      // stays valid as long as the course's source text does not change
      // (which the fingerprint independently enforces on read).
      await abandon(courseId);
      return { success: false, error: firstFailure };
    }
  }

  // Every part succeeded — every index is now a real string.
  const finishedParts = parts as string[];

  // Step 3 — repair the seams between independently-generated parts. See
  // stitchSeams' own comment: best-effort, never fails the run.
  onProgress?.({ completedParts: totalParts, totalParts, inFlightParts: 0, isRecovering: false, phase: "stitching" });
  const stitchedParts = await stitchSeams(finishedParts);

  // Assemble + persist. Retried on the same terms as a part (see
  // isRetryable's own comment, 401 included) — this is the single most
  // expensive point to lose the whole flow to a transient failure, since
  // every part's real, billed generation work is already done; finalize is a
  // pure DB write + a re-send of already-collected text, so retrying it is
  // always safe (never re-runs any AI call, never re-reserves quota).
  try {
    let finalizeOutcome: { ok: boolean; status: number; data: Record<string, unknown> } | null = null;
    let finalizeError = "La finalisation a échoué.";
    for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS; attempt++) {
      finalizeOutcome = await postJson(
        "/api/studio/generate/explication-finalize",
        { courseId, parts: stitchedParts, ...extra },
        FINALIZE_FETCH_TIMEOUT_MS
      );
      if (finalizeOutcome.ok && finalizeOutcome.data.success === true) break;
      finalizeError = typeof finalizeOutcome.data.error === "string" ? finalizeOutcome.data.error : `Erreur ${finalizeOutcome.status}.`;
      if (isRetryable(finalizeOutcome.status) && attempt < MAX_PART_ATTEMPTS) {
        await wait(backoffDelayMs(attempt));
        continue;
      }
      break;
    }
    if (!finalizeOutcome || !finalizeOutcome.ok || finalizeOutcome.data.success !== true) {
      await abandon(courseId);
      return { success: false, error: finalizeError };
    }
    // Persisted server-side — the checkpoint has done its job and must not
    // outlive the run that needed it. (The failure paths above deliberately
    // leave it in place instead.)
    clearResumableRun(courseId);
    return {
      success: true,
      data: finalizeOutcome.data.data,
      cached: false,
      cacheMode: typeof finalizeOutcome.data.cacheMode === "string" ? finalizeOutcome.data.cacheMode : undefined,
    };
  } catch (error) {
    await abandon(courseId);
    return { success: false, error: error instanceof Error ? error.message : "La finalisation a échoué." };
  }
}
