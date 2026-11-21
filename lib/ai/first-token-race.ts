/**
 * HEDGED FIRST-TOKEN RACE — how both Copilots (app/api/dashboard-assistant,
 * app/api/courses/chat) pick the model that answers, since 2026-11-21.
 *
 * Why it exists. The Copilots used to try their models ONE AFTER THE OTHER:
 * the free Omni model first (a reasoning model whose first visible word only
 * comes after its hidden thinking), and only once it had FAILED — an error,
 * or 25 s without a single visible word — the paid fallback, then the free
 * chain. A slow Omni therefore cost the student up to 25 s of an empty bubble
 * before the fallback was even asked, and every fallback paid its own full
 * time-to-first-token on top. That sequential wait was the slowness students
 * reported.
 *
 * What it does instead. The candidates keep their product order (Omni →
 * paid fallback → free chain), but a candidate no longer waits for the one
 * before it to FAIL:
 *  - each candidate has a start time (`startAfterMs`): if no candidate has
 *    produced a visible word by then, it starts IN PARALLEL with those still
 *    thinking (a "hedged request");
 *  - the moment every started candidate has failed, the next one starts at
 *    once, whatever its start time (fail-fast promotion — a saturated free
 *    endpoint answers 429 immediately, there is no reason to wait);
 *  - the FIRST candidate to produce a visible word wins; every other one is
 *    cancelled at once (its upstream request aborted, so no tokens are spent
 *    for nothing).
 *
 * Gates. A candidate may depend on a check that is still running (the
 * student's quota, the shared free-tier capacity): `gate` resolves to whether
 * it may run at all. A `speculative` candidate opens its stream BEFORE its
 * gate resolves — the model's own time-to-first-token then overlaps the
 * database round trips instead of following them — but it can only WIN once
 * its gate said yes; a gate that says no cancels it before a single byte
 * reaches the student. A non-speculative candidate waits for its gate before
 * opening anything.
 *
 * Commit. `commit` runs when a candidate has its first visible word and is
 * about to win — e.g. reserving one of the student's daily premium messages
 * for the paid fallback. The reservation is therefore only ever spent by the
 * model that actually answers; a refused commit counts as that candidate
 * failing. Claims are serialized: two candidates whose first words arrive
 * together never both win.
 *
 * Pure (no I/O of its own, no app imports): unit-tested on its own with fake
 * streams and a fake clock.
 */

export interface FirstTokenCandidate {
  /** Shown in logs only (never to a student). */
  label: string;
  /**
   * Milliseconds after the race starts at which this candidate joins, if no
   * candidate has produced a visible word yet. May be a promise when the
   * right moment depends on a check still running (it is then counted from
   * the race start all the same). Fail-fast promotion ignores it.
   */
  startAfterMs: number | Promise<number>;
  /** How long, from its own start, this candidate gets to produce its first visible bytes. */
  firstTokenTimeoutMs: number;
  /** Whether this candidate may run at all (quota / capacity). Defaults to yes. */
  gate?: Promise<boolean>;
  /** Open the stream before `gate` resolves (it still has to resolve true for this candidate to win). */
  speculative?: boolean;
  /** Opens the model's stream. `signal` aborts the upstream request when the candidate loses. */
  open(signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
  /** Last check before winning (e.g. reserve a paid message); false = this candidate fails instead. */
  commit?(): Promise<boolean>;
}

export type AttemptOutcome = "won" | "failed" | "cancelled" | "skipped" | "not-started";

export interface RaceAttempt {
  label: string;
  outcome: AttemptOutcome;
  /** Ms after the race start, when this candidate started (null if it never did). */
  startedAtMs: number | null;
  /** Ms after the race start, when it won / failed / was cancelled. */
  settledAtMs: number | null;
  error?: string;
}

export interface RaceOutcome {
  /** The winner's stream: its first visible chunk, then the rest, as it arrives. */
  stream: ReadableStream<Uint8Array>;
  label: string;
  index: number;
  /** Ms after the race start when the winner's first visible bytes arrived. */
  firstTokenMs: number;
  attempts: RaceAttempt[];
}

export class RaceFailedError extends Error {
  /** The last real error a candidate raised (null when every candidate was only gated out). */
  lastError: unknown;
  attempts: RaceAttempt[];
  constructor(lastError: unknown, attempts: RaceAttempt[]) {
    super(lastError instanceof Error ? lastError.message : "Aucun modèle n'a pu répondre.");
    this.lastError = lastError;
    this.attempts = attempts;
  }
}

export class FirstTokenTimeoutError extends Error {
  status = 504;
  constructor(ms: number) {
    super(`Aucune réponse du modèle en ${Math.round(ms / 1000)} s.`);
  }
}

export class EmptyStreamError extends Error {
  status = 502;
  constructor() {
    super("Le modèle a terminé sans rien écrire.");
  }
}

export interface RaceHandle {
  /** Resolves with the winner; rejects with RaceFailedError (every candidate failed) or the abort reason. */
  promise: Promise<RaceOutcome>;
  /** Cancels every candidate (e.g. the request was refused by a quota gate). Safe to call at any time, even after a win (no-op then). */
  abort(reason?: string): void;
}

type State = "pending" | "running" | "failed" | "cancelled" | "skipped" | "won";

const RACE_ABORTED = "race-aborted";

export function raceFirstToken(candidates: FirstTokenCandidate[], clock: () => number = () => Date.now()): RaceHandle {
  const t0 = clock();
  const elapsed = () => clock() - t0;
  const states: State[] = candidates.map(() => "pending");
  const controllers: (AbortController | null)[] = candidates.map(() => null);
  const readers: (ReadableStreamDefaultReader<Uint8Array> | null)[] = candidates.map(() => null);
  const attempts: RaceAttempt[] = candidates.map((c) => ({ label: c.label, outcome: "not-started", startedAtMs: null, settledAtMs: null }));
  const timers: ReturnType<typeof setTimeout>[] = [];
  let decided = false;
  let lastError: unknown = null;
  let claimChain: Promise<void> = Promise.resolve();

  let resolveRace!: (outcome: RaceOutcome) => void;
  let rejectRace!: (error: unknown) => void;
  const promise = new Promise<RaceOutcome>((resolve, reject) => {
    resolveRace = resolve;
    rejectRace = reject;
  });
  // A caller that aborts and never awaits must not see an unhandled rejection.
  promise.catch(() => undefined);

  const settleAttempt = (i: number, state: State, outcome: AttemptOutcome, error?: unknown) => {
    states[i] = state;
    attempts[i].outcome = outcome;
    attempts[i].settledAtMs = elapsed();
    if (error !== undefined) attempts[i].error = error instanceof Error ? error.message : String(error);
  };

  /** Stops candidate i's upstream work (request in flight, or a stream already open). */
  const stop = (i: number) => {
    controllers[i]?.abort();
    const reader = readers[i];
    if (reader) void reader.cancel().catch(() => undefined);
  };

  const finishIfExhausted = () => {
    if (decided) return;
    const anyLeft = states.some((s) => s === "pending" || s === "running");
    if (anyLeft) return;
    decided = true;
    timers.forEach(clearTimeout);
    rejectRace(new RaceFailedError(lastError, attempts));
  };

  /** Every started candidate has failed: start the next pending one now (fail-fast promotion). */
  const promote = () => {
    if (decided) return;
    if (states.some((s) => s === "running")) return;
    const next = states.indexOf("pending");
    if (next === -1) return finishIfExhausted();
    start(next);
  };

  const fail = (i: number, error: unknown, state: State = "failed") => {
    if (states[i] !== "running") return;
    stop(i);
    if (state === "failed" && !(error instanceof Error && error.message === RACE_ABORTED)) lastError = error;
    settleAttempt(i, state, state === "skipped" ? "skipped" : state === "cancelled" ? "cancelled" : "failed", error);
    promote();
    finishIfExhausted();
  };

  const claim = (i: number, head: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>, candidate: FirstTokenCandidate) => {
    claimChain = claimChain.then(async () => {
      if (decided || states[i] !== "running") return void stop(i);
      try {
        if (candidate.gate && candidate.speculative && !(await candidate.gate)) return fail(i, new Error("gate refused"), "skipped");
        if (decided || states[i] !== "running") return void stop(i);
        if (candidate.commit && !(await candidate.commit())) return fail(i, new Error("commit refused"));
      } catch (error) {
        return fail(i, error);
      }
      if (decided || states[i] !== "running") return void stop(i);
      decided = true;
      timers.forEach(clearTimeout);
      settleAttempt(i, "won", "won");
      const firstTokenMs = attempts[i].settledAtMs ?? elapsed();
      candidates.forEach((_, j) => {
        if (j === i) return;
        if (states[j] === "running") {
          stop(j);
          settleAttempt(j, "cancelled", "cancelled");
        }
      });
      resolveRace({ stream: replay(head, reader), label: candidate.label, index: i, firstTokenMs, attempts });
    });
  };

  const start = (i: number) => {
    if (decided || states[i] !== "pending") return;
    states[i] = "running";
    attempts[i].startedAtMs = elapsed();
    const candidate = candidates[i];
    const controller = new AbortController();
    controllers[i] = controller;

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      fail(i, new FirstTokenTimeoutError(candidate.firstTokenTimeoutMs));
    }, candidate.firstTokenTimeoutMs);
    timers.push(timer);

    void (async () => {
      try {
        if (candidate.gate && !candidate.speculative && !(await candidate.gate)) {
          clearTimeout(timer);
          return fail(i, new Error("gate refused"), "skipped");
        }
        if (candidate.gate && candidate.speculative) {
          // A refusal stops the speculative call at once, whether or not its stream is open yet.
          void candidate.gate.then(
            (ok) => {
              if (!ok) fail(i, new Error("gate refused"), "skipped");
            },
            (error) => fail(i, error)
          );
        }
        if (states[i] !== "running") return void clearTimeout(timer);
        const stream = await candidate.open(controller.signal);
        if (states[i] !== "running" || decided) {
          clearTimeout(timer);
          void stream.cancel().catch(() => undefined);
          return;
        }
        const reader = stream.getReader();
        readers[i] = reader;
        for (;;) {
          const { done, value } = await reader.read();
          if (states[i] !== "running" || timedOut) return void clearTimeout(timer);
          if (done) {
            clearTimeout(timer);
            return fail(i, new EmptyStreamError());
          }
          if (value && value.byteLength > 0) {
            clearTimeout(timer);
            return claim(i, value, reader, candidate);
          }
        }
      } catch (error) {
        clearTimeout(timer);
        if (states[i] === "running") fail(i, error);
      }
    })();
  };

  const schedule = (i: number, startAfterMs: number) => {
    if (decided || states[i] !== "pending") return;
    const wait = startAfterMs - elapsed();
    if (wait <= 0) return start(i);
    timers.push(
      setTimeout(() => {
        if (!decided && states[i] === "pending") start(i);
      }, wait)
    );
  };
  candidates.forEach((candidate, i) => {
    if (typeof candidate.startAfterMs === "number") schedule(i, candidate.startAfterMs);
    // A start time that cannot be computed is no start time: the candidate is then only started by promotion.
    else candidate.startAfterMs.then((ms) => schedule(i, ms), () => undefined);
  });
  if (candidates.length === 0) finishIfExhausted();

  return {
    promise,
    abort(reason = RACE_ABORTED) {
      if (decided) return;
      decided = true;
      timers.forEach(clearTimeout);
      candidates.forEach((_, i) => {
        if (states[i] === "running") {
          stop(i);
          settleAttempt(i, "cancelled", "cancelled");
        }
      });
      rejectRace(new Error(reason));
    },
  };
}

/** The winner's stream: the chunk already read, then the rest of `reader` as it arrives. */
function replay(head: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(head);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else if (value && value.byteLength > 0) controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** One log-friendly line: "omni:cancelled@0→4710 | paid:won@4500→6420". */
export function describeAttempts(attempts: RaceAttempt[]): string {
  return attempts
    .filter((a) => a.outcome !== "not-started")
    .map((a) => `${a.label}:${a.outcome}@${a.startedAtMs ?? "-"}→${a.settledAtMs ?? "-"}${a.error && a.outcome === "failed" ? `(${a.error.slice(0, 60)})` : ""}`)
    .join(" | ");
}
