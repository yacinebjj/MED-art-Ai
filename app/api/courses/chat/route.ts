import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { HAIKU_MODEL, OpenRouterError, streamOpenRouter, type ChatMessageInput } from "@/lib/ai/openrouter";
import { errorMessage } from "@/lib/course-generation-shared";
import { lookupSemanticCache, storeSemanticCacheEntry } from "@/lib/ai/semantic-cache";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import {
  reserveChatMessage,
  refundChatMessage,
  reserveChatMessageDaily,
  reserveHighlightMessage,
  refundHighlightMessage,
} from "@/lib/subscription";
import { CHAT_MAX_CONTEXT_CHARS } from "@/lib/chat-constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONTEXT_CHARS = CHAT_MAX_CONTEXT_CHARS;
// 5 exchanges (10 messages) verbatim — cost analysis showed the OLD cap of
// 20 messages let a 30-question conversation's resent history alone balloon
// past 1M input tokens in the worst case. Plain truncation (not LLM
// summarization) is deliberate: summarizing would itself be a paid model
// call on every message, working against the very cost this exists to cut.
const MAX_HISTORY_MESSAGES = 10;

const CHAT_SYSTEM_PROMPT_BASE = `Tu es MedArt Assistant, un professeur de médecine expert et pédagogue qui aide des étudiants en médecine, en pharmacie et en chirurgie dentaire à comprendre leur cours.

Réponds de façon ultra-détaillée et rigoureuse, mais avec un ton conversationnel et chaleureux, comme si tu discutais avec l'étudiant en personne. Développe les mécanismes physiopathologiques en profondeur, donne des exemples concrets, et structure ta réponse (listes, **gras** sur les termes clés) quand ça aide à la clarté. N'hésite jamais à être exhaustif — un étudiant en médecine a besoin de comprendre le "pourquoi", pas juste le "quoi".

Si on te demande de traduire un terme ou un passage médical, traduis-le fidèlement puis ajoute, si utile, une courte clarification médicale. Réponds toujours en français, sauf si on te demande explicitement une traduction vers une autre langue.

CRITICAL INSTRUCTION: If the user's prompt consists of a short text excerpt, specific sentence, or paragraph, you MUST automatically recognize that they copy-pasted this directly from their medical course document. DO NOT summarize the whole document. Your SOLE purpose is to provide a laser-focused, ultra-detailed, deep medical explanation of THAT SPECIFIC EXCERPT within the context of the provided sources.

You are a deeply analytical AI. Always provide long-form, highly detailed, and comprehensive answers. IMPORTANT: If the user asks a non-medical question, general knowledge question, or casual query, DO NOT block it. Answer it naturally, deeply, and helpfully like a standard world-class AI.`;

// Appended ONLY for the "Ask MedArt" text-selection quick action (concise:
// true from the client) — never for the free-form chat input, so normal
// in-depth answers keep their full quality. Exact wording from the client's
// spec: this exists purely to cap OpenRouter/Anthropic/Gemini token spend on
// what's meant to be a quick lookup, not a full explanation.
const CONCISE_QUICK_ACTION_SUFFIX = `\n\nTu es un assistant médical. L'utilisateur te pose une question rapide sur un texte sélectionné. TES RÉPONSES DOIVENT ÊTRE EXTRÊMEMENT COURTES ET CONCISES. Va droit au but. N'ajoute aucun détail superflu, aucune introduction polie. Limite ta réponse à 2 ou 3 phrases maximum.`;

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

// Cap on the small pre/post excerpt taken from the SAME course text
// immediately around the highlighted passage — e.g. an abbreviation defined
// two lines earlier, or a dosage unit given in the preceding sentence.
// Deliberately small and symmetric: this is "enough to disambiguate a
// pronoun or an abbreviation", never "enough to reconstruct the whole
// document" — the isolation guarantee below depends on this staying tiny
// relative to MAX_CONTEXT_CHARS (20 000).
const ADJACENT_CONTEXT_CHARS = 300;

/**
 * Builds the system message for a NORMAL (non-highlight) chat turn, as TWO
 * cache-marked content blocks instead of one plain string:
 *   1. The persona/instructions — byte-identical across every course and
 *      every student, so it's the cache hit most likely to be reused
 *      platform-wide.
 *   2. The course's raw_text — identical across every question asked about
 *      THIS course (by one student, or by any number of students studying
 *      the same course within the cache's 5-minute window), but different
 *      per course.
 * Anthropic caches by exact-prefix match, so cache_control MUST sit on
 * static content only, and nothing dynamic (history, the new question) can
 * come before it in the request — see the message array assembly below.
 */
function buildSystemContent(sourceText: string | null): ChatMessageInput["content"] {
  const blocks: NonNullable<Extract<ChatMessageInput["content"], unknown[]>> = [
    { type: "text", text: CHAT_SYSTEM_PROMPT_BASE, cache_control: { type: "ephemeral" } },
  ];

  if (sourceText) {
    blocks.push({
      type: "text",
      text: `Voici le cours sur lequel l'étudiant travaille actuellement (utilise-le comme contexte quand c'est pertinent, mais tu peux aussi répondre à des questions plus générales) :\n"""\n${sourceText.slice(0, MAX_CONTEXT_CHARS)}\n"""`,
      cache_control: { type: "ephemeral" },
    });
  }

  return blocks;
}

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
function buildHighlightSystemContent(translate: boolean, selectedText: string, adjacentContext: string | null): string {
  const persona = translate ? TRANSLATE_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT_BASE + CONCISE_QUICK_ACTION_SUFFIX;
  const isolationNotice =
    "\n\nIMPORTANT : tu ne reçois PAS le cours complet ici, uniquement le passage ci-dessous (et un minuscule extrait adjacent si fourni). Réponds seulement à partir de ce texte — ne suppose jamais un contenu que tu ne peux pas voir.";
  const excerptBlock = adjacentContext
    ? `\n\nExtrait adjacent (contexte minimal, PAS le cours entier) :\n"""\n${adjacentContext}\n"""`
    : "";

  return `${persona}${isolationNotice}${excerptBlock}\n\nPassage sélectionné par l'étudiant :\n"""\n${selectedText}\n"""`;
}

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

function isHistoryTurn(value: unknown): value is HistoryTurn {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.role === "user" || candidate.role === "assistant") && typeof candidate.content === "string";
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
 * POST            -> streams the model's answer back as plain text (see
 *                     hooks/useCourseChat.ts on the frontend side) while
 *                     persisting both sides of the exchange to
 *                     `course_chat_history` — see the inline comments below
 *                     for exactly when each write happens relative to the
 *                     stream.
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
    .order("created_at", { ascending: true });

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
  // Auth required — this triggers a real, billed OpenRouter call, and every
  // page that renders this chat already sits behind the /dashboard/** auth
  // gate, so a logged-out caller here is never a legitimate student, only a
  // direct-API abuse attempt. (Previously this route let an unauthenticated
  // caller stream a real answer without persisting it — that fallback is
  // intentionally removed: zero anonymous access, full stop.)
  const user = await getAuthenticatedUser();
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
    concise,
    translate,
    sourceText: inlineSourceText,
    selectedText,
    adjacentContext,
  } = (body ?? {}) as {
    slug?: unknown;
    message?: unknown;
    history?: unknown;
    concise?: unknown;
    translate?: unknown;
    sourceText?: unknown;
    /** The exact text the student highlighted — presence of this (non-empty) is what triggers isHighlightMode below. Distinct from `message`, which stays the free-form question/instruction wrapping it. */
    selectedText?: unknown;
    /** Optional, tiny excerpt immediately surrounding the selection in the SAME course — never the whole document. See ADJACENT_CONTEXT_CHARS. */
    adjacentContext?: unknown;
  };
  const isConcise = concise === true;
  const isTranslate = translate === true;
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

  // Plan quota gate — highlight mode's own pool (chatMessageCap, the
  // free-form pool below, is checked separately after the semantic-cache
  // lookup — see the CAS 2 section below for why it can't be checked here).
  if (isHighlightMode) {
    const gate = await reserveHighlightMessage(user);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason }, { status: 403 });
    }
  }

  const trimmedAdjacentContext =
    isHighlightMode && typeof adjacentContext === "string" && adjacentContext.trim()
      ? adjacentContext.trim().slice(0, ADJACENT_CONTEXT_CHARS)
      : null;

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Le champ 'message' est requis." }, { status: 400 });
  }

  const isBareGreetingMessage = isBareGreeting(message);

  const courseSlug = typeof slug === "string" && slug.trim() ? slug.trim() : null;
  const supabase = courseSlug && isSupabaseConfigured() ? getSupabaseAdmin() : null;

  // Bound the context sent upstream — the last 5 exchanges is plenty of
  // continuity for a course-reading chat without letting the request grow
  // unbounded over a long session (see MAX_HISTORY_MESSAGES above for why
  // this is a hard truncation, not a summarization call). A bare greeting
  // forces this to empty regardless of what the client sent. A highlight
  // quick action ALSO forces this to empty — it's a self-contained,
  // stateless lookup on an isolated passage by design, and history is
  // exactly the kind of dynamic content that can't sit behind
  // buildHighlightSystemContent's isolation guarantee.
  const historyTurns: HistoryTurn[] =
    isBareGreetingMessage || isHighlightMode
      ? []
      : Array.isArray(history)
        ? history.filter(isHistoryTurn).slice(-MAX_HISTORY_MESSAGES)
        : [];

  // Save the student's message BEFORE anything else (cache lookup or model
  // call) — if either fails a moment later, their question is still on record.
  // The row's own id is captured (not just discarded) so the streaming
  // flush() below can detect a real, otherwise-invisible race: if the
  // student clicks "Nouvelle conversation" (DELETE /api/courses/chat, see
  // that route) while THIS reply is still generating, that row gets wiped
  // mid-flight — without this check, the assistant's reply would still
  // land in course_chat_history once the stream finishes, resurrecting a
  // one-sided, orphaned message right after the student was told the
  // conversation was cleared.
  let userMessageId: number | null = null;
  if (supabase && user) {
    const { data: insertedRow, error } = await supabase
      .from("course_chat_history")
      .insert({ user_id: user.id, course_slug: courseSlug, role: "user", content: message })
      .select("id")
      .single();
    if (error) {
      console.error("[courses/chat POST] Échec sauvegarde message utilisateur:", { code: error.code, message: error.message });
      // Not fatal — the student can still get an answer even if we failed
      // to log their side of it.
    } else {
      userMessageId = (insertedRow as { id: number }).id;
    }
  }

  // Daily chat gate — ATOMICALLY reserves (checks AND increments in one
  // step, see reserveChatMessageDaily's own comment) BEFORE the semantic-
  // cache lookup below, so it applies to cache HITS too, not just real
  // generations. Deliberate: DAILY_CHAT_LIMIT exists to bound request
  // VOLUME (abuse/scraping prevention), not spend — a script hammering
  // already-cached questions 500 times a day is exactly what this must
  // still block, even though every one of those answers is free.
  // reserveChatMessage's monthly chatMessageCap is NOT reserved here — that
  // cap represents paid-usage value to the student, and a $0 cache hit
  // shouldn't eat into it (unlike the daily cap, which is purely an
  // anti-abuse throttle, not a value ledger). No refund path needed for
  // this one: a cache hit can't fail, and the real-generation path reserves
  // it here, before anywhere the call could fail.
  if (!isHighlightMode) {
    const dailyGate = await reserveChatMessageDaily(user);
    if (!dailyGate.allowed) {
      return NextResponse.json({ error: dailyGate.reason }, { status: 403 });
    }
  }

  // --- Semantic cache interception (Étape B/C/D) ----------------------------
  // Runs BEFORE any OpenRouter call. lookupSemanticCache() already fails open
  // internally (returns null on any embedding/RPC error) — this outer
  // try/catch is a second, belt-and-suspenders layer so that even an
  // unexpected exception here can never turn into a 500 for the student; it
  // just degrades to a normal cache-miss generation below.
  // Skipped entirely for concise quick actions: the cache doesn't distinguish
  // "answered concisely" from "answered normally" for the same question, so
  // serving a cached full-length answer here would defeat the whole point of
  // the concise mode (and vice versa — caching a 2-sentence quick-action
  // answer under the same question would truncate a later full question).
  let cacheHit: Awaited<ReturnType<typeof lookupSemanticCache>> = null;
  try {
    cacheHit = isQuickAction || isBareGreetingMessage ? null : await lookupSemanticCache({ question: message, courseSlug });
  } catch (error) {
    console.error(
      "[courses/chat POST] Exception inattendue pendant le lookup du cache sémantique — bascule vers OpenRouter:",
      error instanceof Error ? error.message : error
    );
  }

  if (cacheHit) {
    // CAS 1 — Cache Hit: serve the stored answer instantly, zero OpenRouter
    // calls. Still persisted to course_chat_history exactly like a live
    // reply, so the student's transcript reads identically either way.
    if (supabase && user) {
      const { error } = await supabase
        .from("course_chat_history")
        .insert({ user_id: user.id, course_slug: courseSlug, role: "assistant", content: cacheHit.answer });
      if (error) {
        console.error("[courses/chat POST] Échec sauvegarde réponse (cache) assistant:", { code: error.code, message: error.message });
      }
    }

    // No separate "record" call needed here anymore — reserveChatMessageDaily
    // above already incremented the daily counter atomically before this
    // cache lookup even ran. The monthly value cap (chatMessageCap) was
    // never reserved for this path, and stays that way — only the abuse
    // throttle applies to a free hit.

    return new NextResponse(cacheHit.answer, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Cache": "HIT",
        "X-Cache-Similarity": cacheHit.similarity.toFixed(4),
      },
    });
  }

  // Monthly value cap — atomically RESERVED only here, after the semantic-
  // cache lookup came back empty: this is a genuine paid generation about to
  // happen, and a $0 cache hit must never consume it, mirroring
  // reserveGeneration's "cache hits don't count" rule. The daily
  // abuse-throttle was already reserved earlier (before the cache lookup)
  // since it applies to hits too. isHighlightMode is excluded — it already
  // reserved its own separate pool above. If the generation below then
  // fails before producing a reply, refundChatMessage() undoes this.
  if (!isHighlightMode) {
    const chatGate = await reserveChatMessage(user);
    if (!chatGate.allowed) {
      return NextResponse.json({ error: chatGate.reason }, { status: 403 });
    }
  }

  // CAS 2 — Cache Miss: resolve the course's source text (deferred to here —
  // no point paying this query on a cache hit, which needs neither it nor a
  // system prompt) and fall through to the normal generation path.
  // A caller with no matching `courses` table row (e.g. the studio_courses-
  // backed module workspace, which has its own separate table) can supply
  // the raw text directly instead — checked first so it always wins over a
  // (non-existent) DB lookup rather than silently losing context. A bare
  // greeting OR a highlight quick action skips this entirely — the isolation
  // guarantee for highlight mode means this variable must never even be
  // populated for it, let alone sent, so there is no code path by which the
  // full course text could leak into a highlight request.
  let sourceText: string | null = null;
  if (!isBareGreetingMessage && !isHighlightMode) {
    sourceText = typeof inlineSourceText === "string" && inlineSourceText.trim() ? inlineSourceText : null;
    if (!sourceText && courseSlug && isSupabaseConfigured()) {
      const admin = getSupabaseAdmin();
      // Previously ignored `error` entirely — a genuine DB failure here was
      // indistinguishable from "this course has no raw_text", so the chat
      // silently answered with zero course context instead of surfacing
      // the failure. Still fails open (log, don't 500): the assistant can
      // legitimately answer general questions with no course loaded, so a
      // transient read failure on this ONE course's context shouldn't take
      // the whole chat down. Found during a security audit.
      const { data, error } = await admin.from("courses").select("raw_text").eq("slug", courseSlug).maybeSingle();
      if (error) {
        console.error("[courses/chat POST] Échec lecture raw_text (contexte de cours perdu pour cette réponse):", { code: error.code, message: error.message });
      }
      sourceText = (data as { raw_text: string | null } | null)?.raw_text ?? null;
    }
  }

  // Cached (static) content — system persona + course text — MUST come
  // before any dynamic content (history, the new question) for Anthropic's
  // prefix-based cache to have a chance of matching. Highlight mode builds a
  // deliberately different, much smaller message array: no cache_control (a
  // one-off selection has no repeated prefix to benefit from it), no
  // history, no course text — see buildHighlightSystemContent's own comment
  // for exactly what it does and doesn't receive.
  const messages: ChatMessageInput[] = isHighlightMode
    ? [
        { role: "system", content: buildHighlightSystemContent(isTranslate, trimmedSelectedText, trimmedAdjacentContext) },
        { role: "user", content: message },
      ]
    : [
        { role: "system", content: buildSystemContent(sourceText) },
        ...historyTurns,
        { role: "user", content: message },
      ];

  try {
    // Highlight mode forces the cheap model AND a hard, low output ceiling —
    // "2-3 phrases maximum" is already in the prompt, but a token cap is a
    // real backstop against the model ignoring that instruction, not just a
    // polite request. 4096 (normal mode) vs 400 (highlight) is deliberate,
    // not a rounding choice: a highlight answer that needed more than ~300
    // words would mean the isolation itself was the wrong call for that
    // question, not that the cap should be raised.
    const stream = await streamOpenRouter(
      messages,
      isHighlightMode ? { maxTokens: 400, model: HAIKU_MODEL } : { maxTokens: 4096 }
    );

    // Tee the stream: every chunk is forwarded to the client the instant it
    // arrives (zero added latency, nothing buffered), while the SAME bytes
    // are accumulated in `fullReply`. Only once the model is completely done
    // — i.e. once `flush()` fires, strictly after the client has already
    // received every chunk — do we write the full assistant reply to
    // Supabase AND index it into the semantic cache. The client never waits
    // on either write; neither is even in the response path by the time it
    // runs.
    let fullReply = "";
    const decoder = new TextDecoder();
    const persistOnFlush = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        fullReply += decoder.decode(chunk, { stream: true });
        controller.enqueue(chunk);
      },
      async flush() {
        if (!fullReply.trim()) return;

        await Promise.all([
          (async () => {
            if (!supabase || !user) return;

            // If this exchange's own user-message row is gone, the
            // conversation was explicitly reset (DELETE /api/courses/chat,
            // "Nouvelle conversation") while this reply was still
            // generating — persisting it now would resurrect a one-sided,
            // orphaned message right after the student was told the
            // history was cleared. Only checked when an id was actually
            // captured; if that first insert itself failed for an
            // unrelated reason, there's no conflicting row to worry about
            // and the reply is persisted as before.
            if (userMessageId !== null) {
              const { data: stillExists } = await supabase
                .from("course_chat_history")
                .select("id")
                .eq("id", userMessageId)
                .maybeSingle();
              if (!stillExists) return;
            }

            const { error } = await supabase
              .from("course_chat_history")
              .insert({ user_id: user.id, course_slug: courseSlug, role: "assistant", content: fullReply });
            if (error) {
              console.error("[courses/chat POST] Échec sauvegarde réponse assistant:", { code: error.code, message: error.message });
            }
          })(),
          isQuickAction || isBareGreetingMessage
            ? Promise.resolve()
            : storeSemanticCacheEntry({ question: message, answer: fullReply, courseSlug }),
          // No "record usage" call needed here anymore — reserveHighlightMessage
          // / reserveChatMessage / reserveChatMessageDaily above already
          // incremented atomically, before streamOpenRouter was even called.
        ]);
      },
    });

    return new NextResponse(stream.pipeThrough(persistOnFlush), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    // Refunds the reservation(s) taken above — but only covers a failure
    // while SETTING UP the stream (streamOpenRouter() itself throwing,
    // e.g. connection/auth/upstream-rate-limit errors before any bytes
    // stream back). A failure mid-stream, AFTER this function has already
    // returned the Response to Next.js, is a known, separate gap this fix
    // does not close — flush() may not even run in that case, so neither
    // persistence nor a refund happens today. Flagged, not silently claimed
    // as solved; a real fix needs an error handler on the stream itself.
    if (isHighlightMode) {
      await refundHighlightMessage(user.id);
    } else {
      await refundChatMessage(user.id);
    }
    if (error instanceof OpenRouterError) {
      console.error(`[courses/chat POST] Erreur OpenRouter (status ${error.status}):`, error.message);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[courses/chat POST] Erreur non gérée:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
