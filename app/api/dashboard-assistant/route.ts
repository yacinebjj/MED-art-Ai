import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { OpenRouterError, streamOpenRouter, FREE_MODEL_CHAIN, CHEAP_MODEL, type ChatMessageInput } from "@/lib/ai/openrouter";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveFreeTierCapacity } from "@/lib/platform-spend-guard";
import { reserveChatMessageDaily } from "@/lib/subscription";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Raised from 60 alongside MAX_OUTPUT_TOKENS below (1000 -> 8192) — a free-
// tier endpoint isn't necessarily prioritized the way a paid call is, so a
// genuinely long reply can take meaningfully longer to finish streaming.
// Without more wall-clock headroom here, Vercel's own function timeout
// could still cut a long reply off mid-stream even though MAX_OUTPUT_TOKENS
// itself would have allowed it to finish — same failure the token-side fix
// is meant to remove, just from the platform side instead of ours. 120s
// matches the precedent already used for this app's other long-running
// stream (app/api/courses/chat/route.ts).
export const maxDuration = 120;

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
 * MODEL TIER (product direction) — no longer free-only. The first
 * DAILY_CHAT_LIMIT (20, see lib/subscription.ts) messages/day route to
 * CHEAP_MODEL (DeepSeek, paid but cheap and fast); every message after that
 * silently falls back to FREE_MODEL_CHAIN below — zero alert, zero error
 * shown, same "try the next one" mechanism the free-model loop already used.
 * The daily gate is reserveChatMessageDaily, the SAME atomic, TOCTOU-safe RPC
 * app/api/courses/chat/route.ts already reserves against — this route now
 * shares that one daily pool instead of having none at all.
 *
 * FREE_MODEL_CHAIN lives in lib/ai/openrouter.ts (shared with courses/chat
 * and lib/cache-prewarming.ts) — see that constant's own comment for the
 * live verification (2026-08-29) behind these exact ids.
 */
const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_MESSAGES = 20;
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

const SYSTEM_PROMPT = `Tu es l'Assistant MedArt — un assistant généraliste et bienveillant pour des étudiants en médecine, pharmacie et chirurgie dentaire. MIROIR DE LANGUE STRICT : réponds TOUJOURS dans la langue du dernier message de l'étudiant, jamais un défaut fixe — anglais reçu -> réponds en anglais, arabe classique -> arabe classique, Darija algérienne -> Darija algérienne (naturelle, pas de l'arabe classique traduit), français -> français. Réponds de façon claire et utile, à toute question : organisation des études, motivation, culture générale, questions pratiques. Ne donne jamais de conseil destiné à être appliqué directement à un patient réel — si une question semble décrire un cas réel plutôt qu'une question d'étudiant, oriente vers un professionnel de santé.`;

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

function isHistoryTurn(value: unknown): value is HistoryTurn {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.role === "user" || candidate.role === "assistant") && typeof candidate.content === "string";
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
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

  const { message, history, image, document } = (body ?? {}) as {
    message?: unknown;
    history?: unknown;
    /** Rejected below — the free-tier model chain is verified text-only (no vision). Sent by the shared assistant UI (app/dashboard/(shell)/assistant/page.tsx), which also targets the paid, vision-capable route — must be refused explicitly here, not silently ignored, so a student who attaches an image gets an honest message instead of a reply that quietly never looked at it. */
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
  if (image !== undefined) {
    return NextResponse.json(
      { error: "L'analyse d'image n'est pas disponible sur l'assistant gratuit (modèles texte uniquement). Essaie sans image, ou utilise le chat d'un cours pour ce type de contenu." },
      { status: 400 }
    );
  }

  let documentAttachment: { fileName: string; text: string } | null = null;
  if (document !== undefined) {
    const candidate = document as { fileName?: unknown; text?: unknown };
    if (typeof candidate.fileName !== "string" || typeof candidate.text !== "string") {
      return NextResponse.json({ error: "Document invalide." }, { status: 400 });
    }
    documentAttachment = { fileName: candidate.fileName.slice(0, 200), text: candidate.text.slice(0, MAX_DOCUMENT_CHARS) };
  }

  const historyTurns: HistoryTurn[] = Array.isArray(history) ? history.filter(isHistoryTurn).slice(-MAX_HISTORY_MESSAGES) : [];

  // Daily paid-tier gate (see this file's header comment) — decides whether
  // THIS message tries CHEAP_MODEL first. Deliberately checked BEFORE (and
  // independently of) reserveFreeTierCapacity below: a message served by
  // DeepSeek touches the free tier's external ceiling not at all, so it must
  // never be blocked by that unrelated circuit breaker being saturated.
  const dailyGate = await reserveChatMessageDaily(user);

  const messages: ChatMessageInput[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(documentAttachment
      ? [
          {
            role: "system" as const,
            content: `Voici le contenu extrait du document que l'étudiant vient d'importer ("${documentAttachment.fileName}") — utilise-le comme contexte pour répondre à sa question ci-dessous quand c'est pertinent :\n"""\n${documentAttachment.text}\n"""`,
          },
        ]
      : []),
    ...historyTurns.map((turn): ChatMessageInput => ({ role: turn.role, content: turn.content })),
    { role: "user", content: message },
  ];

  // Try each candidate model in order — the first one that succeeds wins. A
  // model erroring (momentary saturation, a provider hiccup, a rate-limit
  // blip) is the EXPECTED, routine case here, not an exceptional one — this
  // is also what makes a DeepSeek failure fall through to the free chain
  // automatically, silently, with no separate handling needed.
  let lastError: unknown = null;

  if (dailyGate.allowed) {
    try {
      const stream = await streamOpenRouter(messages, { model: CHEAP_MODEL, maxTokens: MAX_OUTPUT_TOKENS, temperature: 0.5 });
      return new NextResponse(stream, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Model-Used": CHEAP_MODEL },
      });
    } catch (error) {
      lastError = error;
      console.error("[dashboard-assistant] CHEAP_MODEL (DeepSeek) indisponible, bascule silencieuse sur la chaîne gratuite:", error instanceof Error ? error.message : error);
    }
  }

  // Reached either because the daily paid allowance is already spent, or
  // DeepSeek just failed above — NOW reserve the shared external free-tier
  // ceiling (see reserveDashboardAssistantCapacity's own comment), since
  // we're actually about to spend some of it.
  const capacity = await reserveFreeTierCapacity();
  if (!capacity.allowed) {
    return NextResponse.json({ error: capacity.reason }, { status: 503 });
  }

  for (const model of FREE_MODEL_CHAIN) {
    try {
      const stream = await streamOpenRouter(messages, { model, maxTokens: MAX_OUTPUT_TOKENS, temperature: 0.5 });
      return new NextResponse(stream, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Model-Used": model },
      });
    } catch (error) {
      lastError = error;
      console.error(
        `[dashboard-assistant] Modèle gratuit "${model}" indisponible, bascule sur le suivant:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  // Every free model in the chain failed — the ONLY case the student sees
  // an error. Deliberately NEVER falls back to a paid model: that would
  // silently defeat the entire point of this feature (genuinely zero
  // marginal cost) the exact moment free capacity is actually saturated.
  const status = lastError instanceof OpenRouterError ? lastError.status : 503;
  console.error("[dashboard-assistant] Tous les modèles gratuits ont échoué:", lastError instanceof Error ? lastError.message : lastError);
  return NextResponse.json(
    { error: "L'assistant gratuit est momentanément indisponible (forte demande) — réessaie dans une minute." },
    { status: status >= 400 && status < 600 ? status : 503 }
  );
}
