import { callOpenRouter, FREE_MODEL_CHAIN, OpenRouterError, PRIMARY_FREE_OMNI, streamOpenRouter, type ChatMessageInput } from "@/lib/ai/openrouter";
import type { FirstTokenCandidate } from "@/lib/ai/first-token-race";

/**
 * OMNI-FIRST ROUTING — product order 2026-11-09, shared by both Copilots
 * (app/api/courses/chat — the Workspace Copilot — and
 * app/api/dashboard-assistant — the Dashboard Copilot) and by their voice
 * dictation (app/api/assistant/transcribe):
 *
 *  1. Every request — text, image or voice — goes first to the free
 *     multimodal PRIMARY_FREE_OMNI, with a generous completion ceiling
 *     (FREE_OMNI_MAX_TOKENS): it costs nothing, so a long, detailed answer is
 *     never cut for money.
 *  2. Only if it fails (an error status such as 429 / 500 / 529, a stream
 *     that errors or ends empty, or no first word within the time limit) is
 *     a PAID model called — Qwen for text, Gemini for images, Whisper for
 *     voice — and only for a student whose plan grants one
 *     (lib/subscription.ts's reservePremiumFallback /
 *     canUsePaidAudioFallback), with a short ceiling
 *     (PAID_FALLBACK_MAX_TOKENS) to keep its cost down.
 *  3. The routes keep the existing free chain (FREE_MODEL_CHAIN) as a last,
 *     zero-cost safety net, so a student without a paid fallback is not left
 *     on an error the moment Omni is saturated.
 */

/** Completion ceiling on the free Omni model: no cost, so room for long, detailed answers (and its hidden reasoning). */
export const FREE_OMNI_MAX_TOKENS = 8192;

/** Completion ceiling on every paid fallback (text and image) — short and cheap by product order. */
export const PAID_FALLBACK_MAX_TOKENS = 500;

/**
 * How long Omni gets to send its first VISIBLE word before the fallback takes
 * over. It is a reasoning model: that word only comes once its hidden
 * thinking is done (a few seconds when the endpoint is healthy). A saturated
 * free endpoint answers 429 at once — this only bounds a silent stall.
 */
export const OMNI_FIRST_TOKEN_TIMEOUT_MS = 25_000;

/** Same for a voice transcription (a single, non-streamed answer). The route has 60 s in all, Whisper included. */
const OMNI_TRANSCRIPTION_TIMEOUT_MS = 25_000;

/**
 * Added to a paid fallback's prompt (text and image): with a 500-token
 * ceiling, an answer written at its usual length would stop mid-sentence —
 * asked for short, it ends where it should.
 */
const PAID_FALLBACK_BREVITY_NOTE =
  "CONSIGNE DE LONGUEUR (prioritaire sur toute autre indication de longueur ou de format) : réponse COURTE, 200 mots au maximum. Va droit à l'essentiel — la notion clé, le mécanisme ou le critère décisif, le point d'examen — sans introduction ni conclusion, et termine toujours ta dernière phrase.";

/** `messages` with the paid fallback's length instruction added right after the main system prompt. */
export function withPaidFallbackBrevity(messages: ChatMessageInput[]): ChatMessageInput[] {
  const note: ChatMessageInput = { role: "system", content: PAID_FALLBACK_BREVITY_NOTE };
  if (messages.length === 0 || messages[0].role !== "system") return [note, ...messages];
  return [messages[0], note, ...messages.slice(1)];
}

/**
 * Resolves only once `stream` has produced its first non-empty chunk, with a
 * stream that replays it and then the rest. Rejects — after cancelling
 * `stream`, which aborts the upstream request — when the stream errors, ends
 * without a byte (a free endpoint can answer 200 and then fail inside the
 * stream), or stays silent past `timeoutMs`. That rejection is what lets the
 * caller fall back instead of handing a student an empty reply.
 */
export async function withFirstChunk(stream: ReadableStream<Uint8Array>, timeoutMs: number): Promise<ReadableStream<Uint8Array>> {
  const reader = stream.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const firstChunk = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return null;
      if (value && value.byteLength > 0) return value;
    }
  })();
  // The losing side of the race below must never surface as an unhandled rejection.
  firstChunk.catch(() => {});

  let first: Uint8Array | null | "timeout";
  try {
    first = await Promise.race([
      firstChunk,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error instanceof OpenRouterError ? error : new OpenRouterError("Le flux du modèle s'est interrompu avant la réponse.", 502);
  } finally {
    clearTimeout(timer);
  }

  if (first === "timeout" || first === null) {
    void reader.cancel().catch(() => {});
    throw first === "timeout"
      ? new OpenRouterError(`Aucune réponse du modèle en ${Math.round(timeoutMs / 1000)} s.`, 504)
      : new OpenRouterError("Le modèle a terminé sans rien écrire.", 502);
  }

  const head = first;
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

/**
 * ATTEMPT 1 for a Copilot reply: streams from PRIMARY_FREE_OMNI. Messages may
 * carry an image (an `image_url` content part). Resolves once the first
 * visible word has arrived (see withFirstChunk); throws on any failure, so
 * the caller can fall back.
 */
export async function streamFreeOmni(messages: ChatMessageInput[], options: { temperature?: number } = {}): Promise<ReadableStream<Uint8Array>> {
  const stream = await streamOpenRouter(messages, {
    model: PRIMARY_FREE_OMNI,
    maxTokens: FREE_OMNI_MAX_TOKENS,
    temperature: options.temperature ?? 0.3,
    // Bounds the hidden thinking of this reasoning model; a documented no-op where unsupported.
    reasoning: { effort: "low" },
    providerSort: "latency",
  });
  return withFirstChunk(stream, OMNI_FIRST_TOKEN_TIMEOUT_MS);
}

// ─── Hedged routing (2026-11-21) ─────────────────────────────────────────
//
// Same product order as above — Omni, then the paid fallback for a student
// whose plan grants it, then the free chain — but no longer strictly one
// after the other: see lib/ai/first-token-race.ts. Omni starts at once; if it
// has not written a visible word after COPILOT_HEDGE_MS, the paid fallback
// starts alongside it and the first one to write wins (the other is
// cancelled). A failure (429, 5xx, an empty stream) still hands over at once.
//
// The free chain is NOT hedged early: OpenRouter's free models share ONE
// account-wide bucket of 20 requests a minute (lib/platform-spend-guard.ts),
// so an extra free request per message would eat into every other student's
// share. It joins only when everything before it has failed, or as a late
// safety net (FREE_CHAIN_START_WITHOUT_PAID_MS / FREE_CHAIN_START_WITH_PAID_MS)
// if every earlier model stays silent.

function envMs(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : fallback;
}

/**
 * How long Omni may stay silent before the paid fallback is asked alongside
 * it. Past ~4-5 s of an empty bubble a reply feels slow; the paid fallback
 * writes its first word in ~1.5-2.6 s (measured, lib/ai/openrouter.ts's
 * CHAT_MODEL comment), so a student waits ~7 s at worst instead of the 25 s
 * + fallback of before. Tunable without a redeploy of the code
 * (COPILOT_HEDGE_MS, 1-20 s).
 */
export const COPILOT_HEDGE_MS = envMs("COPILOT_HEDGE_MS", 4500, 1000, 20000);

/**
 * "Ask MedArt" / Translate on a selection: product direction is an INSTANT
 * answer, and the concise answer the paid model gives there is exactly the
 * format asked for — it joins sooner (COPILOT_HIGHLIGHT_HEDGE_MS, 1-20 s).
 */
export const COPILOT_HIGHLIGHT_HEDGE_MS = envMs("COPILOT_HIGHLIGHT_HEDGE_MS", 2500, 1000, 20000);

/** A paid model normally writes within 1.5-2.6 s; past this, it is stuck. */
const PAID_FIRST_TOKEN_TIMEOUT_MS = 20_000;

/**
 * The free chain's late start as a safety net when every earlier model stays
 * silent (it still starts at once when they have all failed): sooner when no
 * paid model can stand in (it is then the only hedge left), later when one
 * can (the paid model has had its chance first).
 */
const FREE_CHAIN_START_WITHOUT_PAID_MS = 8_000;
const FREE_CHAIN_START_WITH_PAID_MS = 14_000;
const FREE_CHAIN_STEP_MS = 6_000;
const FREE_CHAIN_FIRST_TOKEN_TIMEOUT_MS = 25_000;

export interface CopilotCandidatesInput {
  /** The DETAILED request (free models): persona, depth directive, history, question. */
  freeMessages: ChatMessageInput[];
  /** The CONCISE request for the paid fallback, already in its final form (brevity note included when wanted). */
  paidMessages: ChatMessageInput[];
  /** The free-tier capacity reservation (reserveFreeTierCapacity): Omni and the free chain only run when it allows them. */
  freeCapacity: Promise<boolean>;
  /** May a paid model stand in at all (access allowed and premium-eligible)? */
  paidAllowed: Promise<boolean>;
  /** Reserves the paid message — called only when the paid model is about to answer (reservePremiumFallback). */
  commitPaid: () => Promise<boolean>;
  paid: { model: string; reasoning: { effort?: "high" | "medium" | "low" | "minimal"; enabled?: boolean } };
  temperature: number;
  /** Ceiling for the free chain (Omni always gets FREE_OMNI_MAX_TOKENS). */
  freeChainMaxTokens: number;
  /** false for an image: no model of the free chain can see it. */
  includeFreeChain: boolean;
  hedgeMs: number;
}

/** The Copilot's candidates, in product order, for lib/ai/first-token-race.ts. */
export function buildCopilotCandidates(input: CopilotCandidatesInput): FirstTokenCandidate[] {
  const candidates: FirstTokenCandidate[] = [
    {
      label: "omni",
      startAfterMs: 0,
      firstTokenTimeoutMs: OMNI_FIRST_TOKEN_TIMEOUT_MS,
      // Opened only once the shared free-tier capacity was reserved for this
      // message — NOT speculatively: every request to a free model counts
      // against OpenRouter's account-wide limits (20 a minute, 1000 a day),
      // even one cancelled a moment later, and that reservation is what keeps
      // the platform under them (lib/platform-spend-guard.ts).
      gate: input.freeCapacity,
      open: (signal) =>
        streamOpenRouter(input.freeMessages, {
          model: PRIMARY_FREE_OMNI,
          maxTokens: FREE_OMNI_MAX_TOKENS,
          temperature: input.temperature,
          // Bounds the hidden thinking of this reasoning model; a documented no-op where unsupported.
          reasoning: { effort: "low" },
          providerSort: "latency",
          signal,
        }),
    },
    {
      label: "paid",
      startAfterMs: input.hedgeMs,
      firstTokenTimeoutMs: PAID_FIRST_TOKEN_TIMEOUT_MS,
      gate: input.paidAllowed,
      commit: input.commitPaid,
      open: (signal) =>
        streamOpenRouter(input.paidMessages, {
          model: input.paid.model,
          maxTokens: PAID_FALLBACK_MAX_TOKENS,
          temperature: input.temperature,
          reasoning: input.paid.reasoning,
          providerSort: "latency",
          signal,
        }),
    },
  ];
  if (input.includeFreeChain) {
    FREE_MODEL_CHAIN.forEach((model, i) => {
      candidates.push({
        label: `free${i + 1}`,
        startAfterMs: input.paidAllowed.then(
          (paidOk) => (paidOk ? FREE_CHAIN_START_WITH_PAID_MS : FREE_CHAIN_START_WITHOUT_PAID_MS) + i * FREE_CHAIN_STEP_MS,
          () => FREE_CHAIN_START_WITHOUT_PAID_MS + i * FREE_CHAIN_STEP_MS
        ),
        firstTokenTimeoutMs: FREE_CHAIN_FIRST_TOKEN_TIMEOUT_MS,
        gate: input.freeCapacity,
        open: (signal) =>
          streamOpenRouter(input.freeMessages, {
            model,
            maxTokens: input.freeChainMaxTokens,
            temperature: input.temperature,
            reasoning: { effort: "low" },
            providerSort: "latency",
            signal,
          }),
      });
    });
  }
  return candidates;
}

const OMNI_TRANSCRIPTION_INSTRUCTION =`Transcris mot pour mot l'enregistrement audio joint. C'est la question dictée par un étudiant en médecine algérien, en français, en arabe ou en darija algérienne, parfois mélangés.
- Écris exactement ce qui est dit, dans la langue où c'est dit (l'arabe et la darija en écriture arabe), sans rien traduire.
- Orthographie correctement les termes médicaux (par exemple : insuffisance cardiaque, physiopathologie, sémiologie, électrocardiogramme, glomérulonéphrite, antibiothérapie, QCM, cas clinique).
- Réponds UNIQUEMENT par la transcription : pas de réponse à la question, pas de commentaire, pas de guillemets.
- Si l'enregistrement est vide ou inaudible, réponds seulement : [inaudible]`;

/**
 * ATTEMPT 1 for a voice dictation: PRIMARY_FREE_OMNI transcribes the clip
 * (an `input_audio` content part, base64 — OpenRouter accepts no audio URL).
 * `format` is the recording's container as the browser made it (webm/opus
 * from Chrome and Edge, ogg from Firefox, m4a from Safari). Throws on any
 * failure, including an empty or "[inaudible]" answer, so the caller can fall
 * back.
 */
export async function transcribeWithFreeOmni(audio: Buffer, format: string): Promise<string> {
  const content = [
    { type: "text", text: OMNI_TRANSCRIPTION_INSTRUCTION },
    { type: "input_audio", input_audio: { data: audio.toString("base64"), format } },
  ];
  const raw = await callOpenRouter([{ role: "user", content } as unknown as ChatMessageInput], {
    model: PRIMARY_FREE_OMNI,
    maxTokens: FREE_OMNI_MAX_TOKENS,
    temperature: 0,
    reasoning: { effort: "low" },
    timeoutMs: OMNI_TRANSCRIPTION_TIMEOUT_MS,
    bypassMock: true,
  });
  const transcript = raw
    .trim()
    .replace(/^["«“”]+|["»“”]+$/g, "")
    .trim();
  if (!transcript || /^\[?\s*inaudible\s*\]?\.?$/i.test(transcript)) {
    throw new OpenRouterError("Transcription vide ou inaudible.", 422);
  }
  return transcript;
}
