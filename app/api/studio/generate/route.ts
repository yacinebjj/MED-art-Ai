import { NextRequest, NextResponse } from "next/server";
import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import {
  STUDIO_MODEL,
  STUDIO_BYPASS_MOCK,
  STUDIO_PROMPT_CONFIG,
  STUDIO_SECTION_KEYS,
  buildStudioSystemPrompt,
  buildStudioDeltaAdaptationPrompt,
  studioDeltaMaxTokens,
} from "@/lib/ai/studio-prompts";
import { STUDIO_SCHEMAS } from "@/lib/ai/studio-schemas";
import { errorMessage, MAX_SOURCE_CHARS, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { lookupStudioContentCache, recordStudioCacheHit, storeStudioContentCache } from "@/lib/studio-content-cache";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import type { DemoSectionId } from "@/lib/demo-content";

export const runtime = "nodejs";
// Explication/QCM/exemples_analogies routinely run 1-3+ minutes at
// maxTokens=32000. Only relevant if/when this is deployed to Vercel — its
// serverless functions are killed at a per-plan duration cap (as low as 10s
// on Hobby) regardless of anything in this file, which would otherwise cut
// these off well before OpenRouter responds. No effect on `next dev` or
// other hosts, which have no such cap.
export const maxDuration = 300;

const VALID_ACTION_TYPES = Object.keys(STUDIO_PROMPT_CONFIG) as DemoSectionId[];

function isValidActionType(value: unknown): value is DemoSectionId {
  return typeof value === "string" && (VALID_ACTION_TYPES as string[]).includes(value);
}

/**
 * Generates one Studio tile's content for the generic curriculum module
 * workspace (app/dashboard/module/[id]/page.tsx), from whatever text
 * /api/upload just extracted. Returns the validated, structured JSON for
 * that tile (never Markdown) — the caller renders it directly with the exact
 * same components Pleurésie/Gastrite use (GastriteResumeStudio,
 * GastriteCasCliniqueStudio, GastriteQcmsStudio in preview mode) for
 * résumé/cas clinique/QCM.
 *
 * Parsing/validation mirrors lib/course-generation-shared.ts's proven
 * production pipeline (strip Markdown fences → JSON.parse → extract the
 * section's own key → strip Postgres-unsafe control chars) and adds a zod
 * pass on top (lib/ai/studio-schemas.ts) — deep structural validation the
 * production pipeline doesn't have, since a malformed shape here would
 * otherwise reach a real React component instead of a database column.
 *
 * ATOMIC generate-then-save, mirroring app/api/studio/regenerate/route.ts:
 * this route now takes `courseId` and persists the validated result to
 * `studio_courses` itself, BEFORE returning success. Used to be "stateless
 * and unauthenticated-to-Supabase on purpose," returning the raw JSON and
 * leaving the caller to fire a separate PATCH /api/studio/courses/[id]
 * afterward — that left a real window where a paid OpenRouter call could
 * complete but the result never reach Supabase (a refresh/tab-close between
 * this response and that PATCH burned the credits for nothing). If the save
 * itself fails, this now returns a real error instead of `success: true`
 * with content the client would display but never be able to reload —
 * better an honest "réessaie" than a receipt for content that vanishes on
 * refresh.
 *
 * CROSS-STUDENT CACHE: before spending a full generation's worth of
 * OpenRouter tokens, checks studio_content_cache (see
 * lib/studio-content-cache.ts) for another student's already-generated
 * output for the same section from substantively the same source text
 * (both matching tiers computed with zero API calls — see
 * lib/content-similarity.ts). Three outcomes:
 *  - EXACT hash match: instant, $0, zero tokens. The cached JSON is
 *    persisted straight to this student's own `studio_courses` row.
 *  - FUZZY match (~85%+ similar, not identical — a different professor's
 *    formatting/titles/added notes on the same core material): NOT served
 *    verbatim (the new student's actual text may say something the cached
 *    version doesn't) and NOT a full fresh generation either (would waste
 *    the whole point of the cache) — instead a much cheaper "delta
 *    adaptation" call (buildStudioDeltaAdaptationPrompt, ~35% of a full
 *    generation's token ceiling) asks the model to adapt only where the two
 *    texts genuinely differ. The result is stored as its own new cache
 *    entry, so a LATER exact match against THIS student's text is free.
 *  - Miss: generates normally and stores the validated result for the next
 *    student.
 *
 * PLAN QUOTA: reserveGeneration()/refundGeneration() (lib/subscription.ts)
 * atomically reserve (and, on failure, refund) only the fuzzy/miss branch
 * above — an exact hit costs nothing and must never consume courseCap.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-generate:${user.id}`, RATE_LIMITS.ai);
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

  const { actionType, documentContext, courseId } = (body ?? {}) as {
    actionType?: unknown;
    documentContext?: unknown;
    courseId?: unknown;
  };

  if (!isValidActionType(actionType)) {
    return NextResponse.json(
      { success: false, error: `'actionType' invalide. Valeurs acceptées : ${VALID_ACTION_TYPES.join(", ")}.` },
      { status: 400 }
    );
  }
  if (typeof documentContext !== "string" || documentContext.trim().length < 50) {
    return NextResponse.json({ success: false, error: "'documentContext' est requis (texte extrait d'un PDF, ≥ 50 caractères)." }, { status: 400 });
  }
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis et doit être un nombre." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const truncatedContext = documentContext.slice(0, MAX_SOURCE_CHARS);
  const { maxTokens } = STUDIO_PROMPT_CONFIG[actionType];
  const sectionKey = STUDIO_SECTION_KEYS[actionType];

  let finalData: unknown;
  let servedFromCache = false;
  let cacheRowId: string | undefined;
  let cacheMode: "exact" | "delta" | "miss" = "miss";

  const cacheResult = await lookupStudioContentCache(actionType, truncatedContext);

  if (cacheResult.hit && cacheResult.matchType === "exact") {
    finalData = cacheResult.data;
    servedFromCache = true;
    cacheRowId = cacheResult.cacheRowId;
    cacheMode = "exact";
  } else {
    // Two paths land here with two different prompts/token budgets: a fuzzy
    // cache hit (delta-adaptation, cheap) or a true miss (full generation).
    // Everything after the prompt/maxTokens choice — the call itself,
    // parsing, zod validation, error handling — is identical for both, so
    // it isn't duplicated.
    const isFuzzyHit = cacheResult.hit && cacheResult.matchType === "fuzzy";
    cacheMode = isFuzzyHit ? "delta" : "miss";

    // Plan quota RESERVATION — deliberately AFTER the exact-hit check above
    // (a fuzzy hit or true miss is the only path that spends real OpenRouter
    // tokens, so it's the only path that should ever consume courseCap), and
    // deliberately BEFORE the OpenRouter call below: this atomically checks
    // AND increments in one step (see reserveGeneration's own comment for
    // why — closes a real TOCTOU race the previous check-then-record split
    // had). If the call below then fails, refundGeneration() undoes it.
    const quotaGate = await reserveGeneration(user);
    if (!quotaGate.allowed) {
      return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
    }

    const systemPrompt = isFuzzyHit
      ? buildStudioDeltaAdaptationPrompt(actionType, JSON.stringify(cacheResult.data), truncatedContext)
      : buildStudioSystemPrompt(actionType, truncatedContext);
    const effectiveMaxTokens = isFuzzyHit ? studioDeltaMaxTokens(actionType) : maxTokens;
    const userPrompt = isFuzzyHit ? "Génère le contenu adapté demandé." : "Génère le contenu demandé.";

    // Architecture voulue par le client : le texte intégral du cours est
    // injecté DANS le system prompt (pas dans un message user séparé) — voir
    // buildStudioSystemPrompt. Le message user reste minimal, juste le
    // déclencheur final de génération.
    let raw: string;
    try {
      raw = await callOpenRouter(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        { model: STUDIO_MODEL, maxTokens: effectiveMaxTokens, bypassMock: STUDIO_BYPASS_MOCK }
      );
    } catch (error) {
      await refundGeneration(user.id);
      if (error instanceof OpenRouterError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      }
      console.error(`[studio/generate:${actionType}] Échec appel IA (${cacheMode}):`, error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }

    try {
      const parsed = parseJsonResponse(raw);
      const value = parsed[sectionKey];
      if (value === undefined || value === null) {
        console.error(`[studio/generate:${actionType}] Clé "${sectionKey}" absente. Clés reçues :`, Object.keys(parsed));
        throw new Error(`La réponse de l'IA ne contient pas la clé "${sectionKey}".`);
      }

      const sanitized = sanitizeForPostgres(value);
      const schema = STUDIO_SCHEMAS[actionType];
      const result = schema.safeParse(sanitized);
      if (!result.success) {
        console.error(`[studio/generate:${actionType}] Validation zod échouée :`, result.error.flatten());
        throw new Error(`La réponse de l'IA pour "${actionType}" ne respecte pas le schéma attendu.`);
      }

      finalData = result.data;
    } catch (error) {
      await refundGeneration(user.id);
      console.error(`[studio/generate:${actionType}] Parsing/validation échoué :`, error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }

    // Fresh (or delta-adapted) validated content — store it under THIS
    // request's own content hash for the NEXT student before this one even
    // finishes seeing it. Fail-open: storeStudioContentCache logs its own
    // errors and never throws, so a caching hiccup can't block this
    // student's own successful generation. No separate "record usage" call
    // here anymore — reserveGeneration() above already incremented
    // atomically, before this call even ran.
    await storeStudioContentCache(actionType, truncatedContext, finalData);
  }

  // Persist BEFORE returning success — see this route's header comment.
  // "qcm" -> "qcms" is the one mismatch, identity otherwise; sectionKey
  // already carries that mapping (same one used to pull the value out of
  // the AI's JSON above, or out of the cache), so it doubles as the
  // studio_courses column name.
  //
  // content_hash is stamped alongside it — the SAME hash
  // lookupStudioContentCache/storeStudioContentCache already compute
  // internally to key studio_content_cache, now also stored directly on
  // this row so app/api/studio/regenerate can key studio_content_variations
  // off it without re-fetching or re-hashing raw_text on every regenerate
  // click. Recomputed on every section's save (cheap, pure JS) rather than
  // only on the first — harmless if unchanged, and correctly updates a row
  // whose raw_text somehow differs from an earlier section's save.
  const contentHash = sha256(normalizeText(truncatedContext));

  const supabase = getSupabaseAdmin();
  const { error: saveError, count } = await supabase
    .from("studio_courses")
    .update({ [sectionKey]: finalData, content_hash: contentHash, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", courseId)
    .eq("user_id", user.id);

  if (saveError) {
    console.error(`[studio/generate:${actionType}] Échec sauvegarde Supabase:`, saveError);
    return NextResponse.json({ success: false, error: `Sauvegarde échouée : ${saveError.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  if (servedFromCache && cacheRowId) {
    await recordStudioCacheHit(cacheRowId);
  }

  return NextResponse.json({ success: true, actionType, data: finalData, cached: servedFromCache, cacheMode });
}
