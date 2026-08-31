import { NextRequest, NextResponse } from "next/server";
import { callOpenRouter, OpenRouterError, ECONOMY_MODEL } from "@/lib/ai/openrouter";
import {
  STUDIO_MODEL,
  STUDIO_BYPASS_MOCK,
  STUDIO_PROMPT_CONFIG,
  STUDIO_SECTION_KEYS,
  buildStudioSystemMessage,
  buildStudioDeltaAdaptationPrompt,
  studioDeltaMaxTokens,
} from "@/lib/ai/studio-prompts";
import { STUDIO_SCHEMAS } from "@/lib/ai/studio-schemas";
import { errorMessage, MAX_SOURCE_CHARS, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { reservePlatformCapacity } from "@/lib/platform-spend-guard";
import { lookupStudioContentCache, recordStudioCacheHit, storeStudioContentCache } from "@/lib/studio-content-cache";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { runStudioExplicationDeltaPipeline, runStudioExplicationFreshGenerationWithTagging } from "@/lib/studio-explication-delta";
import { EXPLICATION_CHUNK_TAGGING_ADDENDUM } from "@/lib/prompts/public-course-sections";
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
 * Parses + Zod-validates one Studio JSON response. Factored out so the
 * generic-path retry loop below (see the "else" branch's own comment) can
 * call it once per attempt without duplicating the parse/validate logic,
 * while the two explication-only single-shot paths (cross-university-delta,
 * fresh-generation-with-tagging) — whose schema is a plain min-50-char
 * string, essentially never failing validation in practice — keep calling
 * it exactly once, no retry machinery needed.
 */
function parseAndValidateStudioSection(
  raw: string,
  actionType: DemoSectionId,
  sectionKey: string
): { success: true; data: unknown } | { success: false; correctiveNote: string } {
  let parsedValue: unknown;
  try {
    const parsed = parseJsonResponse(raw);
    const value = parsed[sectionKey];
    if (value === undefined || value === null) {
      throw new Error(`La réponse de l'IA ne contient pas la clé "${sectionKey}".`);
    }
    parsedValue = sanitizeForPostgres(value);
  } catch (error) {
    return {
      success: false,
      correctiveNote: `la réponse n'était pas un JSON valide, ou la clé "${sectionKey}" était absente (${errorMessage(error)}).`,
    };
  }

  const result = STUDIO_SCHEMAS[actionType].safeParse(parsedValue);
  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    console.error(`[studio/generate:${actionType}] Validation zod échouée :`, fieldErrors);
    return { success: false, correctiveNote: `champs invalides ou manquants (d'après la validation) : ${JSON.stringify(fieldErrors)}.` };
  }

  return { success: true, data: result.data };
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
    /**
     * OPTIONAL now — the server fetches this course's own raw_text from
     * Supabase by courseId below instead of trusting the client to resend
     * it (up to 60,000 chars) on every single Studio click. Kept as a
     * fallback (used only if the DB lookup below comes back empty) rather
     * than removed outright, for resilience during rollout and for any
     * future caller that genuinely doesn't have a persisted courseId yet.
     * IMPORTANT: this was NEVER an OpenRouter-cost optimization either way
     * — Anthropic's cache_control only discounts what THIS SERVER sends to
     * the model, not where the server sourced the bytes from. This is a
     * bandwidth/latency improvement for the student's browser, nothing more.
     */
    documentContext?: unknown;
    courseId?: unknown;
  };

  if (!isValidActionType(actionType)) {
    return NextResponse.json(
      { success: false, error: `'actionType' invalide. Valeurs acceptées : ${VALID_ACTION_TYPES.join(", ")}.` },
      { status: 400 }
    );
  }
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis et doit être un nombre." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  // Server-side fetch, scoped to THIS student's own course — .eq("user_id",
  // ...) is what stops one student from reading another's course text by
  // guessing a courseId now that the server resolves it itself instead of
  // trusting whatever the client happened to already have loaded.
  const adminForSource = getSupabaseAdmin();
  const { data: courseRow, error: courseRowError } = await adminForSource
    .from("studio_courses")
    .select("raw_text")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle<{ raw_text: string | null }>();
  if (courseRowError) {
    console.error("[studio/generate] Échec lecture raw_text (fail-open vers documentContext si fourni):", courseRowError.message);
  }

  const resolvedSourceText = courseRow?.raw_text ?? (typeof documentContext === "string" ? documentContext : null);
  if (!resolvedSourceText || resolvedSourceText.trim().length < 50) {
    return NextResponse.json(
      { success: false, error: "Impossible de retrouver le texte source de ce cours (≥ 50 caractères requis)." },
      { status: 400 }
    );
  }

  const truncatedContext = resolvedSourceText.slice(0, MAX_SOURCE_CHARS);
  const { maxTokens } = STUDIO_PROMPT_CONFIG[actionType];
  const sectionKey = STUDIO_SECTION_KEYS[actionType];
  const contentHash = sha256(normalizeText(truncatedContext));

  let finalData: unknown;
  let servedFromCache = false;
  let cacheRowId: string | undefined;
  let cacheMode: "exact" | "delta" | "cross-university-delta" | "miss" = "miss";

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

    // Platform-wide circuit breaker (lib/platform-spend-guard.ts) — a
    // Studio section is one of the most expensive single calls in this app
    // (real completion caps up to 32,000 tokens), so this is exactly the
    // route where an unbounded daily total across many students matters most.
    const platformCapacity = await reservePlatformCapacity();
    if (!platformCapacity.allowed) {
      return NextResponse.json({ success: false, error: platformCapacity.reason }, { status: 503 });
    }

    // EXPLICATION-ONLY: Cross-University Chunk Caching — attempted before any
    // generic path, but ONLY on a true whole-document miss (a fuzzy
    // whole-document hit above already has a cheaper, proven path via
    // buildStudioDeltaAdaptationPrompt, and re-running chunk-level matching
    // on top of it would just be redundant work for the same saving). See
    // lib/studio-explication-delta.ts's own header comment for the full
    // design — fails open by construction, so any error/no-candidate case
    // below just falls through to full generation exactly as before this
    // feature existed.
    let crossUniversityMarkdown: string | null = null;
    if (actionType === "explication" && !isFuzzyHit) {
      try {
        crossUniversityMarkdown = await runStudioExplicationDeltaPipeline(courseId, truncatedContext, user.id);
      } catch (error) {
        console.error(
          `[studio/generate:explication] Pipeline delta cross-université échoué (fail-open, génération classique):`,
          errorMessage(error)
        );
      }
    }

    let raw: string | null = null;
    if (crossUniversityMarkdown !== null) {
      cacheMode = "cross-university-delta";
      // Shimmed into the exact same JSON shape the generic path below
      // expects ({ [sectionKey]: value }) so every downstream step —
      // parseJsonResponse, sanitizeForPostgres, zod validation, error
      // handling, storeStudioContentCache — runs completely unchanged.
      raw = JSON.stringify({ explication: crossUniversityMarkdown });
    } else if (actionType === "explication" && !isFuzzyHit) {
      // True miss, no cross-university candidate at all (first course ever
      // on this topic, or this module opted out) — full generation, but
      // WITH chapter/chunk tagging so THIS course becomes a future
      // candidate for the next university's upload on the same topic.
      try {
        const markdown = await runStudioExplicationFreshGenerationWithTagging(
          courseId,
          truncatedContext,
          STUDIO_PROMPT_CONFIG.explication.systemPrompt,
          EXPLICATION_CHUNK_TAGGING_ADDENDUM,
          maxTokens
        );
        raw = JSON.stringify({ explication: markdown });
      } catch (error) {
        await refundGeneration(user.id);
        if (error instanceof OpenRouterError) {
          return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        console.error(`[studio/generate:explication] Échec génération fraîche avec tagging:`, error);
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
      }
    }

    if (raw !== null) {
      // Single-shot path (cross-university-delta or fresh-tagging) — both
      // explication-only, whose schema (StudioTextSchema = z.string().min(50))
      // essentially never fails validation, so no retry loop is needed here.
      const outcome = parseAndValidateStudioSection(raw, actionType, sectionKey);
      if (!outcome.success) {
        await refundGeneration(user.id);
        console.error(`[studio/generate:${actionType}] Parsing/validation échoué (${cacheMode}):`, outcome.correctiveNote);
        return NextResponse.json(
          { success: false, error: `La réponse de l'IA pour "${actionType}" ne respecte pas le schéma attendu.` },
          { status: 502 }
        );
      }
      finalData = outcome.data;
    } else {
      // GENERIC PATH (fuzzy-hit delta-adaptation of any type, or a true miss
      // for resume/cas_clinique/qcm/exemples_analogies) — self-correcting
      // retry (max 2 attempts total), same pattern as the lazy Résumé branch
      // above: a validation failure feeds Zod's exact fieldErrors back to
      // the model in a corrective re-prompt instead of failing the whole
      // request on the first miss. Added after resume/cas_clinique's recent
      // prompt-compression rewrite (denser bullets, 3-consolidated-case
      // mandate) started occasionally causing the model to drop a required
      // structural key — this closes that failure mode by giving the model
      // one concrete, targeted chance to self-repair, exactly like the lazy
      // path already did for the same underlying risk.
      //
      // Fuzzy-hit (delta adaptation) still builds a single plain-string prompt
      // — that path's newSourceText differs every call anyway (a different
      // student's own upload), so there's no shared prefix across calls to
      // cache. The full-generation path below DOES have one: see
      // buildStudioSystemMessage's own comment for why the course-content
      // block must be split out and marked cache_control on its own.
      const systemContent: string | ReturnType<typeof buildStudioSystemMessage> = isFuzzyHit
        ? buildStudioDeltaAdaptationPrompt(actionType, JSON.stringify(cacheResult.data), truncatedContext)
        : buildStudioSystemMessage(actionType, truncatedContext);
      const effectiveMaxTokens = isFuzzyHit ? studioDeltaMaxTokens(actionType) : maxTokens;
      const baseUserPrompt = isFuzzyHit ? "Génère le contenu adapté demandé." : "Génère le contenu demandé.";

      // ECONOMY_MODEL (Gemini 3.7 Flash) for exemples_analogies, résumé,
      // cas_clinique and qcm — same real-test-then-decide basis as the
      // explication swap above (see lib/studio-explication-delta.ts's own
      // comment). Each of the 4 was tested independently against this exact
      // prompt+schema on a real course (Hémolyse): exemples_analogies
      // confirmed authentic Darija+français register at an acceptable volume;
      // résumé/cas_clinique/qcm each passed a full structural re-validation
      // (mirroring StudioResumeSchema/StudioCasCliniqueSchema/
      // StudioQcmsSchema — exact mode/case/question counts, every nested key
      // present, every QCM's reponsesCorrectes referencing a real option
      // label) with zero errors, plus a manual medical-accuracy read finding
      // no incorrect answer keys or fabricated facts. Real measured cost per
      // call landed around $0.03-0.035 on all three — roughly an 80%+ cut
      // from Sonnet's observed $0.21 for a single Studio QCM generation.
      // Scoped to `!isFuzzyHit` only — buildStudioDeltaAdaptationPrompt (the
      // fuzzy-hit branch just above) is a different, untested prompt, so it
      // keeps the STUDIO_MODEL default regardless of actionType.
      const generationModel = actionType !== "explication" && !isFuzzyHit ? ECONOMY_MODEL : STUDIO_MODEL;

      const MAX_GENERIC_ATTEMPTS = 2;
      let correctiveNote: string | null = null;
      let succeeded = false;

      for (let attempt = 1; attempt <= MAX_GENERIC_ATTEMPTS && !succeeded; attempt++) {
        const userPrompt = correctiveNote
          ? `Ta réponse précédente a été REJETÉE par la validation : ${correctiveNote} Régénère un JSON COMPLET et VALIDE respectant strictement TOUTES les clés du schéma ci-dessus, sans en omettre aucune.`
          : baseUserPrompt;

        // Architecture voulue par le client : le texte intégral du cours est
        // injecté DANS le system prompt (pas dans un message user séparé) —
        // voir buildStudioSystemMessage. Le message user reste minimal.
        let attemptRaw: string;
        try {
          attemptRaw = await callOpenRouter(
            [
              { role: "system", content: systemContent },
              { role: "user", content: userPrompt },
            ],
            { model: generationModel, maxTokens: effectiveMaxTokens, bypassMock: STUDIO_BYPASS_MOCK }
          );
        } catch (error) {
          await refundGeneration(user.id);
          if (error instanceof OpenRouterError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
          }
          console.error(`[studio/generate:${actionType}] Échec appel IA (${cacheMode}, tentative ${attempt}):`, error);
          return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
        }

        const outcome = parseAndValidateStudioSection(attemptRaw, actionType, sectionKey);
        if (outcome.success) {
          finalData = outcome.data;
          succeeded = true;
          break;
        }

        console.error(`[studio/generate:${actionType}] Parsing/validation échoué (${cacheMode}, tentative ${attempt}/${MAX_GENERIC_ATTEMPTS}):`, outcome.correctiveNote);
        if (attempt === MAX_GENERIC_ATTEMPTS) {
          await refundGeneration(user.id);
          return NextResponse.json(
            { success: false, error: `La réponse de l'IA pour "${actionType}" ne respecte pas le schéma attendu, même après une nouvelle tentative.` },
            { status: 502 }
          );
        }
        correctiveNote = outcome.correctiveNote;
      }
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
  // studio_courses column name. content_hash is stamped alongside it — the
  // SAME hash lookupStudioContentCache/storeStudioContentCache already
  // compute internally to key studio_content_cache, now also stored
  // directly on this row so app/api/studio/regenerate can key
  // studio_content_variations off it without re-fetching or re-hashing
  // raw_text on every regenerate click. Recomputed on every section's save
  // (cheap, pure JS) rather than only on the first — harmless if unchanged,
  // and correctly updates a row whose raw_text somehow differs from an
  // earlier section's save.
  {
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
  }

  if (servedFromCache && cacheRowId) {
    await recordStudioCacheHit(cacheRowId);
  }

  return NextResponse.json({ success: true, actionType, data: finalData, cached: servedFromCache, cacheMode });
}
