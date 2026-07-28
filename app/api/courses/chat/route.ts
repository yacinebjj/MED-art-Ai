import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { OpenRouterError, streamOpenRouter, type ChatMessageInput } from "@/lib/ai/openrouter";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONTEXT_CHARS = 20_000;
// 5 exchanges (10 messages) verbatim — cost analysis showed the OLD cap of
// 20 messages let a 30-question conversation's resent history alone balloon
// past 1M input tokens in the worst case. Plain truncation (not LLM
// summarization) is deliberate: summarizing would itself be a paid model
// call on every message, working against the very cost this exists to cut.
const MAX_HISTORY_MESSAGES = 10;

const CHAT_SYSTEM_PROMPT_BASE = `Tu es MedArt Assistant, un professeur de médecine expert et pédagogue qui aide des étudiants en médecine, en pharmacie et en chirurgie dentaire à comprendre leur cours.

Réponds de façon ultra-détaillée et rigoureuse, mais avec un ton conversationnel et chaleureux, comme si tu discutais avec l'étudiant en personne. Développe les mécanismes physiopathologiques en profondeur, donne des exemples concrets, et structure ta réponse (listes, **gras** sur les termes clés) quand ça aide à la clarté. N'hésite jamais à être exhaustif — un étudiant en médecine a besoin de comprendre le "pourquoi", pas juste le "quoi".

Si on te demande de traduire un terme ou un passage médical, traduis-le fidèlement puis ajoute, si utile, une courte clarification médicale. Réponds toujours en français, sauf si on te demande explicitement une traduction vers une autre langue.`;

/**
 * Builds the system message as TWO cache-marked content blocks instead of
 * one plain string:
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

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

function isHistoryTurn(value: unknown): value is HistoryTurn {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.role === "user" || candidate.role === "assistant") && typeof candidate.content === "string";
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

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { slug, message, history } = (body ?? {}) as { slug?: unknown; message?: unknown; history?: unknown };

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Le champ 'message' est requis." }, { status: 400 });
  }

  const courseSlug = typeof slug === "string" && slug.trim() ? slug.trim() : null;

  // A signed-in user is required to persist history — the chat still works
  // (streams a real answer) for an unauthenticated caller, it just can't be
  // saved. In practice every page that renders this chat sits behind the
  // /dashboard/** auth gate, so this should always resolve to a real user.
  const user = await getAuthenticatedUser();
  const supabase = courseSlug && user && isSupabaseConfigured() ? getSupabaseAdmin() : null;

  // Bound the context sent upstream — the last 5 exchanges is plenty of
  // continuity for a course-reading chat without letting the request grow
  // unbounded over a long session (see MAX_HISTORY_MESSAGES above for why
  // this is a hard truncation, not a summarization call).
  const historyTurns: HistoryTurn[] = Array.isArray(history) ? history.filter(isHistoryTurn).slice(-MAX_HISTORY_MESSAGES) : [];

  let sourceText: string | null = null;
  if (courseSlug && isSupabaseConfigured()) {
    const admin = getSupabaseAdmin();
    const { data } = await admin.from("courses").select("raw_text").eq("slug", courseSlug).maybeSingle();
    sourceText = (data as { raw_text: string | null } | null)?.raw_text ?? null;
  }

  // Cached (static) content — system persona + course text — MUST come
  // before any dynamic content (history, the new question) for Anthropic's
  // prefix-based cache to have a chance of matching.
  const messages: ChatMessageInput[] = [
    { role: "system", content: buildSystemContent(sourceText) },
    ...historyTurns,
    { role: "user", content: message },
  ];

  // Save the student's message BEFORE starting the model call — if the
  // OpenRouter call fails a moment later, their question is still on record.
  if (supabase && user) {
    const { error } = await supabase
      .from("course_chat_history")
      .insert({ user_id: user.id, course_slug: courseSlug, role: "user", content: message });
    if (error) {
      console.error("[courses/chat POST] Échec sauvegarde message utilisateur:", { code: error.code, message: error.message });
      // Not fatal — the student can still get an answer even if we failed
      // to log their side of it.
    }
  }

  try {
    const stream = await streamOpenRouter(messages, { maxTokens: 4096 });

    // Tee the stream: every chunk is forwarded to the client the instant it
    // arrives (zero added latency, nothing buffered), while the SAME bytes
    // are accumulated in `fullReply`. Only once the model is completely done
    // — i.e. once `flush()` fires, strictly after the client has already
    // received every chunk — do we write the full assistant reply to
    // Supabase. The client never waits on this insert; it isn't even in the
    // response path by the time it runs.
    let fullReply = "";
    const decoder = new TextDecoder();
    const persistOnFlush = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        fullReply += decoder.decode(chunk, { stream: true });
        controller.enqueue(chunk);
      },
      async flush() {
        if (!supabase || !user || !fullReply.trim()) return;
        const { error } = await supabase
          .from("course_chat_history")
          .insert({ user_id: user.id, course_slug: courseSlug, role: "assistant", content: fullReply });
        if (error) {
          console.error("[courses/chat POST] Échec sauvegarde réponse assistant:", { code: error.code, message: error.message });
        }
      },
    });

    return new NextResponse(stream.pipeThrough(persistOnFlush), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      console.error(`[courses/chat POST] Erreur OpenRouter (status ${error.status}):`, error.message);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[courses/chat POST] Erreur non gérée:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
