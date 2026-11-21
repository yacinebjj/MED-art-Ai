import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { OpenRouterError, CHAT_MODEL, ECONOMY_MODEL, type ChatMessageInput } from "@/lib/ai/openrouter";
import { COPILOT_HEDGE_MS, buildCopilotCandidates, withPaidFallbackBrevity } from "@/lib/ai/omni-routing";
import { RaceFailedError, raceFirstToken } from "@/lib/ai/first-token-race";
import { createCopilotTimer } from "@/lib/ai/copilot-timing";
import { isSmallTalk } from "@/lib/chat-intent";

// ── Vision (images in the assistant) ────────────────────────────────────
// Images go first to the free multimodal PRIMARY_FREE_OMNI, then (paid
// fallback) to ECONOMY_MODEL — the free text chain can't see them. The
// client downsizes to ~1568 px JPEG first; this cap keeps the whole JSON body
// under the platform's ~4.5 MB request ceiling.
const MAX_IMAGE_BASE64_CHARS = 3_000_000;
const DATA_URL_IMAGE_PATTERN = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/i;
const VISION_SYSTEM_ADDENDUM = `L'étudiant joint une IMAGE médicale (schéma, coupe histologique, ECG, radiographie, photo clinique, capture de QCM…). Analyse-la avec méthode :
1. Identifie ce que montre l'image (type d'examen / de document, structures ou éléments visibles).
2. Décris les éléments clés observés, précisément et sans extrapoler au-delà de ce qui est visible.
3. Donne l'interprétation la plus probable, puis les diagnostics différentiels pertinents et ce qui permettrait de trancher.
4. S'il s'agit d'un QCM, résous-le en justifiant chaque proposition.
5. Termine par les points à retenir pour l'examen.
Si l'image est illisible ou insuffisante, dis-le clairement plutôt que d'inventer. Rappelle, quand c'est une situation clinique réelle, que cela ne remplace pas l'avis d'un médecin.`;

type VisionPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveFreeTierCapacity, type PlatformCapacityResult } from "@/lib/platform-spend-guard";
import { premiumFallbackMayBeAvailable, reserveAssistantAccess, reservePremiumFallback, type AssistantAccess } from "@/lib/subscription";
import { quotaBlockedResponse } from "@/lib/quota-response";
import { errorMessage } from "@/lib/course-generation-shared";
import { isAssistantMode, isAssistantStyle, type AssistantMode } from "@/lib/assistant-modes";
import { buildAssistantSystemPrompt, DASHBOARD_ASSISTANT_SYSTEM_PROMPT, DASHBOARD_ASSISTANT_SYSTEM_PROMPT_DETAILED } from "@/lib/ai/assistant-prompts";
import { MEDICAL_IMAGE_DIRECTIVE } from "@/lib/ai/medical-image-directive";
import { FREE_MODEL_HISTORY_BUDGET, PAID_FALLBACK_HISTORY_BUDGET, normalizeChatHistory, selectHistory, type SelectedHistory } from "@/lib/chat-history";
import { isReplyId } from "@/lib/copilot-background";
import { streamReplyInBackground } from "@/lib/copilot-background-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Raised from 60 alongside MAX_OUTPUT_TOKENS below (1000 -> 8192) — a free-
// tier endpoint isn't necessarily prioritized the way a paid call is, so a
// genuinely long reply can take meaningfully longer to finish streaming.
// Without more wall-clock headroom here, Vercel's own function timeout
// could still cut a long reply off mid-stream even though MAX_OUTPUT_TOKENS
// itself would have allowed it to finish — same failure the token-side fix
// is meant to remove, just from the platform side instead of ours. 300 s
// (was 120 s) since 2026-11-09: the free models are now asked for exhaustive
// answers (lib/ai/answer-depth.ts), so a slower free endpoint may need more
// than two minutes to stream one — same value as
// app/api/courses/chat/route.ts; lib/copilot-reply-runner.ts's recovery
// windows follow it.
export const maxDuration = 300;

/**
 * Dashboard Assistant — a general-purpose chat surface for the dashboard
 * home (outside any course/module), distinct from app/api/assistant/route.ts
 * (the paid MedArt Assistant, Haiku-routed). Also distinct from
 * app/api/courses/chat/route.ts (the Workspace course chat) — that route
 * shares the exact same DeepSeek-then-free tiering logic (see its own header
 * comment) but is a separate feature with its own RAG/context and its own
 * share of the SAME account-wide free-tier request ceiling
 * (lib/platform-spend-guard.ts's reserveFreeTierCapacity).
 *
 * MODEL ROUTING — Omni-first since 2026-11-09 (product order; see
 * lib/ai/omni-routing.ts): every message, text or image, goes first to the
 * free multimodal PRIMARY_FREE_OMNI (8192-token ceiling). Only if it fails
 * does a paid model answer — CHAT_MODEL for text, ECONOMY_MODEL for an image
 * — for a student whose plan grants it (reservePremiumFallback, which spends
 * one of the daily premium messages shared with app/api/courses/chat/route.ts
 * only then), capped at 500 tokens and asked for a short answer. A text
 * message then still has the rest of FREE_MODEL_CHAIN as a zero-cost
 * safety net.
 *
 * HEDGED since 2026-11-21 (see the race at the end of POST): the order is
 * the same, but a silent Omni no longer holds the student for 25 s before
 * the paid fallback is even asked — after COPILOT_HEDGE_MS the paid model
 * runs alongside it and the first to write answers. Every request logs where
 * its time went (`[copilot:timing]`, lib/ai/copilot-timing.ts).
 *
 * FREE_MODEL_CHAIN lives in lib/ai/openrouter.ts (shared with courses/chat
 * and lib/cache-prewarming.ts) — see that constant's own comment for the
 * live verification (2026-08-29) behind these exact ids.
 */
const MAX_MESSAGE_CHARS = 4000;
// History: the whole conversation since 2026-11-09 (product order, "Master
// Copilot Surgery") — no longer its last 20 messages. lib/chat-history.ts
// reads it and gives each model what its budget holds: the recent turns word
// for word, everything older as a condensed memory in the system prompt.

// Proactive Wikimedia images (lib/ai/medical-image-directive.ts, free models
// only) — never in these quick actions: QCM and flashcards are formats of
// their own, and a progressive clinical case must not give its diagnosis away.
const NO_IMAGE_MODES: ReadonlySet<AssistantMode> = new Set<AssistantMode>(["mcq", "flashcards", "clinical_case"]);
// "Importer un PDF" is text-only, so it works fine here. Bounded the same
// way app/api/assistant/route.ts bounds it.
const MAX_DOCUMENT_CHARS = 12000;
// Free-tier models are NOT run through this app's hybrid model router or
// reasoning-effort caps (lib/chat-model-routing.ts) — those exist to manage
// PAID per-token cost, which doesn't apply here at all, so there is no
// reason to cap this route's completion length for spend the way every
// paid route in this app does. Raised from 1000 to 8192 on explicit
// request — real students were seeing long, genuinely-needed explanations
// cut off mid-sentence. Both models in FREE_MODEL_CHAIN support far more
// than this (verified live: nemotron-3.5-lightning up to 65,536 completion
// tokens, laguna-s-2.1 up to 32,768) — 8192 is a deliberate, generous
// ceiling (~5,000-6,000 French words), not "as high as technically
// possible": a literal unbounded cap mostly just raises worst-case latency
// (see maxDuration above) without any real student needing more than this
// for a single reply.
const MAX_OUTPUT_TOKENS = 8192;

// Paid fallback ceiling (CHAT_MODEL for text, ECONOMY_MODEL for an image):
// PAID_FALLBACK_MAX_TOKENS (500) since 2026-11-09 — product order, short and
// cheap. It replaced the per-quick-action ceilings of 2026-10-12 (700-3000)
// and the 2500 of image questions; the answer is asked to be short on that
// path (withPaidFallbackBrevity) so it ends where it should. The free models
// keep MAX_OUTPUT_TOKENS above (no cost).

// 0.3, aligned on app/api/courses/chat/route.ts (was 0.5 here): same model,
// but medical answers need precision over variety — a lower temperature
// gives a more stable structure and fewer invented details. The free chain
// below also gets `reasoning: { effort: "low" }` like the course chat, so a
// reasoning model can't burn the output budget on hidden thinking and
// truncate the visible answer.
const ANSWER_TEMPERATURE = 0.3;

// Base persona, concise version (a paid fallback) — see
// DASHBOARD_ASSISTANT_SYSTEM_PROMPT's own comment in lib/ai/assistant-prompts.ts
// (modeled on the course chat's prompt). The free models get
// DASHBOARD_ASSISTANT_SYSTEM_PROMPT_DETAILED (see buildRequest below).
const SYSTEM_PROMPT = DASHBOARD_ASSISTANT_SYSTEM_PROMPT;

export async function POST(request: NextRequest) {
  const timer = createCopilotTimer("dashboard");
  const user = await getAuthenticatedUser();
  timer.mark("auth");
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  // Per-student throttle — separate from RATE_LIMITS.ai (shared by PAID
  // routes): this route has no per-student dollar budget to protect, only
  // the shared daily free-tier ceiling reserved below, which one student
  // alone must not be able to exhaust.
  const rl = rateLimit(`dashboard-assistant:${user.id}`, RATE_LIMITS.freeAssistant);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Trop de messages d'un coup — patiente quelques secondes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { message, history, messages: historyAlias, image, document, mode, style, stepByStep, replyId, language } = (body ?? {}) as {
    message?: unknown;
    /** The conversation so far, oldest first: [{ role: "user" | "assistant", content }] (lib/chat-history.ts). */
    history?: unknown;
    /** The same, under the name most chat APIs use — read when `history` is absent. */
    messages?: unknown;
    /** The page's id for this reply: with it, the reply is carried on to its end if the student leaves, and kept for them to collect (lib/copilot-background.ts). */
    replyId?: unknown;
    language?: unknown;
    /** Quick-action chip / answer-style / step-by-step toggles from the assistant UI — each validated against a whitelist below (lib/assistant-modes.ts); an unknown value is ignored, never echoed into the prompt. */
    mode?: unknown;
    style?: unknown;
    stepByStep?: unknown;
    /** Inline image ({ dataUrl }) — analysed by the multimodal model (see the vision branch below). */
    image?: unknown;
    /** Text-only, so this DOES work here — folded into the prompt like app/api/assistant/route.ts's own document support. */
    document?: unknown;
  };

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Le champ 'message' est requis." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Ton message est trop long (${message.length} caractères, max ${MAX_MESSAGE_CHARS}). Raccourcis-le et réessaie.` },
      { status: 400 }
    );
  }
  let imageDataUrl: string | null = null;
  if (image !== undefined) {
    const candidate = image as { dataUrl?: unknown };
    if (!candidate || typeof candidate.dataUrl !== "string" || !DATA_URL_IMAGE_PATTERN.test(candidate.dataUrl)) {
      return NextResponse.json({ error: "Format d'image non supporté (PNG, JPEG, WEBP ou GIF attendu)." }, { status: 400 });
    }
    if (candidate.dataUrl.length > MAX_IMAGE_BASE64_CHARS) {
      return NextResponse.json({ error: "Image trop lourde. Réessaie avec une photo plus petite." }, { status: 413 });
    }
    imageDataUrl = candidate.dataUrl;
  }

  let documentAttachment: { fileName: string; text: string } | null = null;
  if (document !== undefined) {
    const candidate = document as { fileName?: unknown; text?: unknown };
    if (typeof candidate.fileName !== "string" || typeof candidate.text !== "string") {
      return NextResponse.json({ error: "Document invalide." }, { status: 400 });
    }
    documentAttachment = { fileName: candidate.fileName.slice(0, 200), text: candidate.text.slice(0, MAX_DOCUMENT_CHARS) };
  }

  // The whole conversation, read once (lib/chat-history.ts): failed replies
  // and empty bubbles left out, student → Copilot turns alternating.
  const conversation = normalizeChatHistory(Array.isArray(history) ? history : historyAlias);

  // Every successful answer goes out through here. With a reply id from the
  // page, the model's stream outlives the student's connection (an iPhone app
  // switch, a closed tab) and the reply waits for them in their sync store.
  const deliver = (stream: ReadableStream<Uint8Array>) =>
    new NextResponse(isReplyId(replyId) ? streamReplyInBackground(stream, { userId: user.id, replyId, language: language === "en" ? "en" : "fr" }) : stream, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Server-Timing": timer.serverTiming() },
    });

  const promptOptions = {
    mode: isAssistantMode(mode) ? mode : undefined,
    style: isAssistantStyle(style) ? style : undefined,
    stepByStep: stepByStep === true,
  };

  // Dynamic system prompts (product order 2026-11-09, lib/ai/answer-depth.ts):
  // the same request in two versions, each sent only to the models it is
  // meant for — the DETAILED persona (exhaustive, no length limit, the depth
  // directive, and the proactive Wikimedia images) to the free models, the
  // CONCISE one (its length target, plus the short-answer note added at call
  // time) to a paid fallback. A quick action or a style the student chose is
  // added to both. The conversation travels as messages (the recent turns)
  // and, past the model's budget, as a condensed memory at the end of the
  // system prompt (lib/chat-history.ts). An image travels as an image_url
  // part on the student's last turn, with the vision method right after the
  // persona.
  const buildRequest = (basePrompt: string, conversationSlice: SelectedHistory): ChatMessageInput[] => {
    const systemPrompt = buildAssistantSystemPrompt(basePrompt, promptOptions);
    const request: ChatMessageInput[] = [
      { role: "system", content: conversationSlice.memory ? `${systemPrompt}\n\n${conversationSlice.memory}` : systemPrompt },
      ...(documentAttachment
        ? [
            {
              role: "system" as const,
              content: `Voici le contenu extrait du document que l'étudiant vient d'importer ("${documentAttachment.fileName}") — utilise-le comme contexte pour répondre à sa question ci-dessous quand c'est pertinent :\n"""\n${documentAttachment.text}\n"""`,
            },
          ]
        : []),
      ...conversationSlice.recent.map((turn): ChatMessageInput => ({ role: turn.role, content: turn.content })),
      { role: "user", content: message },
    ];
    if (!imageDataUrl) return request;
    return [
      request[0],
      { role: "system", content: VISION_SYSTEM_ADDENDUM },
      ...request.slice(1, -1),
      {
        role: "user",
        content: [
          { type: "text", text: message },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ] as VisionPart[],
      } as unknown as ChatMessageInput,
    ];
  };
  // Images: not for a question about the student's own image, nor in the quick actions of NO_IMAGE_MODES.
  const illustrate = !imageDataUrl && !(promptOptions.mode && NO_IMAGE_MODES.has(promptOptions.mode));
  const freeModelMessages = buildRequest(
    illustrate ? `${DASHBOARD_ASSISTANT_SYSTEM_PROMPT_DETAILED}\n\n${MEDICAL_IMAGE_DIRECTIVE}` : DASHBOARD_ASSISTANT_SYSTEM_PROMPT_DETAILED,
    selectHistory(conversation, FREE_MODEL_HISTORY_BUDGET)
  );
  const paidModelMessages = buildRequest(SYSTEM_PROMPT, selectHistory(conversation, PAID_FALLBACK_HISTORY_BUDGET));

  // ── Gates, then the hedged model race (2026-11-21) ──────────────────────
  // The gates keep their order and their meaning, strictly one after the
  // other (each reserves a counter): the access gate (may this message be
  // sent, may a paid model stand in — monetization v2: free trial = 20
  // messages for life, then paywall; paid = 20 premium messages a day, spent
  // only when a paid model actually answers; small talk — lib/chat-intent.ts
  // — never worth a paid call; an image always may), then the shared
  // external free-tier ceiling (reserveFreeTierCapacity's own comment).
  //
  // The model race (lib/ai/first-token-race.ts, candidates in
  // lib/ai/omni-routing.ts's buildCopilotCandidates) is set up ALONGSIDE them,
  // each model opening as soon as its own gate said yes:
  //  1. PRIMARY_FREE_OMNI, for every message, text or image (8192 tokens:
  //     free), the moment the free-tier capacity is reserved — never before:
  //     a free request counts against OpenRouter's account-wide limits even
  //     when cancelled.
  //  2. The paid model — CHAT_MODEL for text, ECONOMY_MODEL for an image, 500
  //     tokens, a short answer asked for — for a student whose plan grants
  //     it, as soon as Omni has failed OR after COPILOT_HEDGE_MS of Omni
  //     silence; the first of the two to write wins, the other is cancelled.
  //     The daily premium message is reserved only when the paid model is
  //     about to answer.
  //  3. Text only: FREE_MODEL_CHAIN, the zero-cost safety net, once every
  //     model before it has failed (or as a late net if they all stay silent).
  // A model erroring (saturation, a provider hiccup, a 429) is the EXPECTED,
  // routine case on free endpoints, not an exceptional one.
  const accessPromise = reserveAssistantAccess(user, { needsPremium: Boolean(imageDataUrl) || !isSmallTalk(message) });
  const capacityPromise: Promise<PlatformCapacityResult> = accessPromise.then((gate) => (gate.allowed ? reserveFreeTierCapacity() : { allowed: false }));
  let paidCommitRefused = false;
  const race = raceFirstToken(
    buildCopilotCandidates({
      freeMessages: freeModelMessages,
      paidMessages: withPaidFallbackBrevity(paidModelMessages),
      freeCapacity: capacityPromise.then((result) => result.allowed, () => false),
      paidAllowed: accessPromise.then((gate) => premiumFallbackMayBeAvailable(gate), () => false),
      commitPaid: async () => {
        const reserved = await reservePremiumFallback(user, await accessPromise);
        if (!reserved) paidCommitRefused = true;
        return reserved;
      },
      // Gemini's hidden thinking capped (uncapped, it billed 965 reasoning tokens for one question, live 2026-10-12);
      // CHAT_MODEL (qwen3.7-flash) is a hybrid thinking model — reasoning switched OFF explicitly.
      paid: imageDataUrl ? { model: ECONOMY_MODEL, reasoning: { effort: "low" } } : { model: CHAT_MODEL, reasoning: { enabled: false } },
      temperature: ANSWER_TEMPERATURE,
      freeChainMaxTokens: MAX_OUTPUT_TOKENS,
      includeFreeChain: !imageDataUrl,
      hedgeMs: COPILOT_HEDGE_MS,
    })
  );

  let access: AssistantAccess;
  try {
    access = await accessPromise;
  } catch (error) {
    race.abort();
    throw error;
  }
  timer.mark("access");
  if (!access.allowed) {
    race.abort();
    timer.log("quota-blocked");
    return quotaBlockedResponse(access);
  }
  const capacity = await capacityPromise;
  timer.mark("capacity");

  try {
    const outcome = await race.promise;
    timer.mark("first_token");
    timer.log(`ok:${outcome.label}`, outcome.attempts);
    return deliver(outcome.stream);
  } catch (error) {
    const lastError = error instanceof RaceFailedError ? error.lastError : error;
    timer.mark("failed");
    timer.log("all-failed", error instanceof RaceFailedError ? error.attempts : undefined);

    if (imageDataUrl) {
      // No free text model can stand in for an image.
      console.error("[dashboard-assistant] Analyse d'image échouée:", lastError instanceof Error ? lastError.message : lastError);
      if (access.premiumEligible && access.dailySub && (paidCommitRefused || !premiumFallbackMayBeAvailable(access))) {
        return NextResponse.json(
          { error: "Tu as utilisé toutes tes analyses avancées du jour (images comprises). Elles se rechargent demain — tu peux continuer en texte d'ici là." },
          { status: 429 }
        );
      }
      return NextResponse.json({ error: "L'analyse de l'image n'a pas pu aboutir. Réessaie dans un instant." }, { status: 502 });
    }

    if (!capacity.allowed) {
      return NextResponse.json({ error: capacity.reason }, { status: 503 });
    }

    // Omni, the paid fallback (when granted) and every free model failed — the
    // ONLY case the student sees an error. A paid model is never called past
    // the one fallback its plan grants.
    const status = upstreamStatus(lastError);
    console.error("[dashboard-assistant] Tous les modèles gratuits ont échoué:", lastError instanceof Error ? lastError.message : lastError);
    return NextResponse.json(
      { error: "L'assistant gratuit est momentanément indisponible (forte demande) — réessaie dans une minute." },
      { status: status >= 400 && status < 600 ? status : 503 }
    );
  }
}

/** The HTTP status a failed model call carried (OpenRouterError, or the race's own timeout / empty-stream errors), 503 otherwise. */
function upstreamStatus(error: unknown): number {
  if (error instanceof OpenRouterError) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 503;
}
