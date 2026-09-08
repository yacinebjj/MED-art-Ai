import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { STUDIO_PROMPT_CONFIG } from "@/lib/ai/studio-prompts";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { computeExplicationSlices, generateExplicationPart } from "@/lib/studio-explication-delta";

export const runtime = "nodejs";
// 280s — comfortably inside this project's REAL enforced ceiling, which an
// empirical, zero-cost test (an awaited sleep, no AI call — see
// app/api/diagsleep, deleted after use) confirmed exceeds 250 seconds live.
// The previous value here (60s) was a DEFENSIVE GUESS against a possible
// tight platform ceiling that turned out not to apply to this project —
// see lib/studio-explication-delta.ts's EXPLICATION_PART_MAX_TOKENS HISTORY
// comment for the full incident: that guess, not a platform kill, was the
// actual cause of the repeated 504 (this route's OWN
// EXPLICATION_PART_TIMEOUT_MS aborting a genuinely-still-in-progress
// generation early). 280s gives generateExplicationPart's own 260s
// OpenRouter timeout real margin for JSON parsing / response serialization.
export const maxDuration = 280;

/**
 * Generation-only step of the client-driven, multi-request Explication
 * pipeline — see explication-start/route.ts for the reservation/cache/
 * cross-university-delta step that MUST run first, and
 * lib/studio-explication-delta.ts's ARCHITECTURE comment for the overall
 * design. This route touches NO quota (reserveGeneration/refundGeneration)
 * at all — deliberately: a real code-review-caught bug in an earlier version
 * had reservation happen HERE, inside the same request as the slow AI call,
 * which let the client's freely-repeated per-part retries silently reserve
 * quota multiple times for one delivered generation. Quota is reserved
 * exactly once, in explication-start, before this route is ever called.
 *
 * lib/studio-explication-client.ts calls this once per part, sequentially,
 * `partIndex = 0..totalParts-1`, retrying any individual part on a clean,
 * retryable failure (never re-running an already-succeeded part) — this is
 * now completely safe from a quota standpoint since this route never
 * reserves or refunds anything.
 *
 * Body: `{ courseId, partIndex, language?, customPrompt? }` — language/
 * customPrompt are re-sent on every part (not just part 0) since each part
 * is its own independent generation call needing the full system prompt.
 *
 * RESPONSE SHAPE — deliberately a STREAMED, newline-delimited JSON body
 * (Content-Type: application/x-ndjson), always HTTP 200, NOT a single JSON
 * object — added after a real, confirmed production report of "échec de
 * génération" specifically on MOBILE (never on PC/desktop, for the exact
 * same course). Root cause: this route's real generation call
 * (generateExplicationPart) legitimately takes anywhere from ~100 to 260+
 * seconds, and the PREVIOUS implementation held one plain request/response
 * open that entire time with ZERO bytes flowing in either direction until
 * the very end. A cellular carrier's carrier-grade NAT (every mobile data
 * connection sits behind one) commonly drops an idle TCP mapping after as
 * little as 30-120 seconds of total silence — a well-documented mobile-
 * network reality that has nothing to do with screen locking, tab
 * backgrounding, or this app's own code, and would fail IDENTICALLY on
 * every one of lib/studio-explication-client.ts's 3 retries for the exact
 * same course/part, since it's a deterministic property of the network
 * path, not a random flake. Home/office WiFi and wired connections
 * typically tolerate a MUCH longer idle window (or none at all) on an
 * already-established TCP connection, which is exactly why this class of
 * failure would show up on mobile and not PC for the identical request.
 *
 * Fix: emit a `{"type":"heartbeat"}\n` line every 15 seconds for the entire
 * duration generateExplicationPart is in flight, so real bytes keep flowing
 * over the connection continuously — this defeats an idle-timeout drop
 * entirely, independent of how long the actual generation takes. The final
 * line is always `{"type":"result", success, ...}` — `success:true` carries
 * `partIndex, totalParts, isLastPart, partMarkdown` (exactly the old
 * response's fields); `success:false` carries `error` and a `status`
 * field holding the LOGICAL status this failure would have had as a plain
 * response (mirrors OpenRouterError.status, or 502) — since real HTTP
 * status can't change after streaming has already started with a 200,
 * lib/studio-explication-client.ts's postPartWithHeartbeat reads THIS
 * field, not the transport status, to decide retryability. Heartbeat lines
 * are otherwise inert and ignored by the client's line parser. Every
 * validation failure BEFORE generation starts (auth/rate-limit/body/course
 * lookup below) is completely unaffected — those return in milliseconds, so
 * they stay plain, ordinary `NextResponse.json(...)` responses with their
 * real HTTP status codes, exactly as before.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-generate-explication-part:${user.id}`, RATE_LIMITS.ai);
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

  const { courseId, partIndex, language: languageRaw, customPrompt: customPromptRaw } = (body ?? {}) as {
    courseId?: unknown;
    partIndex?: unknown;
    language?: unknown;
    customPrompt?: unknown;
  };
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis et doit être un nombre." }, { status: 400 });
  }
  if (typeof partIndex !== "number" || !Number.isInteger(partIndex) || partIndex < 0) {
    return NextResponse.json({ success: false, error: "'partIndex' est requis et doit être un entier ≥ 0." }, { status: 400 });
  }

  const language: "fr" | "en" = languageRaw === "en" ? "en" : "fr";
  const customPrompt = typeof customPromptRaw === "string" ? customPromptRaw.trim().slice(0, 2000) : "";
  const languageInstruction =
    language === "en"
      ? "\n\nINSTRUCTION DE LANGUE OBLIGATOIRE (remplace toute langue de sortie précédemment implicite) : rédige l'INTÉGRALITÉ de ta réponse — tous les champs textuels du JSON, sans exception — en ANGLAIS, jamais en français, en conservant strictement le même niveau de rigueur médicale, la même structure JSON et le même format exact déjà exigés ci-dessus."
      : "";
  const customPromptInstruction = customPrompt
    ? `\n\nCONSIGNE PERSONNALISÉE DE L'ÉTUDIANT (à respecter en plus de tout ce qui précède, sans jamais sacrifier la rigueur médicale ni le format JSON exact déjà exigé) : ${customPrompt}`
    : "";

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data: courseRow, error: courseRowError } = await supabase
    .from("studio_courses")
    .select("raw_text")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle<{ raw_text: string | null }>();
  if (courseRowError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${courseRowError.message}` }, { status: 500 });
  }
  const resolvedSourceText = courseRow?.raw_text ?? null;
  if (!resolvedSourceText || resolvedSourceText.trim().length < 50) {
    return NextResponse.json(
      { success: false, error: "Impossible de retrouver le texte source de ce cours (≥ 50 caractères requis)." },
      { status: 400 }
    );
  }

  const slices = computeExplicationSlices(resolvedSourceText);
  const totalParts = slices.length;
  if (partIndex >= totalParts) {
    return NextResponse.json({ success: false, error: "'partIndex' hors limites." }, { status: 400 });
  }

  const systemPrompt = STUDIO_PROMPT_CONFIG.explication.systemPrompt + languageInstruction + customPromptInstruction;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // See this route's own header comment for why this exists: keeps real
      // bytes flowing over the connection for the ~100-260+ seconds
      // generateExplicationPart can legitimately take, so a mobile carrier's
      // NAT never sees this connection as idle long enough to drop it.
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "heartbeat" })}\n`));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15_000);

      generateExplicationPart(slices[partIndex], systemPrompt, partIndex + 1, totalParts)
        .then((partMarkdown) => {
          const isLastPart = partIndex === totalParts - 1;
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ type: "result", success: true, partIndex, totalParts, isLastPart, partMarkdown })}\n`)
          );
        })
        .catch((error) => {
          const status = error instanceof OpenRouterError ? error.status : 502;
          const message = error instanceof OpenRouterError ? error.message : errorMessage(error);
          if (!(error instanceof OpenRouterError)) {
            console.error(`[explication-part] Échec génération partie ${partIndex + 1}/${totalParts}:`, error);
          }
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "result", success: false, error: message, status })}\n`));
        })
        .finally(() => {
          clearInterval(heartbeatInterval);
          controller.close();
        });
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
