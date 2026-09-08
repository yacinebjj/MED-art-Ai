import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, CHEAP_MODEL, OpenRouterError } from "@/lib/ai/openrouter";
import { buildStudioDeltaAdaptationPrompt, studioDeltaMaxTokens } from "@/lib/ai/studio-prompts";
import { errorMessage, MAX_SOURCE_CHARS, parseJsonResponse } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { reservePlatformCapacity } from "@/lib/platform-spend-guard";
import { lookupStudioContentCache, recordStudioCacheHit, storeStudioContentCache, type StudioCacheLookupResult } from "@/lib/studio-content-cache";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { runStudioExplicationDeltaPipeline, computeExplicationSlices } from "@/lib/studio-explication-delta";
import { dispatchStudioGenerationPush } from "@/lib/push/dispatch";

// Fuzzy-hit delta-adaptation (see the isFuzzyHit branch below) is an EDIT
// pass over another student's already-generated output, not fresh
// generation from raw source — comparable in spirit to /api/studio/generate/
// route.ts's own generic-path delta adaptation. Bounded well under this
// route's own maxDuration so a slow/stuck adaptation call fails cleanly
// and falls through to full generation instead, rather than risking this
// otherwise-fast, never-retried route hanging.
const DELTA_ADAPTATION_TIMEOUT_MS = 45_000;

export const runtime = "nodejs";
export const maxDuration = 60; // no AI generation call happens in this route on the fresh-generation path — only cache/DB reads and, rarely, the cross-university-delta pipeline's own bounded calls.

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/**
 * `clearPending` must be true for every call site reached AFTER
 * reserve_explication_pending below has set the flag (fuzzy-delta,
 * cross-university-delta) — it folds the clear into the SAME update as the
 * content save, so a persisted result and a cleared pending flag can never
 * disagree. Must be false for the exact-cache-hit shortcut, which returns
 * before any reservation (and therefore before the flag) ever exists.
 */
async function persistExplicationResult(
  supabase: SupabaseAdmin,
  courseId: number,
  userId: string,
  markdown: string,
  contentHash: string,
  clearPending: boolean
): Promise<{ error?: string }> {
  const payload: Record<string, unknown> = { explication: markdown, content_hash: contentHash, updated_at: new Date().toISOString() };
  if (clearPending) payload.explication_reservation_pending = false;
  const { error, count } = await supabase.from("studio_courses").update(payload, { count: "exact" }).eq("id", courseId).eq("user_id", userId);
  if (error) return { error: `Sauvegarde échouée : ${error.message}` };
  if (count === 0) return { error: "Cours introuvable." };
  return {};
}

/**
 * See supabase/schema.sql's own comment on `explication_reservation_pending`
 * for the full rationale — this is the ONLY place that ever sets the flag to
 * true, immediately after a real reservation succeeds and before any further
 * work is attempted, so every subsequent interruption point (a shortcut
 * failing, a platform kill) leaves an accurate, per-course record of "a real
 * reservation is currently outstanding for this course" that
 * explication-abandon can verify against instead of trusting an unscoped
 * refund claim.
 */
async function markReservationPending(supabase: SupabaseAdmin, courseId: number, userId: string): Promise<{ error?: string }> {
  const { error, count } = await supabase
    .from("studio_courses")
    .update({ explication_reservation_pending: true }, { count: "exact" })
    .eq("id", courseId)
    .eq("user_id", userId);
  if (error) return { error: `Réservation échouée : ${error.message}` };
  if (count === 0) return { error: "Cours introuvable." };
  return {};
}

/**
 * Used at every failure point AFTER markReservationPending has already
 * succeeded — refunding the courseCap unit alone is not enough here: the
 * pending flag must ALSO be cleared in the same breath, or it would stay
 * orphaned `true` forever despite the unit already being refunded, which
 * could let a later, unrelated explication-abandon call wrongly believe a
 * reservation is still outstanding and refund a SECOND time for nothing.
 */
async function refundAndClearPending(supabase: SupabaseAdmin, courseId: number, userId: string): Promise<void> {
  await refundGeneration(userId);
  const { error } = await supabase
    .from("studio_courses")
    .update({ explication_reservation_pending: false })
    .eq("id", courseId)
    .eq("user_id", userId);
  if (error) console.error("[explication-start] Échec nettoyage explication_reservation_pending après refund (non bloquant):", error.message);
}

/**
 * First (and, unlike explication-part, DELIBERATELY UN-RETRIED) step of the
 * client-driven, multi-request Explication pipeline — see
 * lib/studio-explication-delta.ts's ARCHITECTURE comment for the overall
 * design. Split out from what used to be explication-part's own
 * `partIndex === 0` branch after a code review surfaced a real, critical
 * quota-integrity bug in that combined design: reserveGeneration ran inside
 * the SAME request as the actual (slow, real-timeout-risk) AI generation
 * call, so the client's automatic per-part retry — the exact mechanism this
 * whole rewrite exists to provide — could re-run reserveGeneration on every
 * retry of a transiently-failing part 0, silently reserving 2-3x courseCap
 * for one delivered generation. Separating "reserve + resolve any
 * cache/cross-university shortcut" (this route: fast, DB-only except for the
 * optional delta pipeline, never retried by the client) from "generate one
 * part's content" (explication-part: slow, real timeout risk, freely
 * retried, and — critically — never touches quota at all anymore) removes
 * that coupling. lib/studio-explication-client.ts calls this EXACTLY ONCE;
 * if it fails for any reason, the client does not retry it and does not
 * call explication-abandon (a call that never definitively confirmed a
 * reservation must never assume one exists to refund).
 *
 * Body: `{ courseId, language?, customPrompt? }`.
 *
 * Response shapes:
 *  - `{ success: true, totalParts: 1, needsFinalize: false, partMarkdown,
 *      servedFromCache?, cacheMode? }` — the whole Explication was already
 *    resolved (exact cache hit, a fuzzy-cache delta adaptation, or a
 *    cross-university chunk-delta match) and already persisted. The caller
 *    must NOT call explication-part or explication-finalize afterward.
 *  - `{ success: true, totalParts, needsFinalize: true, reserved: true }` —
 *    quota WAS reserved for this generation; the caller must now drive
 *    explication-part for partIndex 0..totalParts-1, and — if it ultimately
 *    gives up — call explication-abandon exactly once to refund this
 *    reservation.
 *  - `{ success: false, error }` — nothing was reserved (a 4xx validation/
 *    quota-denial, or the 500/503 paths below, which self-refund before
 *    responding — see inline comments). The caller must NOT call
 *    explication-abandon for this outcome.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-generate-explication-start:${user.id}`, RATE_LIMITS.ai);
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

  const { courseId, language: languageRaw, customPrompt: customPromptRaw } = (body ?? {}) as {
    courseId?: unknown;
    language?: unknown;
    customPrompt?: unknown;
  };
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis et doit être un nombre." }, { status: 400 });
  }

  const language: "fr" | "en" = languageRaw === "en" ? "en" : "fr";
  const customPrompt = typeof customPromptRaw === "string" ? customPromptRaw.trim().slice(0, 2000) : "";
  const isPersonalizedVariant = language !== "fr" || customPrompt.length > 0;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data: courseRow, error: courseRowError } = await supabase
    .from("studio_courses")
    .select("raw_text, title, curriculum_module_id")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle<{ raw_text: string | null; title: string | null; curriculum_module_id: number | null }>();
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

  const totalParts = computeExplicationSlices(resolvedSourceText).length;
  const truncatedContext = resolvedSourceText.slice(0, MAX_SOURCE_CHARS);
  const contentHash = sha256(normalizeText(truncatedContext));

  const cacheResult: StudioCacheLookupResult = isPersonalizedVariant
    ? { hit: false }
    : await lookupStudioContentCache("explication", truncatedContext);

  if (cacheResult.hit && cacheResult.matchType === "exact") {
    const markdown = cacheResult.data as string;
    const persisted = await persistExplicationResult(supabase, courseId, user.id, markdown, contentHash, false);
    if (persisted.error) {
      return NextResponse.json({ success: false, error: persisted.error }, { status: 500 });
    }
    if (cacheResult.cacheRowId) await recordStudioCacheHit(cacheResult.cacheRowId);
    return NextResponse.json({
      success: true,
      totalParts: 1,
      needsFinalize: false,
      partMarkdown: markdown,
      servedFromCache: true,
      cacheMode: "exact",
    });
  }

  // From here on, a generation of some kind is genuinely needed — reserve
  // quota. This is the ONLY reservation point in the whole pipeline, and
  // this route is called exactly once (never retried) by the client, so
  // this line runs at most once per real generation attempt.
  const quotaGate = await reserveGeneration(user);
  if (!quotaGate.allowed) {
    return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
  }

  const platformCapacity = await reservePlatformCapacity();
  if (!platformCapacity.allowed) {
    await refundGeneration(user.id); // self-refunds — the client never saw `reserved: true`, so it must not (and per its own contract, will not) call explication-abandon for this response.
    return NextResponse.json({ success: false, error: platformCapacity.reason }, { status: 503 });
  }

  const pending = await markReservationPending(supabase, courseId, user.id);
  if (pending.error) {
    await refundGeneration(user.id);
    return NextResponse.json({ success: false, error: pending.error }, { status: 500 });
  }

  // Fuzzy cache hit (another student's near-identical course, ~85%+
  // similar but not byte-identical) — a much cheaper edit/adaptation pass
  // instead of full multi-part generation, mirroring the same optimization
  // /api/studio/generate/route.ts's generic path applies to every other
  // section. Fail-open: any failure here (parse error, timeout, OpenRouter
  // error) just falls through to full fresh generation below rather than
  // erroring the whole request — the fuzzy hit was only ever an
  // optimization, never a correctness requirement.
  if (cacheResult.hit && cacheResult.matchType === "fuzzy") {
    try {
      const raw = await callOpenRouter(
        [
          { role: "system", content: buildStudioDeltaAdaptationPrompt("explication", JSON.stringify(cacheResult.data), truncatedContext) },
          { role: "user", content: "Génère le contenu adapté demandé." },
        ],
        {
          model: CHEAP_MODEL,
          maxTokens: studioDeltaMaxTokens("explication"),
          bypassMock: true,
          reasoning: { effort: "low" },
          timeoutMs: DELTA_ADAPTATION_TIMEOUT_MS,
        }
      );
      const parsed = parseJsonResponse(raw);
      const adapted = typeof parsed.explication === "string" ? parsed.explication.trim() : "";
      if (adapted.length >= 50) {
        const persisted = await persistExplicationResult(supabase, courseId, user.id, adapted, contentHash, true);
        if (persisted.error) {
          await refundAndClearPending(supabase, courseId, user.id);
          return NextResponse.json({ success: false, error: persisted.error }, { status: 500 });
        }
        await storeStudioContentCache("explication", truncatedContext, adapted);
        if (courseRow?.title && courseRow.curriculum_module_id) {
          try {
            await dispatchStudioGenerationPush(user.id, courseRow.title, "explication", `/dashboard/module/${courseRow.curriculum_module_id}`);
          } catch (error) {
            console.error("[explication-start] Échec envoi push (non bloquant):", error);
          }
        }
        return NextResponse.json({ success: true, totalParts: 1, needsFinalize: false, partMarkdown: adapted, cacheMode: "delta" });
      }
      console.warn("[explication-start] Adaptation delta trop courte/vide — génération complète à la place.");
    } catch (error) {
      const detail = error instanceof OpenRouterError ? error.message : errorMessage(error);
      console.error("[explication-start] Échec adaptation delta (fail-open, génération complète):", detail);
    }
  }

  if (!isPersonalizedVariant) {
    let crossUniversityMarkdown: string | null = null;
    try {
      crossUniversityMarkdown = await runStudioExplicationDeltaPipeline(courseId, truncatedContext, user.id);
    } catch (error) {
      console.error("[explication-start] Pipeline delta cross-université échoué (fail-open, génération classique):", errorMessage(error));
    }
    if (crossUniversityMarkdown !== null) {
      const persisted = await persistExplicationResult(supabase, courseId, user.id, crossUniversityMarkdown, contentHash, true);
      if (persisted.error) {
        await refundAndClearPending(supabase, courseId, user.id);
        return NextResponse.json({ success: false, error: persisted.error }, { status: 500 });
      }
      await storeStudioContentCache("explication", truncatedContext, crossUniversityMarkdown);
      if (courseRow?.title && courseRow.curriculum_module_id) {
        try {
          await dispatchStudioGenerationPush(user.id, courseRow.title, "explication", `/dashboard/module/${courseRow.curriculum_module_id}`);
        } catch (error) {
          console.error("[explication-start] Échec envoi push (non bloquant):", error);
        }
      }
      return NextResponse.json({
        success: true,
        totalParts: 1,
        needsFinalize: false,
        partMarkdown: crossUniversityMarkdown,
        cacheMode: "cross-university-delta",
      });
    }
  }

  // Genuine fresh generation needed — quota is reserved and confirmed to the
  // client, which now drives explication-part for every part.
  return NextResponse.json({ success: true, totalParts, needsFinalize: true, reserved: true });
}
