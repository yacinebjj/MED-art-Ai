import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { STUDIO_PROMPT_CONFIG } from "@/lib/ai/studio-prompts";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { computeExplicationSlices, generateExplicationPart } from "@/lib/studio-explication-delta";
import { claimJob, completeJob, failJob } from "@/lib/studio-job-store";

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
 * Body: `{ courseId, partIndex, attemptId, language?, customPrompt? }` —
 * `attemptId` comes from explication-start's own response for THIS
 * generation attempt (see that route's own comment on why it exists).
 * language/customPrompt are re-sent on every part (not just part 0) since
 * each part is its own independent generation call needing the full system
 * prompt.
 *
 * RESPONSE SHAPE — a background job, not a synchronous result. This route
 * ALWAYS answers almost instantly with `{success:true, status:"pending"}`,
 * `{success:true, status:"done", partIndex, totalParts, isLastPart,
 * partMarkdown}`, or `{success:true, status:"error", error, errorStatus}` —
 * see lib/studio-job-store.ts's own header comment for the full mechanism
 * and WHY this replaced (in order) a single held-open request, then a
 * heartbeat-streamed one: generateExplicationPart legitimately takes
 * ~100-260+ seconds, and TWO separate real production attempts on mobile
 * both failed within 2-23 SECONDS having received zero heartbeats — far too
 * early for an idle-timeout theory, and inconsistent between attempts,
 * pointing at a fundamentally unreliable long-lived connection on that
 * network path rather than a fixable timing issue. The real work now runs
 * via `waitUntil` (bound by this route's own `maxDuration`, exactly as
 * before) while this response returns immediately; lib/studio-explication-
 * client.ts's startAndPoll calls this SAME endpoint repeatedly every few
 * seconds — each individual poll is fast and independently retryable, so a
 * single flaky mobile request costs nothing. Every validation failure
 * BEFORE the job is claimed (auth/rate-limit/body/course lookup below) is
 * unaffected — those still return in milliseconds as plain, ordinary
 * `NextResponse.json(...)` responses with their real HTTP status codes.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  // RATE_LIMITS.poll, not .ai — this endpoint is now polled every ~3s while
  // a background job runs (see lib/rate-limit.ts's own comment on `poll`);
  // the tighter .ai limit is checked separately, only on the branch that
  // actually kicks off a new (real, billed) generation, below.
  const rl = rateLimit(`studio-generate-explication-part:${user.id}`, RATE_LIMITS.poll);
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
    attemptId,
    language: languageRaw,
    customPrompt: customPromptRaw,
  } = (body ?? {}) as {
    courseId?: unknown;
    partIndex?: unknown;
    attemptId?: unknown;
    language?: unknown;
    customPrompt?: unknown;
  };
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis et doit être un nombre." }, { status: 400 });
  }
  if (typeof partIndex !== "number" || !Number.isInteger(partIndex) || partIndex < 0) {
    return NextResponse.json({ success: false, error: "'partIndex' est requis et doit être un entier ≥ 0." }, { status: 400 });
  }
  if (typeof attemptId !== "string" || !attemptId) {
    return NextResponse.json({ success: false, error: "'attemptId' est requis." }, { status: 400 });
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
  const isLastPart = partIndex === totalParts - 1;
  const jobPath = `explication/${courseId}/${attemptId}/${partIndex}.json`;

  const claim = await claimJob<{ partMarkdown: string }>(supabase, jobPath);
  if (!claim.claimed) {
    const existing = claim.existing;
    if (existing.status === "done") {
      return NextResponse.json({
        success: true,
        status: "done",
        partIndex,
        totalParts,
        isLastPart,
        partMarkdown: existing.result?.partMarkdown ?? "",
      });
    }
    if (existing.status === "error") {
      return NextResponse.json({ success: true, status: "error", error: existing.error, errorStatus: existing.errorStatus });
    }
    return NextResponse.json({ success: true, status: "pending" });
  }

  // We won the claim — about to kick off a genuinely NEW, real, billed AI
  // call, so this is where the tighter RATE_LIMITS.ai gate belongs (see
  // this route's top-of-function rl check for why the general request
  // volume is gated separately, more loosely, via RATE_LIMITS.poll).
  const aiRl = rateLimit(`studio-generate-explication-part-ai:${user.id}`, RATE_LIMITS.ai);
  if (!aiRl.allowed) {
    const reason = "Trop de requêtes — réessaie dans quelques minutes.";
    await failJob(supabase, jobPath, reason, 429);
    return NextResponse.json({ success: true, status: "error", error: reason, errorStatus: 429 });
  }

  // Kick off the real (slow, billed) generation in the background and
  // answer immediately. See lib/studio-job-store.ts's own header comment
  // for why this replaced a held-open request: `waitUntil` keeps this
  // invocation alive (bound by this route's own `maxDuration`, exactly as
  // before) to let the promise finish, but the CLIENT never needs its own
  // connection to survive that long — it just polls this same endpoint
  // again in a few seconds.
  waitUntil(
    generateExplicationPart(slices[partIndex], systemPrompt, partIndex + 1, totalParts)
      .then((partMarkdown) => completeJob(supabase, jobPath, { partMarkdown }))
      .catch((error) => {
        const status = error instanceof OpenRouterError ? error.status : 502;
        const message = error instanceof OpenRouterError ? error.message : errorMessage(error);
        if (!(error instanceof OpenRouterError)) {
          console.error(`[explication-part] Échec génération partie ${partIndex + 1}/${totalParts}:`, error);
        }
        return failJob(supabase, jobPath, message, status);
      })
  );

  return NextResponse.json({ success: true, status: "pending" });
}
