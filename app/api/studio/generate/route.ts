import { buildLanguageDirective } from "@/lib/ai/language-directive";
import { NextRequest, NextResponse } from "next/server";
import { callOpenRouter, OpenRouterError, STUDIO_MODEL, type ChatMessageInput } from "@/lib/ai/openrouter";
import { modelCallKey, runThroughLedger } from "@/lib/ai/generation-ledger";
import {
  STUDIO_BYPASS_MOCK,
  STUDIO_PROMPT_CONFIG,
  STUDIO_SECTION_KEYS,
  buildStudioSystemMessage,
  buildStudioDeltaAdaptationPrompt,
  studioDeltaMaxTokens,
  resolveCasCliniqueSystemPrompt,
  resolveCasCliniqueMaxTokens,
} from "@/lib/ai/studio-prompts";
import { parseAndValidateStudioSection } from "@/lib/ai/studio-section-validation";
import { errorMessage, MAX_SOURCE_CHARS } from "@/lib/course-generation-shared";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { reservePlatformCapacity } from "@/lib/platform-spend-guard";
import { lookupStudioContentCache, recordStudioCacheHit, storeStudioContentCache, type StudioCacheLookupResult } from "@/lib/studio-content-cache";
import { normalizeText, sha256 } from "@/lib/content-similarity";
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

/** Generation window for all validation attempts together, leaving time under maxDuration to save and answer. */
const STUDIO_GENERATION_BUDGET_MS = 250_000;
/** A corrective attempt with less time than this left would only be cut off mid-JSON. */
const STUDIO_MIN_ATTEMPT_MS = 45_000;

const VALID_ACTION_TYPES = Object.keys(STUDIO_PROMPT_CONFIG) as JsonSectionId[];

function isValidActionType(value: unknown): value is JsonSectionId {
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
 * PLAN QUOTA (billing rule): reserveGeneration() (lib/subscription.ts)
 * atomically reserves the student's standard unit on EVERY request, before
 * any cache — exact hit, ledger hit, fuzzy or miss alike. Caches only lower
 * OUR model bill. refundGeneration() undoes it only when the section could
 * not be delivered (generation or save failure).
 */
async function handlePost(request: NextRequest): Promise<NextResponse> {
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
  // Explication now generates exclusively through its own client-driven,
  // multi-request pipeline (app/api/studio/generate/explication-part +
  // explication-finalize — see lib/studio-explication-delta.ts's
  // ARCHITECTURE comment for why: a single request/serverless invocation
  // could not reliably survive Explication's real generation time against
  // Vercel's own duration ceiling). Guarded here, explicitly, so this route
  // can never silently fall back into that retired, unsafe single-call path
  // for Explication specifically — every OTHER actionType is unaffected.
  if (actionType === "explication") {
    return NextResponse.json(
      { success: false, error: "'explication' se génère via /api/studio/generate/explication-part, pas via cette route." },
      { status: 400 }
    );
  }
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis et doit être un nombre." }, { status: 400 });
  }

  const language: "fr" | "en" = languageRaw === "en" ? "en" : "fr";
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
  const isPersonalizedVariant = language !== "fr" || (actionType === "cas_clinique" && studyYear !== null);
  const languageInstruction =
    language === "en"
      ? "\n\nINSTRUCTION DE LANGUE OBLIGATOIRE (remplace toute langue de sortie précédemment implicite) : rédige l'INTÉGRALITÉ de ta réponse — tous les champs textuels du JSON, sans exception — en ANGLAIS, jamais en français, en conservant strictement le même niveau de rigueur médicale, la même structure JSON et le même format exact déjà exigés ci-dessus." + buildLanguageDirective("en")
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
  // resolveCasCliniqueMaxTokens — cas_clinique is the one section whose
  // token ceiling also varies by year (année 1's "Utilité Clinique" now
  // demands full-course coverage, proportionally as long as Explication);
  // every other actionType keeps its flat STUDIO_PROMPT_CONFIG value.
  const maxTokens = actionType === "cas_clinique" ? resolveCasCliniqueMaxTokens(studyYear) : STUDIO_PROMPT_CONFIG[actionType].maxTokens;
  const sectionKey = STUDIO_SECTION_KEYS[actionType];
  const contentHash = sha256(normalizeText(truncatedContext));

  let finalData: unknown;
  let servedFromCache = false;
  let cacheRowId: string | undefined;
  let cacheMode: "exact" | "delta" | "cross-university-delta" | "miss" = "miss";

  // BILLING RULE — Plan quota RESERVATION before ANY cache: the student's
  // standard unit is consumed on every generation request, whether the
  // section is then served from studio_content_cache, the generation ledger,
  // or a real model call. The caches cut OUR OpenRouter bill, never the
  // student's quota. Atomic check-and-increment (see reserveGeneration's own
  // comment — closes a real TOCTOU race); refunded only if this request
  // fails to deliver the section.
  const quotaGate = await reserveGeneration(user);
  if (!quotaGate.allowed) {
    return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
  }

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

    // GENERIC PATH (fuzzy-hit delta-adaptation of any type, or a true miss
    // for resume/cas_clinique/qcm/exemples_analogies). The prompt is built
    // BEFORE the quota reservation now (pure string work, no side effect) so
    // the generation ledger can be consulted first — see ledgerSpec below.
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
      (isPersonalizedVariant ? `${STUDIO_PROMPT_CONFIG[actionType].systemPrompt}${languageInstruction}` : undefined);
    const systemContent: string | ReturnType<typeof buildStudioSystemMessage> = isFuzzyHit
      ? buildStudioDeltaAdaptationPrompt(actionType, JSON.stringify(cacheResult.data), truncatedContext)
      : buildStudioSystemMessage(actionType, truncatedContext, overrideBasePrompt);
    const effectiveMaxTokens = isFuzzyHit ? studioDeltaMaxTokens(actionType) : maxTokens;
    const baseUserPrompt = isFuzzyHit ? "Génère le contenu adapté demandé." : "Génère le contenu demandé.";

    // MODEL POLICY: every Studio section reaching this generic path runs on
    // STUDIO_MODEL (Qwen3-235B-2507 since 2026-10-07, was Gemini 3.7 Flash —
    // see lib/ai/openrouter.ts). Explication Ultra-Détaillée never reaches
    // here, see the actionType === "explication" guard near the top of this
    // handler. No `reasoning` cap: it existed for Gemini Flash's hidden
    // thinking tokens; Qwen3-235B-2507 is non-thinking.
    const generationModel = STUDIO_MODEL;
    const firstAttemptMessages: ChatMessageInput[] = [
      { role: "system", content: systemContent },
      { role: "user", content: baseUserPrompt },
    ];

    // GENERATION LEDGER (lib/ai/generation-ledger.ts). Keyed on the exact
    // first-attempt request (system prompt incl. course text + language /
    // study-year variant, model, budget, reasoning cap) and storing only the
    // FINAL validated section. This is what finally covers what
    // studio_content_cache structurally can't: English and année-1/2
    // variants are shared between every student who uploads the same
    // polycopié in that same variant, and two concurrent identical requests
    // (double tap, two tabs, two students on a brand-new course) generate
    // once. It only ever lowers OUR model bill: the student's unit was
    // already reserved above, whatever this resolves to.
    const ledgerSpec = {
      namespace: `studio-section:${actionType}`,
      key: modelCallKey(firstAttemptMessages, { model: generationModel, maxTokens: effectiveMaxTokens }),
      // 300s route budget; three validated attempts rarely exceed ~150s.
      peerWaitMs: 60_000,
      leaseMs: 4 * 60_000,
      isValid: (value: unknown) => value !== null && value !== undefined,
    };

    // Self-correcting retry (max 3 attempts total): a validation failure
    // feeds Zod's exact fieldErrors back to the model in a corrective
    // re-prompt instead of failing the whole request on the first miss.
    //
    // RAISED 2 -> 3 after a real, reported production symptom: an
    // occasional "ne respecte pas le schéma attendu" failure on Résumé
    // specifically, which then generated CLEANLY the very next time the
    // student manually retried (a brand new, independent call). That
    // pattern — fails once or twice in a row, then a fresh attempt
    // succeeds — points at stochastic model variance, not a systematic
    // token-budget or prompt problem: StudioResumeSchema requires EVERY
    // one of its 6 modes to carry every structural field (hero, sections,
    // ddx_table, pieges, cards, steps, quotes, perles, items — see
    // lib/ai/studio-schemas.ts), even the placeholder-empty ones a given
    // mode doesn't conceptually use, which is a lot of required surface
    // area for the model to occasionally drop one field on. The existing
    // corrective re-prompt (feeding Zod's exact fieldErrors back to the
    // model) already works — it just didn't get enough chances before
    // this route gave up and surfaced a failure the student's own next
    // click would have resolved anyway.
    const MAX_GENERIC_ATTEMPTS = 3;
    const generateValidatedSection = async (): Promise<unknown> => {
      // Platform-wide circuit breaker (lib/platform-spend-guard.ts) — a
      // Studio section is one of the most expensive single calls in this app
      // (real completion caps up to 32,000 tokens), so this is exactly the
      // route where an unbounded daily total across many students matters
      // most. Checked here, inside the ledger producer, so it only ever
      // counts requests that really reach the model.
      const platformCapacity = await reservePlatformCapacity();
      if (!platformCapacity.allowed) throw new StudioGenerationFailure(platformCapacity.reason ?? "MedArt Neural Engine est momentanément saturé. Réessaie un peu plus tard.", 503);

      // Qwen3-235B decodes slower than Flash did, so a corrective retry is
      // only started when it can still finish inside the 300s route budget —
      // otherwise the student gets a clean, refunded error instead of a
      // platform kill mid-generation.
      const deadlineAt = Date.now() + STUDIO_GENERATION_BUDGET_MS;
      let correctiveNote: string | null = null;
      for (let attempt = 1; attempt <= MAX_GENERIC_ATTEMPTS; attempt++) {
        const remainingMs = deadlineAt - Date.now();
        if (remainingMs < STUDIO_MIN_ATTEMPT_MS) {
          throw new StudioGenerationFailure(
            `La génération de "${actionType}" a pris trop de temps (${attempt - 1} tentative(s) rejetée(s) par la validation). Réessaie — ta génération n'a pas été décomptée.`,
            504
          );
        }
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
            { model: generationModel, maxTokens: effectiveMaxTokens, bypassMock: STUDIO_BYPASS_MOCK, providerSort: "throughput", timeoutMs: remainingMs }
          );
        } catch (error) {
          if (error instanceof OpenRouterError) throw new StudioGenerationFailure(error.message, error.status);
          console.error(`[studio/generate:${actionType}] Échec appel IA (${cacheMode}, tentative ${attempt}):`, error);
          throw new StudioGenerationFailure(errorMessage(error), 502);
        }

        const outcome = parseAndValidateStudioSection(attemptRaw, actionType, sectionKey, studyYear);
        if (outcome.success) return outcome.data;

        console.error(`[studio/generate:${actionType}] Parsing/validation échoué (${cacheMode}, tentative ${attempt}/${MAX_GENERIC_ATTEMPTS}):`, outcome.correctiveNote);
        correctiveNote = outcome.correctiveNote;
      }
      throw new StudioGenerationFailure(
        `La réponse de l'IA pour "${actionType}" ne respecte pas le schéma attendu, même après ${MAX_GENERIC_ATTEMPTS - 1} nouvelles tentatives.`,
        502
      );
    };

    try {
      finalData = await runThroughLedger(ledgerSpec, generateValidatedSection);
    } catch (error) {
      await refundGeneration(user.id);
      if (error instanceof StudioGenerationFailure) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      }
      console.error(`[studio/generate:${actionType}] Échec génération (${cacheMode}):`, error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
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
    // enter the shared cross-student cache (the generation ledger above is
    // what shares those variants, keyed on the variant's own exact prompt).
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
      await refundGeneration(user.id); // nothing was delivered
      return NextResponse.json({ success: false, error: `Sauvegarde échouée : ${saveError.message}` }, { status: 500 });
    }
    if (count === 0) {
      await refundGeneration(user.id);
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

/** A generation failure that already carries the student-facing message and HTTP status (thrown out of the ledger producer). */
class StudioGenerationFailure extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Defensive top-level backstop — the AI generation step above already has
 * its own targeted try/catch (with quota refunds attached), but an
 * unexpected exception anywhere ELSE in this handler (a DB read, cache
 * lookup, or persistence step not anticipated) would otherwise escape as an
 * unhandled rejection and surface to the student as an opaque framework
 * crash ("Impossible de contacter le serveur") instead of this app's own
 * `{success:false, error}` JSON shape the frontend knows how to render.
 * Never masks a real, already-handled error response — only ever catches
 * what the handler itself did not.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    return await handlePost(request);
  } catch (error) {
    console.error("[studio/generate] Exception non interceptée:", error);
    return NextResponse.json({ success: false, error: "Une erreur inattendue est survenue. Réessaie." }, { status: 500 });
  }
}
