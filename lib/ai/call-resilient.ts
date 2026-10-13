/**
 * callOpenRouter with ONE automatic retry for a genuinely transient upstream
 * failure, so a provider hiccup doesn't surface to the student as an error
 * they have to retry by hand (and that, for the Lab tools, would otherwise
 * refund and re-ask).
 *
 * Retried: upstream 429 / 500 / 502 / 503 — fast failures where a second
 * attempt a moment later routinely succeeds. NOT retried:
 *  - 504 (our own timeout abort): the call already burned its whole time
 *    budget; a second one cannot fit inside the route's maxDuration.
 *  - 4xx other than 429 (bad request, auth, moderation): retrying repeats it.
 * The retry only happens while the first attempt failed quickly
 * (`RETRY_WINDOW_MS`), which is what keeps worst-case total time inside the
 * route's maxDuration: first attempt's full timeout, OR a fast failure plus
 * one more full attempt — never two full timeouts.
 */

import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import { modelCallKey, runThroughLedger, type LedgerSpec } from "@/lib/ai/generation-ledger";

type CallOptions = NonNullable<Parameters<typeof callOpenRouter>[1]>;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);
const RETRY_DELAY_MS = 1_500;
const RETRY_WINDOW_MS = 15_000;

export async function callOpenRouterResilient(
  messages: Parameters<typeof callOpenRouter>[0],
  options?: CallOptions
): Promise<string> {
  const startedAt = Date.now();
  try {
    return await callOpenRouter(messages, options);
  } catch (error) {
    const quickAndTransient =
      error instanceof OpenRouterError && RETRYABLE_STATUSES.has(error.status) && Date.now() - startedAt < RETRY_WINDOW_MS;
    if (!quickAndTransient) throw error;
    console.warn(`[openrouter] Échec transitoire (${(error as OpenRouterError).status}) — nouvel essai unique dans ${RETRY_DELAY_MS}ms.`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return callOpenRouter(messages, options);
  }
}

export interface ChainAttempt {
  model: string;
  /** Upper bound for this attempt; the chain lowers it to whatever remains of the deadline. */
  timeoutMs: number;
  /** Per-attempt overrides (e.g. a smaller output budget for a slower fallback model). */
  maxTokens?: number;
}

export interface ChainOptions<T> extends Omit<CallOptions, "model" | "timeoutMs" | "maxTokens"> {
  attempts: ChainAttempt[];
  maxTokens: number;
  /** Whole budget for the chain (keep it under the route's maxDuration minus DB/response work). */
  deadlineMs: number;
  /** Parse + validate the raw text; throw to reject it and move on to the next model. */
  validate: (raw: string) => T;
  /** Log prefix, e.g. "[studio:mindmap]". */
  label: string;
  /**
   * Opt-in generation ledger (lib/ai/generation-ledger.ts): the VALIDATED
   * result of this exact chain (same messages, same model ladder, same
   * output options) is produced once and replayed for identical requests —
   * concurrent duplicates included. Time spent waiting for a peer is taken
   * out of `deadlineMs`, so the route's own budget is never exceeded. Only
   * for requests where an identical input must give the same answer; the
   * value returned by `validate` must be JSON-serializable.
   */
  ledger?: Omit<LedgerSpec, "key">;
}

/** Below this, a new attempt cannot realistically produce a full answer — fail now instead of burning the rest of the budget. */
const MIN_ATTEMPT_MS = 12_000;

/**
 * Model fallback chain under ONE deadline — for generations a student waits
 * on (MedArt Lab, podcast script). Each attempt runs with
 * min(attempt.timeoutMs, time left before the deadline); ANY failure —
 * timeout, upstream error, truncated answer, or an answer `validate` rejects
 * (invalid JSON / schema) — moves on to the next model instead of surfacing
 * an error. Transient upstream errors on an attempt still get the quick
 * single retry of callOpenRouterResilient. Throws the LAST error only when
 * every model failed or the deadline is spent.
 */
export async function callOpenRouterChain<T>(messages: Parameters<typeof callOpenRouter>[0], options: ChainOptions<T>): Promise<{ value: T; model: string }> {
  const { ledger, ...chainOptions } = options;
  if (!ledger) return runChain(messages, chainOptions, Date.now());
  const outerStartedAt = Date.now();
  return runThroughLedger(
    {
      ...ledger,
      key: {
        call: modelCallKey(messages, {
          model: chainOptions.attempts.map((attempt) => `${attempt.model}@${attempt.maxTokens ?? chainOptions.maxTokens}`).join(">"),
          maxTokens: chainOptions.maxTokens,
          temperature: chainOptions.temperature,
          reasoning: chainOptions.reasoning,
          responseFormat: chainOptions.responseFormat,
        }),
      },
    },
    () => runChain(messages, chainOptions, outerStartedAt)
  );
}

async function runChain<T>(
  messages: Parameters<typeof callOpenRouter>[0],
  options: Omit<ChainOptions<T>, "ledger">,
  startedAt: number
): Promise<{ value: T; model: string }> {
  const { attempts, deadlineMs, validate, label, maxTokens, ...base } = options;
  let lastError: unknown = new Error("Aucun modèle disponible.");

  for (const [index, attempt] of attempts.entries()) {
    const remaining = deadlineMs - (Date.now() - startedAt);
    if (remaining < MIN_ATTEMPT_MS) break;
    const timeoutMs = Math.min(attempt.timeoutMs, remaining);
    try {
      const raw = await callOpenRouterResilient(messages, {
        ...base,
        model: attempt.model,
        maxTokens: attempt.maxTokens ?? maxTokens,
        timeoutMs,
      });
      const value = validate(raw);
      if (index > 0) console.warn(`${label} Généré par le modèle de secours ${attempt.model}.`);
      return { value, model: attempt.model };
    } catch (error) {
      lastError = error;
      const next = attempts[index + 1];
      console.warn(
        `${label} Échec avec ${attempt.model} après ${Math.round((Date.now() - startedAt) / 1000)}s${next ? ` — bascule sur ${next.model}` : ""} :`,
        error instanceof Error ? error.message : error
      );
    }
  }
  throw lastError;
}
