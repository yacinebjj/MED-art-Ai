import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { OpenRouterError, streamOpenRouter, FREE_MODEL_CHAIN, CHEAP_MODEL, type ChatMessageInput } from "@/lib/ai/openrouter";
import { errorMessage } from "@/lib/course-generation-shared";
import { retrieveRelevantContext } from "@/lib/chat-context-retrieval";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import {
  reserveChatMessage,
  refundChatMessage,
  reserveChatMessageDaily,
  reserveHighlightMessage,
  refundHighlightMessage,
} from "@/lib/subscription";
import { reserveFreeTierCapacity } from "@/lib/platform-spend-guard";
import { CHAT_SYSTEM_PROMPT_BASE, buildSystemContent } from "@/lib/chat-system-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // streamed chat reply — no explicit cap before, so it silently rode Vercel's platform default.

// 5 exchanges (10 messages) verbatim — cost analysis showed the OLD cap of
// 20 messages let a 30-question conversation's resent history alone balloon
// past 1M input tokens in the worst case. Plain truncation (not LLM
// summarization) is deliberate: summarizing would itself be a paid model
// call on every message, working against the very cost this exists to cut.
const MAX_HISTORY_MESSAGES = 10;

// This route now runs EXCLUSIVELY on lib/ai/openrouter.ts's FREE_MODEL_CHAIN
// (":free"-suffixed models — see that constant's own comment for which
// ones, and the live verification behind them) — an explicit product
// decision to trade the previously-tuned Haiku/economy hybrid routing (and
// its cost-control reasoning) for genuinely zero marginal cost, ACCEPTING a
// real, unverified quality risk on this app's core medical-explanation
// surface (see the git history / conversation around this change for the
// full trade-off discussion). lib/chat-model-routing.ts is left in place,
// unused but intact, specifically so reverting to paid hybrid routing later
// is a small, contained change if this experiment doesn't hold up.
//
// 8192 (raised from 800/1500 on explicit request) — free-tier models are
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
// Highlight quick actions stay deliberately smaller than the main flow (a
// concise 2-3 sentence answer, or a translation of an ≤800-char excerpt
// never needs anywhere near 8192) but still raised from the original 700 —
// same defensive margin against an unverified free model's reasoning
// overhead as MAX_OUTPUT_TOKENS_NORMAL above.
const MAX_OUTPUT_TOKENS_HIGHLIGHT = 1500;

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

// The free-form chat `message` field had NO length cap at all — every other
// user-controlled input into this route (selectedText above, adjacentContext,
// sourceText via MAX_CONTEXT_CHARS, history via MAX_HISTORY_MESSAGES) was
// bounded, but a student could paste an arbitrarily large message directly
// into the prompt, undermining every token-budget assumption this cost
// model relies on. Found during a security audit. 4000 chars is generous
// for a real question (well above what a highlight quick-action's
// "instruction" text ever needs) while still bounding worst-case spend.
const MAX_MESSAGE_CHARS = 4000;

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
    selectedText,
    adjacentContext,
  } = (body ?? {}) as {
    slug?: unknown;
    message?: unknown;
    history?: unknown;
    concise?: unknown;
    translate?: unknown;
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
  // free-form pool below, is checked separately further down).
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
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Ton message est trop long (${message.length} caractères, max ${MAX_MESSAGE_CHARS}). Raccourcis-le et réessaie.` },
      { status: 400 }
    );
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

  // Save the student's message — its id is only ever read later, inside the
  // background persistence closure below (the "Nouvelle conversation" race
  // check), never on this handler's own critical path to the model call. Was
  // previously AWAITED right here regardless, costing one full DB round trip
  // before the daily/chat gates (and, transitively, the model call itself)
  // even started, for zero benefit to anything before that closure runs.
  // Fired without blocking instead; awaited where it's actually needed.
  let userMessageIdPromise: Promise<number | null> = Promise.resolve(null);
  if (supabase && user) {
    userMessageIdPromise = Promise.resolve(
      supabase
        .from("course_chat_history")
        .insert({ user_id: user.id, course_slug: courseSlug, role: "user", content: message })
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
            // historyTurns, computed above for the model call itself) so a
            // follow-up's embedding carries the real topic forward, not just its
            // own bare wording.
            const retrievalQuery = [...historyTurns.slice(-2).map((turn) => turn.content), message].join("\n");
            return await retrieveRelevantContext(retrievalQuery, chunkSource);
          } catch (error) {
            // Fails open to `null` (no course context at all), NEVER to the full
            // raw text — see the strict rule above.
            console.error("[courses/chat POST] Échec récupération contextuelle (fail-open, réponse sans contexte de cours):", error instanceof Error ? error.message : error);
            return null;
          }
        })()
      : Promise.resolve(null);

  // Daily chat gate — ATOMICALLY reserves (checks AND increments in one
  // step, see reserveChatMessageDaily's own comment). Deliberate:
  // DAILY_CHAT_LIMIT exists to bound request VOLUME (abuse/scraping
  // prevention), not spend — a script hammering the same question 500 times
  // a day is exactly what this must still block. reserveChatMessage's
  // monthly chatMessageCap is reserved separately just below.
  //
  // REPURPOSED (product direction) — this gate no longer BLOCKS the
  // request on `!allowed`. It now decides which model TIER this message
  // gets: the first DAILY_CHAT_LIMIT (20) messages/day route to CHEAP_MODEL
  // (DeepSeek, paid but cheap and fast); every message after that silently
  // falls back to FREE_MODEL_CHAIN — same zero-alert, zero-error-message
  // transition the free-model fallback loop below already does for a
  // mid-tier outage. The atomic RPC itself is UNCHANGED (still the same
  // TOCTOU-safe reserve_daily_chat_messages_used — see that function's own
  // security-fix comment in lib/subscription.ts) — only how this route
  // reacts to its result changed. Highlight mode ("Ask MedArt" on a
  // selection) is deliberately excluded, same as before: it has its own,
  // separate highlightMessageCap pool, untouched by this daily counter.
  //
  // This gate, reserveChatMessage, and reserveFreeTierCapacity stay strictly
  // SEQUENTIAL relative to EACH OTHER (unlike contextPromise above) — each
  // is a real reserve-with-refund-on-failure operation (see
  // reserveChatMessage's own comment: it increments a usage counter
  // immediately, refunded only if the generation later fails). Running them
  // concurrently would let a later gate's RPC fire — and increment its own
  // counter — even when an earlier gate had already rejected the request,
  // over-charging a student's quota for a message that never actually sent.
  let useDeepSeekTier = false;
  if (!isHighlightMode) {
    const dailyGate = await reserveChatMessageDaily(user);
    useDeepSeekTier = dailyGate.allowed;
  }

  // Semantic caching REMOVED (product direction) — every chat message now
  // always reaches a real OpenRouter call below, no "serve a stored answer
  // for a similar-enough prior question" interception. isHighlightMode is
  // excluded — it already reserved its own separate pool above. If the
  // generation below then fails before producing a reply,
  // refundChatMessage() undoes this.
  if (!isHighlightMode) {
    const chatGate = await reserveChatMessage(user);
    if (!chatGate.allowed) {
      return NextResponse.json({ error: chatGate.reason }, { status: 403 });
    }
  }

  const sourceText = await contextPromise;

  // Cached (static) content — system persona + course text. `false` below
  // (was `useAnthropicCaching`, computed from the old hybrid router): this
  // route no longer ever uses an Anthropic model, so cache_control is never
  // applicable — see buildSystemContent's own comment. Highlight mode builds
  // a deliberately different, much smaller message array: no cache_control
  // (a one-off selection has no repeated prefix to benefit from it
  // regardless of model), no history, no course text — see
  // buildHighlightSystemContent's own comment for exactly what it does and
  // doesn't receive.
  const messages: ChatMessageInput[] = isHighlightMode
    ? [
        {
          role: "system",
          content: buildHighlightSystemContent(isTranslate, trimmedSelectedText, trimmedAdjacentContext),
        },
        { role: "user", content: message },
      ]
    : [
        {
          role: "system",
          content: buildSystemContent(sourceText, false),
        },
        ...historyTurns.map((t): ChatMessageInput => ({ role: t.role, content: t.content })),
        { role: "user", content: message },
      ];

  // Try each candidate model in order — the first one that succeeds wins.
  // `useDeepSeekTier` prepends CHEAP_MODEL (DeepSeek) when this message is
  // within the daily 20-message paid allowance (see the dailyGate comment
  // above); every other case (highlight mode, or the daily cap already
  // spent) uses FREE_MODEL_CHAIN exactly as before. Mirrors
  // app/api/dashboard-assistant/route.ts's own fallback loop: a model
  // erroring (momentary saturation, a provider hiccup, a rate-limit blip) is
  // the EXPECTED, routine case here, not an exceptional one — this is also
  // what makes DeepSeek's own transient failures fall through to the free
  // chain automatically, for free, with no extra handling. `reasoning: {
  // effort: "low" }` applied to every attempt — see MAX_OUTPUT_TOKENS_NORMAL's
  // own comment for why this is a defensive default now, not a
  // model-specific fix like it was for ECONOMY_MODEL; it's a documented
  // no-op on a model (like DeepSeek here) that doesn't support it.
  let responseStream: ReadableStream<Uint8Array> | null = null;
  let lastError: unknown = null;
  const maxTokensForThisTurn = isHighlightMode ? MAX_OUTPUT_TOKENS_HIGHLIGHT : MAX_OUTPUT_TOKENS_NORMAL;

  if (useDeepSeekTier) {
    try {
      responseStream = await streamOpenRouter(messages, {
        model: CHEAP_MODEL,
        temperature: 0.3,
        maxTokens: maxTokensForThisTurn,
        reasoning: { effort: "low" },
      });
    } catch (error) {
      lastError = error;
      console.error("[courses/chat POST] CHEAP_MODEL (DeepSeek) indisponible, bascule silencieuse sur la chaîne gratuite:", error instanceof Error ? error.message : error);
    }
  }

  if (!responseStream) {
    // Reached either because this message was already over the daily paid
    // allowance (or is highlight mode, never eligible for it), or DeepSeek
    // just failed above — NOW reserve the free-tier models' own hard,
    // EXTERNAL, account-wide daily request cap (shared with
    // app/api/dashboard-assistant/route.ts and lib/cache-prewarming.ts — see
    // that function's own comment), since we're actually about to spend some
    // of it. Checking this BEFORE knowing whether DeepSeek would succeed
    // would wrongly block a message the paid tier could have served fine,
    // just because the free tier happens to be saturated.
    const freeTierCapacity = await reserveFreeTierCapacity();
    if (!freeTierCapacity.allowed) {
      return NextResponse.json({ error: freeTierCapacity.reason }, { status: 503 });
    }

    for (const model of FREE_MODEL_CHAIN) {
      try {
        responseStream = await streamOpenRouter(messages, {
          model,
          temperature: 0.3,
          maxTokens: maxTokensForThisTurn,
          reasoning: { effort: "low" },
        });
        break;
      } catch (error) {
        lastError = error;
        console.error(
          `[courses/chat POST] Modèle gratuit "${model}" indisponible, bascule sur le suivant:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  if (!responseStream) {
    // Every model tried (DeepSeek if applicable, then the whole free chain)
    // failed. Refund whatever credit was reserved — a transient outage
    // across the whole free tier shouldn't cost the student their monthly
    // allowance. refundChatMessage/refundHighlightMessage take the user's
    // id (a string), not the whole authenticated User object.
    if (!isHighlightMode) {
      await refundChatMessage(user.id);
    } else {
      await refundHighlightMessage(user.id);
    }
    const errMessage = lastError instanceof Error ? lastError.message : String(lastError);
    const status = lastError instanceof OpenRouterError ? lastError.status : 500;
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
  let accumulatedReply = "";
  const [streamForClient, streamForPersistence] = responseStream.tee();

  (async () => {
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

      const finalTrimmed = accumulatedReply.trim();
      if (!finalTrimmed) return; // Empty stream, don't persist garbage.

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
          .insert({ user_id: user.id, course_slug: courseSlug, role: "assistant", content: finalTrimmed });
        if (insertError) {
          console.error("[courses/chat POST background] Échec sauvegarde réponse assistant:", { code: insertError.code, message: insertError.message });
        }
      }
    } catch (bgError) {
      console.error("[courses/chat POST background] Erreur inattendue pendant la persistance:", bgError);
    }
  })();

  return new NextResponse(streamForClient, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Cache": "MISS",
    },
  });
}