import { NextRequest, NextResponse } from "next/server";
import { callOpenRouter, OpenRouterError, ECONOMY_MODEL } from "@/lib/ai/openrouter";
import {
  STUDIO_BYPASS_MOCK,
  STUDIO_PROMPT_CONFIG,
  STUDIO_SECTION_KEYS,
  buildStudioSystemMessage,
  buildStudioDeltaAdaptationPrompt,
  studioDeltaMaxTokens,
  resolveCasCliniqueSystemPrompt,
} from "@/lib/ai/studio-prompts";
import { resolveStudioSchema } from "@/lib/ai/studio-schemas";
import { errorMessage, MAX_SOURCE_CHARS, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { reservePlatformCapacity } from "@/lib/platform-spend-guard";
import { lookupStudioContentCache, recordStudioCacheHit, storeStudioContentCache, type StudioCacheLookupResult } from "@/lib/studio-content-cache";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { runStudioExplicationDeltaPipeline, runStudioExplicationFreshGenerationWithTagging } from "@/lib/studio-explication-delta";
import { EXPLICATION_CHUNK_TAGGING_ADDENDUM } from "@/lib/prompts/public-course-sections";
import { dispatchStudioGenerationPush } from "@/lib/push/dispatch";
import type { JsonSectionId } from "@/lib/demo-content";

export const runtime = "nodejs";
// Explication/QCM/exemples_analogies routinely run 1-3+ minutes at
// maxTokens=32000. Only relevant if/when this is deployed to Vercel — its
// serverless functions are killed at a per-plan duration cap (as low as 10s
// on Hobby) regardless of anything in this file, which would otherwise cut
// these off well before OpenRouter responds. No effect on `next dev` or
// other hosts, which have no such cap.
export const maxDuration = 300;

const VALID_ACTION_TYPES = Object.keys(STUDIO_PROMPT_CONFIG) as JsonSectionId[];

function isValidActionType(value: unknown): value is JsonSectionId {
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
  actionType: JsonSectionId,
  sectionKey: string,
  studyYear: number | null | undefined
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

  // resolveStudioSchema — the ONE section whose schema genuinely varies by
  // year (cas_clinique: année 1 = essai motivationnel, année 2 = 1 cas
  // physiologique, année 3+/inconnue = le schéma standard inchangé). Every
  // other actionType ignores `studyYear` entirely and gets its usual,
  // unconditional schema.
  const result = resolveStudioSchema(actionType, studyYear).safeParse(parsedValue);
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

  const {
    actionType,
    documentContext,
    courseId,
    language: languageRaw,
    customPrompt: customPromptRaw,
    studyYear: studyYearRaw,
  } = (body ?? {}) as {
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
    /** Studio tile pre-generation menu (Point 4) — "fr" (default, omitted) or "en". */
    language?: unknown;
    /** Explication-only free-text addition from the tile's pre-generation menu — ignored for every other actionType. */
    customPrompt?: unknown;
    /**
     * The student's OWN curriculum level (StudentCurriculumProfile.
     * academicYear.level, types/academic.ts — sent by the client, resolved
     * from their profile, never trusted beyond "is this exactly 1 or 2").
     * Only ever changes behavior for actionType === "cas_clinique" (see
     * resolveCasCliniqueSystemPrompt/resolveStudioSchema) — every other
     * section ignores it entirely, so an absent/malformed value here never
     * affects them.
     */
    studyYear?: unknown;
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

  const language: "fr" | "en" = languageRaw === "en" ? "en" : "fr";
  const customPrompt = actionType === "explication" && typeof customPromptRaw === "string" ? customPromptRaw.trim().slice(0, 2000) : "";
  // Only exactly 1 or 2 is ever meaningful (see resolveCasCliniqueSystemPrompt/
  // resolveStudioSchema's own identical gating) — anything else (a real
  // number like 3-7, or a missing/malformed value) resolves to `null`,
  // which both resolvers treat as "3ème année et +", the unconditional
  // default this section has always had.
  const studyYear = studyYearRaw === 1 || studyYearRaw === 2 ? studyYearRaw : null;
  // A non-default language, a custom prompt (explication only), or a
  // non-default study year on cas_clinique (année 1/2) makes this a
  // PERSONALIZED request — never served from, nor written to, the
  // cross-student studio_content_cache (keyed on content_hash alone, no
  // language/prompt/year dimension — extending it would need a schema
  // migration this codebase has no confirmed-live tooling for), and never
  // routed through the cross-university Explication chunk-delta pipeline
  // either (that pipeline reuses OTHER students' French, default-prompt
  // chapters — wrong material to reuse for a personalized request). Falls
  // straight through to a full, fresh generation via the generic path
  // below, exactly like /api/studio/regenerate already does for its own
  // "student explicitly wants something different" case. Without this, a
  // 1ère année and a 3ème année student uploading the SAME course text
  // would silently share one cas_clinique cache entry — showing one of
  // them the wrong shape/content entirely.
  const isPersonalizedVariant =
    language !== "fr" || customPrompt.length > 0 || (actionType === "cas_clinique" && studyYear !== null);
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

  // Server-side fetch, scoped to THIS student's own course — .eq("user_id",
  // ...) is what stops one student from reading another's course text by
  // guessing a courseId now that the server resolves it itself instead of
  // trusting whatever the client happened to already have loaded.
  const adminForSource = getSupabaseAdmin();
  const { data: courseRow, error: courseRowError } = await adminForSource
    .from("studio_courses")
    .select("raw_text, title, curriculum_module_id")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle<{ raw_text: string | null; title: string | null; curriculum_module_id: number | null }>();
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

  const cacheResult: StudioCacheLookupResult = isPersonalizedVariant
    ? { hit: false }
    : await lookupStudioContentCache(actionType, truncatedContext);

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
    if (actionType === "explication" && !isFuzzyHit && !isPersonalizedVariant) {
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
    } else if (actionType === "explication" && !isFuzzyHit && !isPersonalizedVariant) {
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
      const outcome = parseAndValidateStudioSection(raw, actionType, sectionKey, studyYear);
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
      // isFuzzyHit can never be true here when isPersonalizedVariant is —
      // the cache lookup itself was skipped for a personalized request (see
      // cacheResult above), so this always resolves to the fresh-generation
      // branch for language/custom-prompt/study-year requests, carrying the
      // extra instructions appended to (or, for cas_clinique, swapped for
      // the year-appropriate variant of) the section's own base prompt —
      // never blindly REPLACING it for language/customPrompt — Explication's
      // "SURCHARGE OBLIGATOIRE" quality mandates stay intact via the append
      // pattern, while cas_clinique's year-1/year-2 variants are complete,
      // self-contained prompts in their own right (see
      // resolveCasCliniqueSystemPrompt's own comment for why they can't
      // just be appended on top of the standard 3-case mandate).
      const casCliniqueOverride = actionType === "cas_clinique" ? resolveCasCliniqueSystemPrompt(studyYear) : null;
      const overrideBasePrompt =
        casCliniqueOverride ??
        (isPersonalizedVariant ? `${STUDIO_PROMPT_CONFIG[actionType].systemPrompt}${languageInstruction}${customPromptInstruction}` : undefined);
      const systemContent: string | ReturnType<typeof buildStudioSystemMessage> = isFuzzyHit
        ? buildStudioDeltaAdaptationPrompt(actionType, JSON.stringify(cacheResult.data), truncatedContext)
        : buildStudioSystemMessage(actionType, truncatedContext, overrideBasePrompt);
      const effectiveMaxTokens = isFuzzyHit ? studioDeltaMaxTokens(actionType) : maxTokens;
      const baseUserPrompt = isFuzzyHit ? "Génère le contenu adapté demandé." : "Génère le contenu demandé.";

      // MODEL POLICY (definitive product decision): every Studio section —
      // explication included, no exception — runs on ECONOMY_MODEL (Gemini
      // 3.7 Flash). Explication/résumé/cas_clinique/qcm/exemples_analogies
      // were each independently tested against this exact prompt+schema on
      // a real course (Hémolyse): résumé/cas_clinique/qcm each passed a
      // full structural re-validation (mirroring StudioResumeSchema/
      // StudioCasCliniqueSchema/StudioQcmsSchema — exact mode/case/question
      // counts, every nested key present, every QCM's reponsesCorrectes
      // referencing a real option label) with zero errors, plus a manual
      // medical-accuracy read finding no incorrect answer keys or
      // fabricated facts; exemples_analogies confirmed authentic
      // Darija+français register at an acceptable volume. There is no
      // longer a Sonnet fallback anywhere in this route, including the
      // fuzzy-hit delta-adaptation branch above.
      const generationModel = ECONOMY_MODEL;

      // reasoning: { effort: "low" } — confirmed production root cause of
      // "JSON.parse failed" on long courses: OpenRouter's `reasoning`
      // tokens are billed as OUTPUT tokens but are NOT a separate budget
      // from the visible completion (see callOpenRouter's own doc comment)
      // — on google/gemini-3.7-flash specifically, an uncapped reasoning
      // effort can silently burn most of `effectiveMaxTokens` on hidden
      // "thinking" before the model writes a single character of the
      // actual JSON, truncating it mid-structure regardless of how high
      // the ceiling is set. `streamOpenRouter` (the chat path) already caps
      // this for the exact same model — every Studio call now gets the
      // identical cap, unconditionally, since ECONOMY_MODEL is now the
      // only model this route ever calls.
      const reasoningOption = { effort: "low" } as const;

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
            { model: generationModel, maxTokens: effectiveMaxTokens, bypassMock: STUDIO_BYPASS_MOCK, reasoning: reasoningOption }
          );
        } catch (error) {
          await refundGeneration(user.id);
          if (error instanceof OpenRouterError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
          }
          console.error(`[studio/generate:${actionType}] Échec appel IA (${cacheMode}, tentative ${attempt}):`, error);
          return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
        }

        const outcome = parseAndValidateStudioSection(attemptRaw, actionType, sectionKey, studyYear);
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
    // atomically, before this call even ran. Skipped for a personalized
    // (non-default language / custom prompt) request — see
    // isPersonalizedVariant's own comment above for why this must never
    // enter the shared cross-student cache.
    if (!isPersonalizedVariant) {
      await storeStudioContentCache(actionType, truncatedContext, finalData);
    }
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

  // "Content is ready" push — see dispatchStudioGenerationPush's own header
  // comment for why this uses real Web Push instead of the page-scoped
  // Notification API. Only for a genuine fresh generation, never a cache hit
  // (servedFromCache resolves in ~1-2s behind a fake UX delay — the student
  // is essentially always still on the page for that, a push would be
  // redundant). AWAITED, not fire-and-forget: this is a serverless function
  // (see maxDuration above) — work left running after the response is
  // returned has no platform guarantee of actually finishing here, unlike a
  // long-lived server process. Still never allowed to turn an
  // already-successful generation into an error response — any failure is
  // caught and logged, not rethrown.
  if (!servedFromCache && courseRow?.title && courseRow.curriculum_module_id) {
    try {
      await dispatchStudioGenerationPush(user.id, courseRow.title, actionType, `/dashboard/module/${courseRow.curriculum_module_id}`);
    } catch (error) {
      console.error(`[studio/generate:${actionType}] Échec envoi push (non bloquant):`, error);
    }
  }

  return NextResponse.json({ success: true, actionType, data: finalData, cached: servedFromCache, cacheMode });
}
