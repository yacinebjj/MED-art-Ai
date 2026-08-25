import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { OpenRouterError, streamOpenRouter, type ChatMessageInput } from "@/lib/ai/openrouter";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // streamed chat reply — no explicit cap before, so it silently rode Vercel's platform default.

/**
 * MedArt Assistant — free-flowing companion chat, distinct from
 * app/api/courses/chat/route.ts (which is scoped to one course's raw_text).
 * No course context here, so no source-text cache breakpoint like that
 * route has — but the SYSTEM PROMPT itself is byte-identical across every
 * student, every conversation, forever, which is exactly what Anthropic
 * prompt caching wants: marked cache_control below so only the very first
 * call platform-wide (or the first one past the TTL) pays full price for it.
 *
 * Stateless server-side: history lives in the client's React state only
 * (per spec — "maintains conversation history in the state"), nothing is
 * persisted to Supabase here. A refresh loses the conversation. If that
 * needs to survive a refresh later, that's a real, separate feature
 * (a table + GET/POST pair, same shape as course_chat_history).
 *
 * Also not wired into the plan-quota system (courses/highlight_messages) —
 * this is a third kind of AI usage the 6 plans don't currently meter at
 * all. Flagged, not hidden: decide deliberately whether it needs its own
 * quota before this ships to real students, don't assume it's covered.
 */

const MAX_HISTORY_MESSAGES = 20; // more headroom than course-chat's 10 — no source-text context competing for the same token budget here
const MAX_MESSAGE_CHARS = 4000;

// Merged, not replaced, for the third round running: the multilingual
// requirement (Darija/French/English) is still real and was never
// rescinded — students genuinely switch languages mid-conversation, and
// dropping it silently just because a new prompt draft didn't repeat it
// would be a real regression, not a polish. The new "senior resident"
// persona and strict formatting rules stack on top of it.
const ASSISTANT_SYSTEM_PROMPT = `You are MedArt Assistant. You MUST fluently understand and respond in Algerian Darija, French, and English depending on the user's input — medical students in Algeria switch between all three mid-conversation, and this must never break.

Your personality is a senior medical resident guiding a fellow student: professional, concise, and structured. Your role is to help them organize their studies (e.g., Cardiology, Pneumology), explain complex medical concepts simply, and provide emotional support for study stress when needed.

Your output format is strictly Academic-Clinical. Use Markdown tables for comparisons. BOLD all medical terminology. NO EMOJIS. If you use an emoji, you are violating the core directive.`;

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

  const rl = rateLimit(`assistant:${user.id}`, RATE_LIMITS.ai);
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

  const { message, history } = (body ?? {}) as { message?: unknown; history?: unknown };

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Le champ 'message' est requis." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: `Message trop long (max ${MAX_MESSAGE_CHARS} caractères).` }, { status: 413 });
  }

  const historyTurns: HistoryTurn[] = Array.isArray(history) ? history.filter(isHistoryTurn).slice(-MAX_HISTORY_MESSAGES) : [];

  const messages: ChatMessageInput[] = [
    { role: "system", content: [{ type: "text", text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }] },
    ...historyTurns,
    { role: "user", content: message },
  ];

  try {
    // No `model` override — defaults to the same model the rest of the app
    // uses (lib/ai/openrouter.ts's MODEL constant, currently
    // "anthropic/claude-sonnet-5"; the exact "Claude 3.5 Sonnet" id isn't
    // what's actually configured here, matching every other route in the app).
    const stream = await streamOpenRouter(messages, { maxTokens: 2048 });

    return new NextResponse(stream, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      console.error(`[assistant] Erreur OpenRouter (status ${error.status}):`, error.message);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[assistant] Erreur non gérée:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
