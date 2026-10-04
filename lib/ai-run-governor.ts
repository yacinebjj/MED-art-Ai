/**
 * Client-side governor for multi-request AI runs (Explication parts, audio
 * chunks). It sits ON TOP of the existing, proven endpoints — it never
 * changes what a request does, only WHEN and WHETHER the next one is sent:
 *
 *  - a hard DEADLINE for the whole run: no attempt starts once too little
 *    time is left, and every request's own timeout is clamped to what
 *    remains — a run can no longer stretch to 20+ minutes through
 *    subdivision × retries × timeouts;
 *  - ADAPTIVE CONCURRENCY (AIMD): the first sign of upstream overload (429 /
 *    503) halves the number of requests in flight and pauses new ones
 *    (honouring Retry-After); every success adds one slot back — the run
 *    backs off instead of hammering a saturated provider with 8 parallel
 *    requests;
 *  - a CIRCUIT BREAKER: after `breakerThreshold` consecutive upstream
 *    failures across the whole run, it stops early (fail fast) instead of
 *    burning the rest of the budget on a provider that is down.
 *
 * Callers keep their own per-request retry/subdivision logic and simply ask
 * the governor before each attempt and report each outcome.
 */

export type UpstreamFailureKind = "overload" | "server" | "network";
export type GovernorStopReason = "deadline" | "overload";

export interface GovernorOptions {
  /** Total wall-clock budget for the whole run. */
  deadlineMs: number;
  /** Requests allowed in flight at once when everything is healthy. */
  maxConcurrency: number;
  /** Consecutive upstream failures (any part/chunk) that trip the breaker. */
  breakerThreshold: number;
  /** An attempt is not started with less than this much budget left. */
  minAttemptWindowMs: number;
}

const OVERLOAD_BASE_PAUSE_MS = 12_000;
const OVERLOAD_MAX_PAUSE_MS = 60_000;
const POLL_MS = 250;

export class AiRunGovernor {
  private readonly startedAt = Date.now();
  private readonly options: GovernorOptions;
  private limit: number;
  private inFlight = 0;
  private pauseUntil = 0;
  private consecutiveFailures = 0;
  private overloadStreak = 0;
  private stopReason: GovernorStopReason | null = null;

  constructor(options: GovernorOptions) {
    this.options = options;
    this.limit = options.maxConcurrency;
  }

  remainingMs(): number {
    return this.options.deadlineMs - (Date.now() - this.startedAt);
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  /** Why the run must stop, or null while it may continue. */
  get stopped(): GovernorStopReason | null {
    if (!this.stopReason && this.remainingMs() < this.options.minAttemptWindowMs) this.stopReason = "deadline";
    return this.stopReason;
  }

  /** True while any request is paused because of upstream pressure. */
  get isThrottled(): boolean {
    return Date.now() < this.pauseUntil || this.limit < this.options.maxConcurrency;
  }

  /**
   * Waits for a free slot (respecting the current adaptive limit and any
   * overload pause). Resolves `true` with the slot taken, or `false` if the
   * run must stop — the caller then gives up without sending anything.
   */
  async acquire(): Promise<boolean> {
    for (;;) {
      if (this.stopped) return false;
      if (Date.now() >= this.pauseUntil && this.inFlight < this.limit) {
        this.inFlight++;
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  /** Per-request timeout: the request's own ceiling, clamped to the budget left. */
  timeoutFor(requestCeilingMs: number): number {
    return Math.max(1_000, Math.min(requestCeilingMs, this.remainingMs()));
  }

  reportSuccess(): void {
    this.consecutiveFailures = 0;
    this.overloadStreak = 0;
    if (this.limit < this.options.maxConcurrency) this.limit++;
  }

  reportUpstreamFailure(kind: UpstreamFailureKind, retryAfterSeconds?: number | null): void {
    // Requests that were already in flight when an overload pause began fail
    // on the SAME saturation episode: they count once, not once each — four
    // parallel parts hitting one 429 burst must not trip the breaker at once.
    const sameEpisode = kind === "overload" && Date.now() < this.pauseUntil;
    if (!sameEpisode) this.consecutiveFailures++;
    if (kind === "overload" && !sameEpisode) {
      this.overloadStreak++;
      this.limit = Math.max(1, Math.floor(this.limit / 2));
      // An explicit Retry-After (provider, or this app's own rate limiter) is
      // honoured as given; otherwise exponential 12 s → 60 s.
      const pause = retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : Math.min(OVERLOAD_MAX_PAUSE_MS, OVERLOAD_BASE_PAUSE_MS * 2 ** (this.overloadStreak - 1));
      this.pauseUntil = Date.now() + pause;
      // A pause that outlasts the budget can only end in a timeout: stop now instead.
      if (pause > this.remainingMs() - this.options.minAttemptWindowMs) this.stopReason = "deadline";
    }
    if (this.consecutiveFailures >= this.options.breakerThreshold) this.stopReason = "overload";
  }
}

/** Maps an HTTP-ish status to an upstream failure kind, or null when it is not the provider's fault. */
export function classifyUpstreamStatus(status: number): UpstreamFailureKind | null {
  if (status === 429 || status === 503 || status === 529) return "overload";
  if (status === 0) return "network";
  if (status >= 500 && status !== 504) return "server";
  return null;
}
