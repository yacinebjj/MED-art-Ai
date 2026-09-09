import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage, MAX_SOURCE_CHARS } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { reservePlatformCapacity } from "@/lib/platform-spend-guard";
import { lookupStudioContentCache, recordStudioCacheHit, type StudioCacheLookupResult } from "@/lib/studio-content-cache";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { computeExplicationSlices } from "@/lib/studio-explication-delta";

export const runtime = "nodejs";
// Deliberately tight, and this route now genuinely never approaches it: a
// real production 504 traced to this exact route making TWO real OpenRouter
// calls (via the cross-university-delta pipeline, formerly invoked
// synchronously below) with no timeoutMs override — inheriting
// callOpenRouter's 240s DEFAULT_TIMEOUT_MS, four times this route's own
// maxDuration — plus an unbounded number of embedding calls (one per source
// chunk, on a course's first-ever indexing) from ensureStudioCourseChunked.
// Both the cross-university-delta pipeline AND the fuzzy-cache delta
// adaptation (bounded at 45s, but with almost no margin left once stacked
// on top of the DB round-trips already in this route) have been REMOVED
// from this route entirely — this route must now be pure DB reads/writes,
// finishing in well under a second, full stop. Both optimizations still
// exist (lib/studio-explication-delta.ts's runStudioExplicationDeltaPipeline,
// lib/ai/studio-prompts.ts's buildStudioDeltaAdaptationPrompt) and are
// disclosed as disabled here — a reasonable, deliberate reliability-over-
// cost-savings trade-off, reachable again in the future only via a
// genuinely async/background mechanism that never blocks this route's own
// response.
export const maxDuration = 15;

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
 *      servedFromCache: true, cacheMode: "exact" }` — an EXACT cross-student
 *    cache hit resolved the whole Explication instantly, already persisted.
 *    The caller must NOT call explication-part or explication-finalize
 *    afterward. (Fuzzy-cache delta adaptation and the cross-university
 *    chunk-delta pipeline are NOT attempted here — see this file's top-of-
 *    file comment for why; a fuzzy/no cache match always falls through to
 *    the reservation branch below instead.)
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

  // exactOnly=true — this route never consumes a fuzzy match (see this
  // file's top-of-file comment), so skip that tier's extra ~500-row query +
  // in-process MinHash scan entirely; pure wasted latency here otherwise,
  // and this route's whole point is to be as fast as possible.
  const cacheResult: StudioCacheLookupResult = isPersonalizedVariant
    ? { hit: false }
    : await lookupStudioContentCache("explication", truncatedContext, true);

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

  // Genuine fresh generation needed — quota is reserved and confirmed to the
  // client, which now drives explication-part for every part. Deliberately
  // NO fuzzy-cache delta adaptation or cross-university-delta pipeline
  // attempted here anymore (see this file's own top-of-file comment) — this
  // response is the whole point of this route being fast: DB work only,
  // no AI call, every single time.
  return NextResponse.json({ success: true, totalParts, needsFinalize: true, reserved: true });
}
