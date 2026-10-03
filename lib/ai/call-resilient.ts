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
