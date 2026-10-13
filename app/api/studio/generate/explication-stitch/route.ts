import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { callOpenRouter, FLASHCARD_MODEL, OpenRouterError, STREAMLAKE_FIRST, type ChatMessageInput } from "@/lib/ai/openrouter";
import { modelCallKey, runThroughLedger } from "@/lib/ai/generation-ledger";
import { buildExplicationSeamStitchPrompt } from "@/lib/prompts/public-course-sections";
import { errorMessage, parseJsonResponse } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

// tail/head are each capped at lib/studio-explication-client.ts's
// SEAM_WINDOW_CHARS (~1,500 chars, well under 1,000 tokens) — this only needs
// headroom for two echoed excerpts plus the JSON wrapper, never a fresh
// long-form generation, so it stays far below every other Explication route's
// budget.
const SEAM_STITCH_MAX_TOKENS = 4_000;
const SEAM_STITCH_TIMEOUT_MS = 45_000;
// A legitimate repair only drops a duplicated title or a redundant intro
// sentence. Losing more than this share of the combined excerpts means the
// model condensed real content, so the original seam is kept instead.
const SEAM_MIN_LENGTH_RATIO = 0.85;

/**
 * Seam-repair step of the fully-concurrent Explication pipeline — see
 * buildExplicationSeamStitchPrompt's own doc comment for the full rationale,
 * and lib/studio-explication-client.ts's stitchSeams for the call site (one
 * request per seam, all seams fired concurrently, right after every part has
 * generated).
 *
 * Deliberately touches NO quota (reserveGeneration/refundGeneration) and no
 * database row — this is a stateless text transform on two short excerpts the
 * client already has, not a billed "generation" in the product sense (the
 * cost is a rounding error next to the parts it stitches together). Any
 * failure here is BEST-EFFORT from the caller's side: stitchSeams treats a
 * non-2xx/malformed response as "leave this seam unstitched", never as a
 * reason to fail the whole Explication.
 *
 * Uses Qwen3-30B (FLASHCARD_MODEL, StreamLake first) since 2026-10-07, was
 * HAIKU_MODEL — a small structural judgment call on a tiny input, not
 * long-form writing.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-generate-explication-stitch:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { tail, head } = (body ?? {}) as { tail?: unknown; head?: unknown };
  if (typeof tail !== "string" || typeof head !== "string" || !tail.trim() || !head.trim()) {
    return NextResponse.json({ success: false, error: "'tail' et 'head' sont requis (chaînes non vides)." }, { status: 400 });
  }

  const messages: ChatMessageInput[] = [
    { role: "system", content: buildExplicationSeamStitchPrompt() },
    { role: "user", content: `avant:\n"""\n${tail}\n"""\n\naprès:\n"""\n${head}\n"""\n\nGénère le JSON demandé.` },
  ];
  const callOptions = {
    model: FLASHCARD_MODEL,
    providerOrder: STREAMLAKE_FIRST,
    maxTokens: SEAM_STITCH_MAX_TOKENS,
    bypassMock: true,
    timeoutMs: SEAM_STITCH_TIMEOUT_MS,
    temperature: 0.2,
  };

  try {
    // Generation ledger: the same seam (same two parts — which the ledger
    // already replays for an identical course) is stitched once, not once
    // per student, tab or retry.
    const stitched = await runThroughLedger(
      { namespace: "explication-stitch", key: modelCallKey(messages, callOptions), peerWaitMs: 8_000, leaseMs: SEAM_STITCH_TIMEOUT_MS + 10_000 },
      async () => {
        const raw = await callOpenRouter(messages, callOptions);
        const parsed = parseJsonResponse(raw);
        const fixedTail = typeof parsed.tail === "string" && parsed.tail.trim() ? parsed.tail : tail;
        const fixedHead = typeof parsed.head === "string" && parsed.head.trim() ? parsed.head : head;
        if (fixedTail.length + fixedHead.length < (tail.length + head.length) * SEAM_MIN_LENGTH_RATIO) {
          console.warn("[explication-stitch] Jonction rejetée (contenu raccourci par le modèle) — extraits d'origine conservés.");
          return { tail, head };
        }
        return { tail: fixedTail, head: fixedHead };
      }
    );
    return NextResponse.json({ success: true, tail: stitched.tail, head: stitched.head });
  } catch (error) {
    const status = error instanceof OpenRouterError ? error.status : 502;
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}
