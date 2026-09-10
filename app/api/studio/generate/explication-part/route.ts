import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { STUDIO_PROMPT_CONFIG } from "@/lib/ai/studio-prompts";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { computeExplicationSlices, generateExplicationPart, splitSliceIntoSubSlices } from "@/lib/studio-explication-delta";

export const runtime = "nodejs";
// 280s — comfortably inside this project's REAL enforced ceiling, which an
// empirical, zero-cost test (an awaited sleep, no AI call — see
// app/api/diagsleep, deleted after use) confirmed exceeds 250 seconds live.
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
 * Body: `{ courseId, partIndex, previousPartTail?, language?, customPrompt? }`
 * — language/customPrompt are re-sent on every part (not just part 0) since
 * each part is its own independent generation call needing the full system
 * prompt. `previousPartTail` — the tail of the PREVIOUS part's own real
 * output, sent by the client for every part after the first — fixes a real
 * reported bug ("chapters get mixed up, the topic changes completely"); see
 * generateExplicationPart's own comment for the full mechanism.
 *
 * RESPONSE SHAPE — a STREAMED, newline-delimited JSON body (Content-Type:
 * application/x-ndjson), always HTTP 200, NOT a single JSON object. This
 * route went through THREE architectures this session, in order — the full
 * history matters, because it is the actual evidence behind the current
 * design, not a stylistic preference:
 *  1. A single plain held-open request/response. Failed: a mobile carrier's
 *     NAT commonly drops an idle TCP connection after 30-120s of total
 *     silence, and generateExplicationPart legitimately takes 100-260+
 *     seconds with zero bytes flowing until the very end.
 *  2. THIS heartbeat-streaming design (a `{"type":"heartbeat"}\n` line every
 *     15s keeps real bytes flowing, defeating the idle-timeout drop) — but
 *     was itself abandoned after TWO real mobile production attempts both
 *     failed within 2-23 seconds having received ZERO heartbeats — far too
 *     early for the idle-connection theory, and inconsistent between
 *     attempts.
 *  3. A background-job/`waitUntil` + client-polling architecture (see git
 *     history: "replace heartbeat-streaming with a background-job/polling
 *     architecture"). This is the one that turned out to be genuinely
 *     broken: a live diagnostic route proved `waitUntil` reliably runs a
 *     pure background TIMER for 240s+, but a REAL OpenRouter fetch call run
 *     the same way inside `waitUntil` hung for 450+ seconds and never
 *     resolved — not even into this app's own internal timeout error.
 *     Removing OpenRouter's pooled connection dispatcher (a real, separate
 *     bug, see lib/ai/openrouter.ts) did not fix it, and the identical
 *     failure then reproduced on PC too, ruling out anything mobile-network-
 *     specific. Every FOREGROUND, directly-awaited real OpenRouter call
 *     tested this session — including the original IPv4 DNS fix's own live
 *     verification — completed reliably.
 * Back to THIS design (2) because it is the one architecture actually
 * proven to work end-to-end this session, now combined with the dispatcher
 * fix that (2)'s original mobile failures never had the benefit of — a
 * pooled connection silently going stale between invocations would produce
 * exactly a fast, inconsistent, zero-heartbeat failure like the one that
 * caused (2) to be abandoned in the first place.
 *
 * The final NDJSON line is always `{"type":"result", success, ...}` —
 * `success:true` carries `partIndex, totalParts, isLastPart, partMarkdown`;
 * `success:false` carries `error` and a `status` field holding the LOGICAL
 * status this failure would have had as a plain response (mirrors
 * OpenRouterError.status, or 502) — since real HTTP status can't change
 * after streaming has already started with a 200,
 * lib/heartbeat-fetch.ts's postJsonWithHeartbeat reads THIS field, not the
 * transport status, to decide retryability. Heartbeat lines are otherwise
 * inert and ignored by the client's line parser. Every validation failure
 * BEFORE generation starts (auth/rate-limit/body/course lookup below) is
 * completely unaffected — those return in milliseconds, so they stay plain,
 * ordinary `NextResponse.json(...)` responses with their real HTTP status
 * codes, exactly as before.
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

  const {
    courseId,
    partIndex,
    subPartIndex: subPartIndexRaw,
    subPartCount: subPartCountRaw,
    previousPartTail: previousPartTailRaw,
    language: languageRaw,
    customPrompt: customPromptRaw,
  } = (body ?? {}) as {
    courseId?: unknown;
    partIndex?: unknown;
    subPartIndex?: unknown;
    subPartCount?: unknown;
    previousPartTail?: unknown;
    language?: unknown;
    customPrompt?: unknown;
  };
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis et doit être un nombre." }, { status: 400 });
  }
  if (typeof partIndex !== "number" || !Number.isInteger(partIndex) || partIndex < 0) {
    return NextResponse.json({ success: false, error: "'partIndex' est requis et doit être un entier ≥ 0." }, { status: 400 });
  }
  // Optional — see generateExplicationPart's own comment on why this fixes
  // the "chapters mixed up" bug. Capped defensively (this route never
  // trusts a client-supplied string's length) even though the client only
  // ever sends a short tail of the PREVIOUS part's own real output.
  const previousPartTail = typeof previousPartTailRaw === "string" ? previousPartTailRaw.slice(-4000) : undefined;

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

  // SUB-PART ESCALATION — optional, defaults to "the whole part" so the
  // happy path is byte-for-byte unchanged. When a part proves too slow to
  // generate inside the time budget, the client stops re-requesting the
  // identical doomed slice and asks for its halves (then quarters) instead:
  // strictly less work per invocation, and the pieces are concatenated
  // client-side into the same final document. Bounded at 8 defensively —
  // this is a client-supplied number and must never be able to explode the
  // split loop.
  const subPartCount =
    typeof subPartCountRaw === "number" && Number.isInteger(subPartCountRaw) && subPartCountRaw > 1
      ? Math.min(subPartCountRaw, 8)
      : 1;
  const requestedSubPartIndex =
    typeof subPartIndexRaw === "number" && Number.isInteger(subPartIndexRaw) && subPartIndexRaw >= 0 ? subPartIndexRaw : 0;

  const subSlices = subPartCount > 1 ? splitSliceIntoSubSlices(slices[partIndex], subPartCount) : [slices[partIndex]];
  // splitSliceIntoSubSlices can legitimately return FEWER pieces than asked
  // (a short slice with no usable boundaries), so clamp rather than trust
  // the client's index against an assumed length.
  const subPartIndex = Math.min(requestedSubPartIndex, subSlices.length - 1);
  const slice = subSlices[subPartIndex];

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

      generateExplicationPart(slice, systemPrompt, partIndex + 1, totalParts, previousPartTail)
        .then((partMarkdown) => {
          const isLastPart = partIndex === totalParts - 1 && subPartIndex === subSlices.length - 1;
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
