import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { OpenRouterError, CHAT_MODEL, type ChatMessageInput } from "@/lib/ai/openrouter";
import { COPILOT_HEDGE_MS, COPILOT_HIGHLIGHT_HEDGE_MS, buildCopilotCandidates, withPaidFallbackBrevity } from "@/lib/ai/omni-routing";
import { RaceFailedError, raceFirstToken } from "@/lib/ai/first-token-race";
import { createCopilotTimer } from "@/lib/ai/copilot-timing";
import { isSmallTalk } from "@/lib/chat-intent";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { waitUntil } from "@vercel/functions";
import { retrieveRelevantContext, retrieveRelevantContextForStudioCourses } from "@/lib/chat-context-retrieval";
import { getEmbedding } from "@/lib/ai/embeddings";
import { MAX_CHAT_SOURCE_COURSES, isChatMode, type ChatMode } from "@/lib/chat-constants";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import {
  premiumFallbackMayBeAvailable,
  reserveChatMessage,
  refundChatMessage,
  reserveAssistantAccess,
  reservePremiumFallback,
  reserveHighlightMessage,
  refundHighlightMessage,
  type AssistantAccess,
} from "@/lib/subscription";
import { quotaBlockedResponse } from "@/lib/quota-response";
import { reserveFreeTierCapacity, type PlatformCapacityResult } from "@/lib/platform-spend-guard";
import type { AnswerDepth } from "@/lib/ai/answer-depth";
import { MEDICAL_IMAGE_DIRECTIVE } from "@/lib/ai/medical-image-directive";
import {
  ASK_MEDART_SYSTEM_PROMPT_CONCISE,
  ASK_MEDART_SYSTEM_PROMPT_DETAILED,
  CHAT_SYSTEM_PROMPT_BASE,
  CHAT_SYSTEM_PROMPT_DETAILED,
  WORKSPACE_STRUCTURED_FORMAT_INSTRUCTION,
  buildChatModeInstruction,
  buildSystemContent,
} from "@/lib/chat-system-prompt";
import { FREE_MODEL_HISTORY_BUDGET, PAID_FALLBACK_HISTORY_BUDGET, normalizeChatHistory, selectHistory, type ChatHistoryTurn } from "@/lib/chat-history";
import { stripReasoning } from "@/lib/strip-reasoning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Streamed chat reply. 300 s (was 120 s) since 2026-11-09: the free models are
// asked for exhaustive answers with an 8192-token budget (lib/ai/answer-depth.ts),
// which a slower free endpoint may need more than two minutes to stream —
// cut there, the student would see the answer stop mid-sentence.
export const maxDuration = 300;

// History: the whole conversation since 2026-11-09 (product order, "Master
// Copilot Surgery") — it was cut to its last 5 exchanges, each clipped at
// 6000 characters, so the Copilot forgot anything older. lib/chat-history.ts
// now gives each model what its budget holds: the recent turns word for word
// (FREE_MODEL_HISTORY_BUDGET for the free models, a smaller
// PAID_FALLBACK_HISTORY_BUDGET for a paid fallback — bounded input cost),
// everything older as a condensed memory in the system prompt. Condensing is
// plain text handling, never a model call.

// MODEL ROUTING — Omni-first since 2026-11-09 (product order; see
// lib/ai/omni-routing.ts): every message goes first to the free multimodal
// PRIMARY_FREE_OMNI (FREE_OMNI_MAX_TOKENS, 8192). Only if it fails does a
// paid model answer — CHAT_MODEL, for a student whose plan grants it
// (reservePremiumFallback), capped at PAID_FALLBACK_MAX_TOKENS (500) and
// asked for a short answer. The rest of FREE_MODEL_CHAIN stays the last,
// zero-cost safety net. lib/chat-model-routing.ts (the old Haiku/economy
// hybrid) is still unused, kept intact.
//
// FREE CHAIN ceilings below: 8192 (raised from 800/1500 on explicit request) — free-tier models are
// not necessarily prioritized the way a paid call is, and are NOT run
// through this app's own cost-driven caps; a generous ceiling here is what
// actually stops a genuinely long explanation from being cut off mid-
// sentence. `reasoning: { effort: "low" }` is applied defensively to every
// call on this chain (see the streamOpenRouter call below) — unlike
// ECONOMY_MODEL, neither NVIDIA Nemotron nor Poolside Laguna has a
// CONFIRMED hidden-reasoning-token truncation report from this app, but the
// option is a documented no-op on a model that doesn't support it, so
// there's no reason not to apply the same protection preemptively.
const MAX_OUTPUT_TOKENS_NORMAL = 8192;
// « Traduire » on a selection stays deliberately smaller than the main flow (a
// translation of an ≤800-char excerpt never needs anywhere near 8192) but
// still raised from the original 700 — same defensive margin against an
// unverified free model's reasoning overhead as MAX_OUTPUT_TOKENS_NORMAL
// above. "Ask MedArt" has used MAX_OUTPUT_TOKENS_NORMAL since 2026-11-27: its
// explanation is a full one now (lib/chat-system-prompt.ts's
// ASK_MEDART_SYSTEM_PROMPT_DETAILED) and a ceiling must never cut it off
// mid-sentence — the free models cost nothing either way.
const MAX_OUTPUT_TOKENS_HIGHLIGHT = 3500;

// Paid fallback (CHAT_MODEL) ceiling: PAID_FALLBACK_MAX_TOKENS (500) for every
// mode since 2026-11-09 (product order: short and cheap) — it replaced the
// per-mode ceilings of 2026-10-12 (500-1600). Free-form answers are asked to
// stay short on that path (withPaidFallbackBrevity) so they end where they
// should instead of mid-sentence.

// The "Ask MedArt" text-selection quick action (concise: true from the client
// — never the free-form chat input) answers with its own teaching persona,
// lib/chat-system-prompt.ts's ASK_MEDART_SYSTEM_PROMPT_DETAILED / _CONCISE
// (product order 2026-11-27): clear enough for a layperson, a full
// explanation in flowing prose, a cause-and-effect chain — still INSTANT, with
// no visible reasoning and no preamble, and a non-medical selection (a title,
// an intro line) explained simply instead of stalling.

// Used ONLY for the "Translate" text-selection quick action (translate: true
// from the client) — REPLACES the whole persona instead of appending to it,
// so a translation request never gets the "professeur exhaustif" framing
// fighting against "traduis strictement ce texte". Exact wording from the
// client's spec.
const TRANSLATE_SYSTEM_PROMPT = `Tu es un traducteur médical expert. Traduis strictement le texte médical fourni en arabe clair et en français courant, accompagné d'une explication clinique ultra-courte si nécessaire.`;

// A "highlight" selection is capped hard, server-side — never trust the
// client alone to keep it small. Past this, the request is rejected outright
// rather than silently truncated: a silent cut could sever a sentence
// mid-thought and change the medical meaning of what gets sent to the model,
// which is worse than making the student re-select a shorter passage.
const MAX_HIGHLIGHT_CHARS = 800;

// The free-form chat `message` field had NO length cap at all — every other
// user-controlled input into this route (selectedText above, adjacentContext,
// sourceText via MAX_CONTEXT_CHARS, history via lib/chat-history.ts's budgets) was
// bounded, but a student could paste an arbitrarily large message directly
// into the prompt, undermining every token-budget assumption this cost
// model relies on. Found during a security audit. 4000 chars is generous
// for a real question (well above what a highlight quick-action's
// "instruction" text ever needs) while still bounding worst-case spend.
const MAX_MESSAGE_CHARS = 4000;

// Each history turn's share of the RAG retrieval query. The CURRENT question
// goes first and history only adds a short topic anchor — a long previous
// answer must never push the actual question past the embedding's input
// limit or drown it out in the ranking.
const RETRIEVAL_HISTORY_CHARS = 500;

// Cap on the small pre/post excerpt taken from the SAME course text
// immediately around the highlighted passage — e.g. an abbreviation defined
// two lines earlier, or a dosage unit given in the preceding sentence.
// Deliberately small and symmetric: this is "enough to disambiguate a
// pronoun or an abbreviation", never "enough to reconstruct the whole
// document" — the isolation guarantee below depends on this staying tiny
// relative to MAX_CONTEXT_CHARS (20 000).
const ADJACENT_CONTEXT_CHARS = 300;

/**
 * Builds the system message for a HIGHLIGHT quick action (Ask MedArt /
 * Translate on a text selection) — the hard isolation guarantee lives here:
 * this function NEVER receives and NEVER reads the course's full raw_text.
 * Its only inputs are the persona/translator instructions and the isolated
 * selection (+ a capped adjacent excerpt of the SAME selection's immediate
 * surroundings, never the whole document). No cache_control here: the
 * selected text is different on every call, so there is no repeated prefix
 * for Anthropic's cache to match — caching would only add write overhead
 * for zero read benefit.
 */
function buildHighlightSystemContent(translate: boolean, selectedText: string, adjacentContext: string | null, depth: AnswerDepth): string {
  // Translate keeps its translator persona whatever the model: an "explain
  // exhaustively" directive would turn a translation into an essay. "Ask
  // MedArt" has its own teaching persona; the free models' explanation may
  // come illustrated (lib/ai/medical-image-directive.ts).
  const persona = translate
    ? TRANSLATE_SYSTEM_PROMPT
    : depth === "detailed"
      ? `${ASK_MEDART_SYSTEM_PROMPT_DETAILED}\n\n${MEDICAL_IMAGE_DIRECTIVE}`
      : ASK_MEDART_SYSTEM_PROMPT_CONCISE;
  const isolationNotice =
    "\n\nIMPORTANT : tu ne reçois PAS le cours complet ici, uniquement le passage ci-dessous (et un minuscule extrait adjacent si fourni). Réponds seulement à partir de ce texte — ne suppose jamais un contenu que tu ne peux pas voir.";
  const excerptBlock = adjacentContext
    ? `\n\nExtrait adjacent (contexte minimal, PAS le cours entier) :\n"""\n${adjacentContext}\n"""`
    : "";

  return `${persona}${isolationNotice}${excerptBlock}\n\nPassage sélectionné par l'étudiant :\n"""\n${selectedText}\n"""`;
}

// Backend backstop, layered on top of the client's own history hygiene (see
// hooks/useCourseChat.ts's excludeFromHistory) — a bare greeting with
// nothing else in it can never have meant to reference the previous
// exchange, so it forces a clean slate regardless of what the client sent:
// no history, no course text, no cache. Deliberately an exact whole-message
// match, not a startsWith — "bonjour, peux-tu m'expliquer..." is a real
// question and must keep its context.
const BARE_GREETING_PATTERN = /^(salut|bonjour|bonsoir|hello|hi|hey|coucou|yo)[\s!.,?]*$/i;

function isBareGreeting(text: string): boolean {
  return BARE_GREETING_PATTERN.test(text.trim());
}

/**
 * The MedArt Assistant chat for the PUBLIC showcase/demo courses (the
 * `courses` table, looked up by slug) — powers "Ask MedArt", "Translate",
 * and the free-form chat input in app/dashboard/demo/[slug]/page.tsx.
 * Distinct from app/api/chat/route.ts, which serves the separate, auth-gated
 * per-user `user_courses` pipeline — different table, different access
 * model, must not be confused with this one.
 *
 * GET  ?slug=... -> the signed-in student's saved chat history for that course.
 * POST           -> streams the model's answer back as plain text (see
 *                    hooks/useCourseChat.ts on the frontend side) while
 *                    persisting both sides of the exchange to
 *                    `course_chat_history` — see the inline comments below
 *                    for exactly when each write happens relative to the
 *                    stream.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "Le paramètre 'slug' est requis." }, { status: 400 });
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ messages: [] });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("course_chat_history")
    .select("id, role, content, created_at")
    .eq("user_id", user.id)
    .eq("course_slug", slug)
    .order("created_at", { ascending: true })
    // id as a tie-break: a question and its reply written within the same millisecond must keep their order.
    .order("id", { ascending: true });

  if (error) {
    console.error("[courses/chat GET] Échec lecture historique:", { code: error.code, message: error.message });
    return NextResponse.json({ messages: [] });
  }

  return NextResponse.json({
    messages: (data ?? []).map((row) => ({ id: String(row.id), role: row.role, content: row.content })),
  });
}

/**
 * "Nouvelle conversation" — used to only clear the frontend's own React
 * state (see hooks/useCourseChat.ts's clearMessages), leaving every row in
 * `course_chat_history` untouched: reload the page, or just revisit the
 * course, and the "cleared" transcript quietly came right back. This is what
 * makes that reset real — it wipes exactly this student's saved rows for
 * exactly this course, nothing else, before the frontend clears its own
 * state.
 */
export async function DELETE(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ success: false, error: "Le paramètre 'slug' est requis." }, { status: 400 });
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`courses-chat-delete:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  // .eq("user_id", ...) on the DELETE itself is what stops one student from wiping another's history by guessing a slug.
  const { error } = await supabase.from("course_chat_history").delete().eq("user_id", user.id).eq("course_slug", slug);

  if (error) {
    console.error("[courses/chat DELETE] Échec suppression Supabase:", { code: error.code, message: error.message });
    return NextResponse.json({ success: false, error: `Suppression échouée : ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function POST(request: NextRequest) {
  const timer = createCopilotTimer("workspace");
  // Auth required — this triggers a real, billed OpenRouter call, and every
  // page that renders this chat already sits behind the /dashboard/** auth
  // gate, so a logged-out caller here is never a legitimate student, only a
  // direct-API abuse attempt. (Previously this route let an unauthenticated
  // caller stream a real answer without persisting it — that fallback is
  // intentionally removed: zero anonymous access, full stop.)
  const user = await getAuthenticatedUser();
  timer.mark("auth");
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`courses-chat:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const {
    slug,
    message,
    history,
    messages: historyAlias,
    concise,
    translate,
    selectedText,
    adjacentContext,
    mode,
    sourceCourseIds,
    structured,
  } = (body ?? {}) as {
    /** Workspace composer's answer mode (CHAT_MODES) — anything else is treated as "standard". */
    mode?: unknown;
    /** Extra Workspace courses (studio_courses ids) checked as chat context in the Sources panel, on top of the course in `slug`. Ownership-checked below. */
    sourceCourseIds?: unknown;
    /** Workspace renderer opt-in for medical callouts + verifiable citations (WORKSPACE_STRUCTURED_FORMAT_INSTRUCTION). */
    structured?: unknown;
    slug?: unknown;
    message?: unknown;
    /** The conversation so far, oldest first: [{ role: "user" | "assistant", content }] (lib/chat-history.ts). */
    history?: unknown;
    /** The same, under the name most chat APIs use — read when `history` is absent. */
    messages?: unknown;
    concise?: unknown;
    translate?: unknown;
    /** The exact text the student highlighted — presence of this (non-empty) is what triggers isHighlightMode below. Distinct from `message`, which stays the free-form question/instruction wrapping it. */
    selectedText?: unknown;
    /** Optional, tiny excerpt immediately surrounding the selection in the SAME course — never the whole document. See ADJACENT_CONTEXT_CHARS. */
    adjacentContext?: unknown;
  };
  const isConcise = concise === true;
  const isTranslate = translate === true;
  const chatMode: ChatMode = isChatMode(mode) ? mode : "standard";
  const isStructured = structured === true;
  const extraSourceCourseIds: number[] = Array.isArray(sourceCourseIds)
    ? Array.from(new Set(sourceCourseIds.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0)))
    : [];
  // Both are "quick action" modes for cache-gating purposes below — a cached
  // full-length answer would defeat a concise ask, and a cached translation
  // has no business being served for a differently-phrased normal question.
  const isQuickAction = isConcise || isTranslate;

  // The hard isolation switch: a quick action WITH a real selection attached
  // never sees the course's full raw_text, never sees chat history, and is
  // forced onto the cheap model — see buildHighlightSystemContent() and the
  // streamOpenRouter call below. A quick action fired with no selectedText
  // (shouldn't happen from the current UI, but the API contract must not
  // assume it) falls through to the normal path instead of erroring, so a
  // future caller that legitimately wants a concise NORMAL-context answer
  // still gets one.
  const trimmedSelectedText = typeof selectedText === "string" ? selectedText.trim() : "";
  const isHighlightMode = isQuickAction && trimmedSelectedText.length > 0;

  if (isHighlightMode && trimmedSelectedText.length > MAX_HIGHLIGHT_CHARS) {
    return NextResponse.json(
      {
        error: `Le passage sélectionné est trop long (${trimmedSelectedText.length} caractères, max ${MAX_HIGHLIGHT_CHARS}). Sélectionne un passage plus court.`,
      },
      { status: 413 }
    );
  }

  // Validated before ANY quota reservation below — a malformed or oversized
  // message used to be rejected only after the highlight pool had already
  // been charged, silently costing the student a unit for a 400.
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Le champ 'message' est requis." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Ton message est trop long (${message.length} caractères, max ${MAX_MESSAGE_CHARS}). Raccourcis-le et réessaie.` },
      { status: 400 }
    );
  }

  // Plan quota gates — strictly SEQUENTIAL relative to EACH OTHER (each is a
  // real reserve-with-refund-on-failure operation: running them concurrently
  // would let a later gate's RPC fire — and increment its own counter — even
  // when an earlier gate had already rejected the request, over-charging a
  // student's quota for a message that never actually sent). The chain as a
  // whole, though, runs ALONGSIDE the course-context retrieval and the
  // model's own time-to-first-token (2026-11-21): it is awaited only right
  // before the first byte would reach the student, and a refusal there
  // cancels the model before anything is sent.
  //  - Highlight mode ("Ask MedArt" / Translate on a selection): the access
  //    gate (a selection question is a message too: it uses the free trial's
  //    20), then its own separate highlightMessageCap pool.
  //  - Normal chat: the access gate (reserveAssistantAccess — may this message
  //    be sent, and may a paid model stand in if the free Omni model fails?
  //    Monetization v2: free trial = 20 messages for life, then paywall; paid
  //    = 20 premium-model messages a day, spent only when a paid model
  //    actually answers — reservePremiumFallback. Small talk — "salut",
  //    "merci", "ça va ?", lib/chat-intent.ts — is never worth a paid call),
  //    then the legacy monthly chat pool (reserveChatMessage — refunded by
  //    refundChatMessage if every model then fails). Semantic caching was
  //    REMOVED (product direction): every message reaches a real model call.
  type GateOutcome = { ok: true; access: AssistantAccess } | { ok: false; response: NextResponse };
  const gatesPromise: Promise<GateOutcome> = (async (): Promise<GateOutcome> => {
    if (isHighlightMode) {
      const highlightAccess = await reserveAssistantAccess(user);
      if (!highlightAccess.allowed) return { ok: false, response: quotaBlockedResponse(highlightAccess) };
      const gate = await reserveHighlightMessage(user);
      if (!gate.allowed) return { ok: false, response: NextResponse.json({ error: gate.reason }, { status: 403 }) };
      return { ok: true, access: highlightAccess };
    }
    const chatAccess = await reserveAssistantAccess(user, { needsPremium: !isSmallTalk(message) });
    if (!chatAccess.allowed) return { ok: false, response: quotaBlockedResponse(chatAccess) };
    const chatGate = await reserveChatMessage(user);
    if (!chatGate.allowed) return { ok: false, response: NextResponse.json({ error: chatGate.reason }, { status: 403 }) };
    return { ok: true, access: chatAccess };
  })();
  // The free-tier models' own hard, EXTERNAL, account-wide daily request cap
  // (shared with app/api/dashboard-assistant/route.ts, the voice dictation and
  // lib/cache-prewarming.ts — see that function's own comment), reserved once
  // for this message, after the student's own gates said yes. When it is
  // spent, the free models are skipped, never the paid fallback.
  const capacityPromise: Promise<PlatformCapacityResult> = gatesPromise.then((gates) => (gates.ok ? reserveFreeTierCapacity() : { allowed: false }));
  // Never left rejected and unobserved if the request ends early.
  gatesPromise.catch(() => undefined);
  capacityPromise.catch(() => undefined);

  const trimmedAdjacentContext =
    isHighlightMode && typeof adjacentContext === "string" && adjacentContext.trim()
      ? adjacentContext.trim().slice(0, ADJACENT_CONTEXT_CHARS)
      : null;

  const isBareGreetingMessage = isBareGreeting(message);

  const courseSlug = typeof slug === "string" && slug.trim() ? slug.trim() : null;
  const supabase = courseSlug && isSupabaseConfigured() ? getSupabaseAdmin() : null;

  // The whole conversation, read once (lib/chat-history.ts): failed replies
  // and empty bubbles left out, student → Copilot turns alternating; each
  // model then gets what its budget holds (buildMessages below). A bare
  // greeting forces this to empty regardless of what the client sent. A
  // highlight quick action ALSO forces this to empty — it's a self-contained,
  // stateless lookup on an isolated passage by design, and history is
  // exactly the kind of dynamic content that can't sit behind
  // buildHighlightSystemContent's isolation guarantee.
  const conversation: ChatHistoryTurn[] =
    isBareGreetingMessage || isHighlightMode ? [] : normalizeChatHistory(Array.isArray(history) ? history : historyAlias);

  // Save the student's message — its id is only ever read later, inside the
  // background persistence closure below (the "Nouvelle conversation" race
  // check), never on this handler's own critical path to the model call. Was
  // previously AWAITED right here regardless, costing one full DB round trip
  // before the daily/chat gates (and, transitively, the model call itself)
  // even started, for zero benefit to anything before that closure runs.
  // Fired without blocking instead; awaited where it's actually needed.
  // A highlight question is only saved once its gates said yes (they used to
  // run before this point; a refused selection question was never saved).
  let userMessageIdPromise: Promise<number | null> = Promise.resolve(null);
  if (supabase && user) {
    const gatedSave = isHighlightMode ? gatesPromise.then((gates) => gates.ok, () => false) : Promise.resolve(true);
    userMessageIdPromise = gatedSave.then((save) => {
      if (!save) return null;
      return saveUserMessage();
    });
  }
  async function saveUserMessage(): Promise<number | null> {
    if (!supabase) return null;
    return Promise.resolve(
      supabase
        .from("course_chat_history")
        .insert({ user_id: user!.id, course_slug: courseSlug, role: "user", content: message as string })
        .select("id")
        .single()
    ).then(({ data, error }) => {
      if (error) {
        console.error("[courses/chat POST] Échec sauvegarde message utilisateur:", { code: error.code, message: error.message });
        // Not fatal — the student can still get an answer even if we failed
        // to log their side of it.
        return null;
      }
      return (data as { id: number }).id;
    });
  }
  userMessageIdPromise.catch(() => undefined);

  // CAS 2 — Cache Miss: resolve context via RAG chunk retrieval ONLY.
  //
  // STRICT RULE (no exceptions): this route must NEVER inject a course's full
  // raw_text into the prompt — not from `courses.raw_text`, not from the
  // Workspace's inline `sourceText`, regardless of course size. A prior
  // version fell back to the whole document (up to CHAT_MAX_CONTEXT_CHARS =
  // 100 000 chars, ~25-30k tokens) whenever no indexed chunks were found —
  // that fallback is exactly what produced ~$0.03-0.04/message reports (a
  // fresh ~25k-token cache WRITE, at a premium, on every message that didn't
  // land a cache read). Removed entirely: `sourceText` below can only ever be
  // `null` (no chunks found — model answers from general medical knowledge,
  // per explicit product decision) or a handful of top-K retrieved chunks
  // (a few hundred to ~2k tokens). There is no code path left that can send
  // "the whole course" as a chat context block, at any size.
  //
  // A bare greeting or a highlight quick action skips this entirely. Fired
  // here as a promise, NOT awaited yet — retrieveRelevantContext is a pure,
  // fail-open READ with no side effects, so it's safe to let it run
  // CONCURRENTLY with the quota gates just below instead of strictly after
  // them: if a gate ends up rejecting, this result is simply discarded (one
  // wasted embedding+DB read in that comparatively rare case), in exchange
  // for real latency saved on every allowed message. The gates themselves
  // are NOT given the same treatment — see the comment just below for why.
  const contextPromise: Promise<string | null> =
    !isBareGreetingMessage && !isHighlightMode && courseSlug
      ? (async () => {
          try {
            // studio-course-{id} (Workspace) vs a real public course slug
            // (legacy pipeline) — the slug's own shape is enough to tell them apart.
            const studioIdMatch = courseSlug.match(/^studio-course-(\d+)$/);
            // SECURITY: studio_courses.id is a plain sequential bigint — without
            // this ownership check, ANY authenticated student could read ANY
            // other student's private course chunks/Explication by guessing a
            // small integer here (a real, confirmed IDOR — retrieveRelevantContext
            // itself queries studio_course_chunks by course_id alone, via the
            // service-role client, which bypasses that table's own RLS entirely).
            // Fails open to `null` (no course context, same as "not indexed yet")
            // rather than a distinguishable error — this must never become an
            // oracle for "does course id N exist".
            // Workspace multi-source path: the active course plus every
            // extra checked source, ranked together. Ownership-checked in ONE
            // query for all ids (same IDOR reasoning as the single-course
            // check below); the active course itself must be owned, exactly
            // as before, or the turn gets no course context at all.
            // The retrieval query, and its embedding requested AT ONCE
            // (2026-11-21): that OpenRouter round trip is the slowest step
            // here, and it only depends on the student's own words — it no
            // longer waits for the ownership check below (which still guards
            // every read of a course's content, exactly as before).
            const retrievalQuery = [message, ...conversation.slice(-2).map((turn) => turn.content.slice(0, RETRIEVAL_HISTORY_CHARS))].join("\n");
            const embedding = getEmbedding(retrievalQuery);
            embedding.catch(() => undefined);
            if (studioIdMatch && supabase && (isStructured || extraSourceCourseIds.length > 0)) {
              const activeId = Number(studioIdMatch[1]);
              const requestedIds = [activeId, ...extraSourceCourseIds.filter((id) => id !== activeId)].slice(0, MAX_CHAT_SOURCE_COURSES);
              const { data: ownedRows } = await supabase
                .from("studio_courses")
                .select("id, title")
                .in("id", requestedIds)
                .eq("user_id", user.id);
              const owned = (ownedRows ?? []) as { id: number; title: string }[];
              if (!owned.some((row) => row.id === activeId)) return null;
              // Active course first — purely cosmetic for the ranking (all
              // chunks compete equally), but keeps the order deterministic.
              owned.sort((a, b) => requestedIds.indexOf(a.id) - requestedIds.indexOf(b.id));
              return await retrieveRelevantContextForStudioCourses(retrievalQuery, owned, message, { embedding });
            }

            let chunkSource: { studioCourseId: number } | { legacyCourseSlug: string } | null = studioIdMatch
              ? { studioCourseId: Number(studioIdMatch[1]) }
              : { legacyCourseSlug: courseSlug };
            if (studioIdMatch && supabase) {
              const { data: ownedCourse } = await supabase
                .from("studio_courses")
                .select("id")
                .eq("id", Number(studioIdMatch[1]))
                .eq("user_id", user.id)
                .maybeSingle();
              if (!ownedCourse) chunkSource = null;
            }
            if (!chunkSource) return null;

            // A short, anaphoric follow-up ("zid chrahli b tafsil", "donne-moi un
            // exemple") embeds almost meaninglessly on its own — nothing in
            // "explain in more detail" itself names the actual medical topic, so
            // ranking chunks against THAT embedding alone would surface whatever
            // chunks happen to score highest for a generic phrase, not the ones
            // related to what's actually being discussed. Anchor the retrieval
            // query to the last couple of turns (already available here as
            // conversation, read above for the model call itself) so a
            // follow-up's embedding carries the real topic forward, not just its
            // own bare wording.
            return await retrieveRelevantContext(retrievalQuery, chunkSource, message, { embedding });
          } catch (error) {
            // Fails open to `null` (no course context at all), NEVER to the full
            // raw text — see the strict rule above.
            console.error("[courses/chat POST] Échec récupération contextuelle (fail-open, réponse sans contexte de cours):", error instanceof Error ? error.message : error);
            return null;
          }
        })()
      : Promise.resolve(null);

  // A refused gate answers at once — it must not wait for the course context.
  const refusedEarly = await Promise.race([
    gatesPromise.then((gates) => (gates.ok ? null : gates), () => null),
    contextPromise.then(() => null),
  ]);
  if (refusedEarly) {
    timer.log("quota-blocked");
    return refusedEarly.response;
  }
  const sourceText = await contextPromise;
  timer.mark("context");

  // Cached (static) content — system persona + course text. `false` below
  // (was `useAnthropicCaching`, computed from the old hybrid router): this
  // route no longer ever uses an Anthropic model, so cache_control is never
  // applicable — see buildSystemContent's own comment. Highlight mode builds
  // a deliberately different, much smaller message array: no cache_control
  // (a one-off selection has no repeated prefix to benefit from it
  // regardless of model), no history, no course text — see
  // buildHighlightSystemContent's own comment for exactly what it does and
  // doesn't receive.
  //
  // Dynamic system prompts (product order 2026-11-09, lib/ai/answer-depth.ts):
  // the same request in two versions, each sent only to the models it is
  // meant for — "detailed" (no length limit, the depth directive, the
  // proactive Wikimedia images except in "Synthèse express") to the free
  // models, "concise" (the persona's length target, plus the short-answer
  // note added at call time) to a paid fallback. The conversation travels as
  // messages (the recent turns) and, past each model's budget, as a condensed
  // memory before the course excerpts (lib/chat-history.ts). Everything else
  // (course excerpts, mode, format, the question) is identical.
  const buildMessages = (depth: AnswerDepth): ChatMessageInput[] => {
    if (isHighlightMode) {
      return [
        {
          role: "system",
          content: buildHighlightSystemContent(isTranslate, trimmedSelectedText, trimmedAdjacentContext, depth),
        },
        { role: "user", content: message },
      ];
    }
    const conversationSlice = selectHistory(conversation, depth === "detailed" ? FREE_MODEL_HISTORY_BUDGET : PAID_FALLBACK_HISTORY_BUDGET);
    return [
      {
        role: "system",
        content: buildSystemContent(
          sourceText,
          false,
          [
            buildChatModeInstruction(chatMode) ?? "",
            isStructured ? WORKSPACE_STRUCTURED_FORMAT_INSTRUCTION : "",
            depth === "detailed" && chatMode !== "express" ? MEDICAL_IMAGE_DIRECTIVE : "",
            conversationSlice.memory ?? "",
          ],
          depth === "detailed" ? CHAT_SYSTEM_PROMPT_DETAILED : CHAT_SYSTEM_PROMPT_BASE
        ),
      },
      ...conversationSlice.recent.map((turn): ChatMessageInput => ({ role: turn.role, content: turn.content })),
      { role: "user", content: message },
    ];
  };
  const freeModelMessages = buildMessages("detailed");
  const paidModelMessages = buildMessages("concise");

  // Hedged model race (2026-11-21 — lib/ai/first-token-race.ts, candidates
  // in lib/ai/omni-routing.ts's buildCopilotCandidates), same product order
  // as the Omni-first routing of 2026-11-09:
  //  1. PRIMARY_FREE_OMNI for every message (8192 tokens: free), the moment
  //     the student's gates and the free-tier capacity said yes — never
  //     before: a free request counts against OpenRouter's account-wide
  //     limits even when cancelled.
  //  2. CHAT_MODEL for a student whose plan grants it (500 tokens, a short
  //     answer asked for), as soon as Omni has failed OR after the hedge delay
  //     of Omni silence (COPILOT_HEDGE_MS; COPILOT_HIGHLIGHT_HEDGE_MS for
  //     "Ask MedArt" / Translate, product direction: an INSTANT answer). The
  //     first of the two to write wins, the other is cancelled; the daily
  //     premium message is reserved only when the paid model is about to answer.
  //  3. FREE_MODEL_CHAIN, the last zero-cost safety net, once every model
  //     before it has failed (or as a late net if they all stay silent).
  // A model erroring (saturation, a provider hiccup, a 429) is the EXPECTED,
  // routine case on free endpoints, not an exceptional one.
  // « Traduire » keeps its smaller ceiling; "Ask MedArt" gets a full answer's (MAX_OUTPUT_TOKENS_HIGHLIGHT's own comment).
  const maxTokensForThisTurn = isHighlightMode && isTranslate ? MAX_OUTPUT_TOKENS_HIGHLIGHT : MAX_OUTPUT_TOKENS_NORMAL;
  const accessPromise: Promise<AssistantAccess | null> = gatesPromise.then((gates) => (gates.ok ? gates.access : null));
  accessPromise.catch(() => undefined);
  const race = raceFirstToken(
    buildCopilotCandidates({
      freeMessages: freeModelMessages,
      // The concise persona; a free-form answer also gets the short-answer note
      // so it never stops mid-sentence (a highlight answer is already short by its prompt).
      paidMessages: isHighlightMode ? paidModelMessages : withPaidFallbackBrevity(paidModelMessages),
      freeCapacity: capacityPromise.then((result) => result.allowed, () => false),
      paidAllowed: accessPromise.then((gateAccess) => (gateAccess ? premiumFallbackMayBeAvailable(gateAccess) : false), () => false),
      commitPaid: async () => {
        const gateAccess = await accessPromise;
        return gateAccess ? reservePremiumFallback(user, gateAccess) : false;
      },
      // CHAT_MODEL: qwen3.7-flash — a hybrid thinking model, so reasoning is
      // switched OFF explicitly (measured: 0 reasoning tokens).
      paid: { model: CHAT_MODEL, reasoning: { enabled: false } },
      temperature: 0.3,
      freeChainMaxTokens: maxTokensForThisTurn,
      includeFreeChain: true,
      hedgeMs: isHighlightMode ? COPILOT_HIGHLIGHT_HEDGE_MS : COPILOT_HEDGE_MS,
    })
  );

  let gates: GateOutcome;
  try {
    gates = await gatesPromise;
  } catch (error) {
    race.abort();
    throw error;
  }
  timer.mark("gates");
  if (!gates.ok) {
    race.abort();
    timer.log("quota-blocked");
    return gates.response;
  }
  const freeTierCapacity = await capacityPromise;
  timer.mark("capacity");

  let responseStream: ReadableStream<Uint8Array>;
  try {
    const outcome = await race.promise;
    timer.mark("first_token");
    timer.log(`ok:${outcome.label}`, outcome.attempts);
    responseStream = outcome.stream;
  } catch (error) {
    const lastError = error instanceof RaceFailedError ? error.lastError : error;
    timer.mark("failed");
    timer.log("all-failed", error instanceof RaceFailedError ? error.attempts : undefined);
    // Every model tried (Omni, the paid fallback if granted, then the free
    // chain) failed. Refund whatever credit was reserved — a transient outage
    // across the whole free tier, or a platform-wide saturation the student
    // can't do anything about, shouldn't cost the student their allowance.
    // refundChatMessage/refundHighlightMessage take the user's id (a string),
    // not the whole authenticated User object.
    if (!isHighlightMode) {
      await refundChatMessage(user.id);
    } else {
      await refundHighlightMessage(user.id);
    }
    if (!freeTierCapacity.allowed) {
      return NextResponse.json({ error: freeTierCapacity.reason }, { status: 503 });
    }
    const errMessage = lastError instanceof Error ? lastError.message : String(lastError);
    const status = upstreamStatus(lastError);
    console.error("[courses/chat POST] Tous les modèles gratuits ont échoué:", { status, message: errMessage });
    return NextResponse.json(
      { error: "L'assistant est momentanément indisponible (forte demande sur les modèles gratuits) — réessaie dans une minute." },
      { status: status >= 400 && status < 600 ? status : 503 }
    );
  }

  // --- Background persistence (Étape E) ---------------------------
  // We tee the stream so the client gets its bytes immediately (low time-to-
  // first-token, streaming over text/event-stream) while a background closure
  // reads the exact same chunks, accumulates the full reply, and persists the
  // assistant's reply to course_chat_history. Vercel keeps the serverless
  // function execution context alive until both branches of the tee are
  // fully consumed, so the background write won't get cut off mid-stream.
  //
  // The reply's DB write happens AFTER the stream's last byte, i.e. after the
  // client already has its response — and a serverless function is only
  // guaranteed to keep running past the response when that work is handed to
  // waitUntil(). Without it the insert below could be frozen/killed before it
  // ran, which is exactly the "questions survive a refresh, answers don't"
  // bug: the student's row is written up-front (while the function is surely
  // alive), the assistant's row is the one written after the response ended.
  let accumulatedReply = "";
  const [streamForClient, streamForPersistence] = responseStream.tee();

  const persistReply = (async () => {
    try {
      const reader = streamForPersistence.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          accumulatedReply += decoder.decode(value, { stream: true });
        }
      }
      accumulatedReply += decoder.decode();

      // Strip any <think> reasoning before persisting — the client already
      // strips it live for rendering (see lib/strip-reasoning.ts), but the
      // SAVED row must be clean too, otherwise reloading the conversation
      // would resurrect the raw reasoning the live view had hidden.
      const finalTrimmed = stripReasoning(accumulatedReply);
      if (!finalTrimmed) return; // Empty stream (or reasoning-only), don't persist garbage.

      // Race check against DELETE /api/courses/chat ("Nouvelle conversation"):
      // If the student clicked reset while this generation was still streaming,
      // userMessageId's row (and any prior history for this slug/user) was
      // deleted. We check if the user message still exists before saving the
      // assistant reply — if it's gone, we drop the reply entirely, preventing
      // the orphaned single-message resurrection bug. userMessageIdPromise was
      // fired way back before the quota gates/model call, so it's already
      // resolved by the time the stream finishes — this await is instant in
      // practice, not a real wait.
      const userMessageId = await userMessageIdPromise;
      let shouldPersist = true;
      if (supabase && user && userMessageId !== null) {
        const { count, error: checkError } = await supabase
          .from("course_chat_history")
          .select("id", { count: "exact", head: true })
          .eq("id", userMessageId);
        if (!checkError && count === 0) {
          shouldPersist = false;
        }
      }

      if (shouldPersist && supabase && user) {
        const { error: insertError } = await supabase
          .from("course_chat_history")
          // sanitizeForPostgres: a stray NUL in model output makes Postgres reject the whole row (22P05).
          .insert({ user_id: user.id, course_slug: courseSlug, role: "assistant", content: sanitizeForPostgres(finalTrimmed) });
        if (insertError) {
          console.error("[courses/chat POST background] Échec sauvegarde réponse assistant:", { code: insertError.code, message: insertError.message });
        }
      }
    } catch (bgError) {
      console.error("[courses/chat POST background] Erreur inattendue pendant la persistance:", bgError);
    }
  })();
  waitUntil(persistReply);

  return new NextResponse(streamForClient, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Cache": "MISS",
      "Server-Timing": timer.serverTiming(),
    },
  });
}

/** The HTTP status a failed model call carried (OpenRouterError, or the race's own timeout / empty-stream errors), 500 otherwise. */
function upstreamStatus(error: unknown): number {
  if (error instanceof OpenRouterError) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 500;
}
