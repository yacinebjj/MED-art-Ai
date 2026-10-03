import { CHEAP_MODEL, LAB_FALLBACK_MODEL, LAB_PRIMARY_MODEL } from "@/lib/ai/openrouter";
import type { ChainAttempt } from "@/lib/ai/call-resilient";

/**
 * Shared time plan of the MedArt Lab generations (mind map, pharmaco/DDx
 * matrix, virtual patient), run through callOpenRouterChain.
 *
 * Routes declare `export const maxDuration = 300` (a literal, as Next.js
 * requires); the chain's own deadline stays 50 s below it, leaving room for
 * the Supabase reads before the call and the cache / history writes after.
 */
export const LAB_CHAIN_DEADLINE_MS = 250_000;

/**
 * 1. LAB_PRIMARY_MODEL (~150 tok/s): a full Lab answer in ~20-40 s.
 * 2. LAB_FALLBACK_MODEL (strongest Qwen, ~38 tok/s): only if the primary
 *    failed or produced an invalid answer.
 * 3. CHEAP_MODEL (the previous Lab model), last resort with whatever time is left.
 */
export function labAttempts(): ChainAttempt[] {
  return [
    { model: LAB_PRIMARY_MODEL, timeoutMs: 90_000 },
    { model: LAB_FALLBACK_MODEL, timeoutMs: 150_000 },
    { model: CHEAP_MODEL, timeoutMs: 150_000 },
  ];
}
