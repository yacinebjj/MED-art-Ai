import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError, HAIKU_MODEL } from "@/lib/ai/openrouter";
import {
  STUDIO_BYPASS_MOCK,
  STUDIO_PROMPT_CONFIG,
  STUDIO_SECTION_KEYS,
  buildStudioRegeneratePrompt,
} from "@/lib/ai/studio-prompts";
import { STUDIO_SCHEMAS } from "@/lib/ai/studio-schemas";
import { errorMessage, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { lookupVariations, insertVariation, recordVariationHit } from "@/lib/studio-content-variations";
import type { JsonSectionId } from "@/lib/demo-content";

export const runtime = "nodejs";
export const maxDuration = 300; // same headroom as /api/studio/generate — a regenerate call is a full AI generation too.

/**
 * Maximum real generations ever produced per (course, section) — once this
 * many variations exist, every future "Régénérer" click is served from them
 * at $0, forever, for ANY student on that (course, section) pair, not just
 * the one who triggered each generation — this is the actual mechanism
 * behind "a later student's regenerate costs nothing" (product ask).
 * Raised from 10 to 20 alongside the model switch below (STUDIO_MODEL ->
 * HAIKU_MODEL, ~2x cheaper per token): the same worst-case-total-spend
 * ceiling this cap was originally sized to now buys twice the stored
 * variety for the same dollar risk.
 */
const MAX_VARIATIONS = 20;

const VALID_SECTIONS = Object.keys(STUDIO_PROMPT_CONFIG) as JsonSectionId[];

function isValidSection(value: unknown): value is JsonSectionId {
  return typeof value === "string" && (VALID_SECTIONS as string[]).includes(value);
}

interface CourseRow {
  content_hash: string | null;
  [column: string]: unknown;
}

/**
 * "Regénérer" — mirrors app/api/studio/generate/route.ts's call/parse/validate
 * flow, but with a deliberately cheaper input: it fetches ONLY the section's
 * own already-generated column from studio_courses (never raw_text, never
 * the original source document) and sends that back to the model with a
 * rewrite/regenerate instruction (see buildStudioRegeneratePrompt).
 *
 * VARIATION CACHE (see lib/studio-content-variations.ts and
 * supabase/schema.sql's studio_content_variations comment for the full
 * design + the explicit product tradeoff this creates): keyed by the
 * course's stored content_hash (stamped by /api/studio/generate) + section.
 * Up to MAX_VARIATIONS real generations are ever produced per (course,
 * section), shared across every student on that course — after that, every
 * "Régénérer" click serves a random existing variation at $0, no
 * OpenRouter call, no courseCap consumption. Rows generated before
 * content_hash existed (null) fall back to the ORIGINAL always-fresh,
 * always-billed behavior — see the branch below.
 *
 * Gated by reserveGeneration()/refundGeneration() (lib/subscription.ts) —
 * shares the plan's courseCap pool with /api/studio/generate — but ONLY on
 * the path that makes a real OpenRouter call. Serving a cached variation
 * never reserves or consumes courseCap, same "cache hits don't count" rule
 * as everywhere else in this app.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-regenerate:${user.id}`, RATE_LIMITS.ai);
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

  const { courseId, section } = (body ?? {}) as { courseId?: unknown; section?: unknown };

  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis et doit être un nombre." }, { status: 400 });
  }
  if (!isValidSection(section)) {
    return NextResponse.json(
      { success: false, error: `'section' invalide. Valeurs acceptées : ${VALID_SECTIONS.join(", ")}.` },
      { status: 400 }
    );
  }
  // Cas Clinique regeneration is permanently disabled by product direction —
  // the 3 generated cases must stay static forever. The frontend already
  // hides the "Régénérer" menu item for this section (StudioPanel.tsx,
  // MobileStudioCards.tsx) — this is the real enforcement, since a client is
  // never trusted to police its own request.
  if (section === "cas_clinique") {
    return NextResponse.json(
      { success: false, error: "La régénération de la section Cas Clinique n'est pas disponible — les cas générés restent définitifs." },
      { status: 403 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  // "qcm" -> "qcms" is the one mismatch, identity otherwise — same column
  // names as studio_courses (see STUDIO_SECTION_KEYS's own doc comment).
  const column = STUDIO_SECTION_KEYS[section];
  const supabase = getSupabaseAdmin();

  const { data: courseRow, error: fetchError } = await supabase
    .from("studio_courses")
    .select(`${column}, content_hash`)
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle<CourseRow>();

  if (fetchError) {
    console.error("[studio/regenerate] Échec lecture Supabase:", fetchError);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${fetchError.message}` }, { status: 500 });
  }
  if (!courseRow) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  const existingValue = courseRow[column];
  if (existingValue === null || existingValue === undefined) {
    return NextResponse.json(
      { success: false, error: "Rien à régénérer — génère d'abord ce contenu une première fois." },
      { status: 400 }
    );
  }

  const sectionKey = STUDIO_SECTION_KEYS[section];
  const contentHash = courseRow.content_hash;
  // Captured here, not read as `user.id` inside saveAndRespond below — TS's
  // control-flow narrowing from the `if (!user)` guard above doesn't cross a
  // nested function-declaration boundary (same gotcha hit earlier this
  // session in ActiveFlashcardsDeck's storage-event handler).
  const userId = user.id;

  // QCM-only, PERSONAL regeneration ceiling — 4 per (student, course),
  // separate from and in ADDITION to the platform-wide studio_content_variations
  // cache below (that one caps how many DISTINCT contents ever get created,
  // shared across every student; this one caps how many times THIS student
  // can click "Régénérer" at all, even while the shared pool still has room
  // for more variations from other students). Checked BEFORE either
  // regeneration path below runs — atomic check-and-increment via
  // reserve_qcm_regenerate (supabase/schema.sql), so a cache-served variation
  // and a fresh generation both count identically toward the cap; the two
  // limits are independent, neither substitutes for the other.
  if (section === "qcm") {
    const QCM_REGENERATE_CAP = 4;
    const { data: qcmCount, error: qcmCapError } = await supabase.rpc("reserve_qcm_regenerate", {
      p_course_id: courseId,
      p_user_id: userId,
      p_cap: QCM_REGENERATE_CAP,
    });
    if (qcmCapError) {
      console.error("[studio/regenerate:qcm] Échec réservation du plafond de régénération:", qcmCapError.message);
      return NextResponse.json({ success: false, error: `Vérification du plafond échouée : ${qcmCapError.message}` }, { status: 500 });
    }
    if (qcmCount === null) {
      return NextResponse.json(
        { success: false, error: `Tu as atteint la limite de ${QCM_REGENERATE_CAP} régénérations pour l'Examen QCM de ce cours.` },
        { status: 403 }
      );
    }
  }

  /** Undoes the QCM-only reservation above on a downstream failure — same "a failed attempt shouldn't cost you a unit" fairness as refundGeneration, called alongside it at every one of its call sites below. No-op for every other section. */
  async function refundQcmRegenerateIfNeeded() {
    if (section !== "qcm") return;
    const { error } = await supabase.rpc("refund_qcm_regenerate", { p_course_id: courseId, p_user_id: userId });
    if (error) console.warn("[studio/regenerate:qcm] Échec refund_qcm_regenerate:", error.message);
  }

  /** Persists `content` into this student's own row and returns the success response — the one write/response shape shared by every path below (cache hit, freshly generated, or legacy fallback). `cached` powers the frontend's UX-illusion artificial delay (lib/fake-ai-delay.ts) — true only when `content` came from studio_content_variations without a real OpenRouter call. */
  async function saveAndRespond(content: unknown, cached = false) {
    const { error: updateError, count } = await supabase
      .from("studio_courses")
      .update({ [column]: content, updated_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", courseId)
      .eq("user_id", userId);

    if (updateError) {
      console.error("[studio/regenerate] Échec update Supabase:", updateError);
      return NextResponse.json({ success: false, error: `Sauvegarde échouée : ${updateError.message}` }, { status: 500 });
    }
    if (count === 0) {
      return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
    }
    return NextResponse.json({ success: true, section, data: content, cached });
  }

  // --- Variation cache path (content_hash present) ---------------------
  if (contentHash) {
    const { existing } = await lookupVariations(contentHash, section);

    if (existing.length >= MAX_VARIATIONS) {
      // Cap reached — NEVER call OpenRouter again for this (course, section).
      // Serve a random existing variation, $0, no courseCap consumption.
      const picked = existing[Math.floor(Math.random() * existing.length)];
      await recordVariationHit(picked.id);
      return saveAndRespond(picked.content, true);
    }

    // Fewer than MAX_VARIATIONS exist — build up to the cap with a real
    // generation. Quota RESERVATION here, atomic (see reserveGeneration's
    // own comment), before the real call below.
    const quotaGate = await reserveGeneration(user);
    if (!quotaGate.allowed) {
      return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
    }

    const existingContentText = typeof existingValue === "string" ? existingValue : JSON.stringify(existingValue);
    const { maxTokens } = STUDIO_PROMPT_CONFIG[section];

    let raw: string;
    try {
      raw = await callOpenRouter(
        [
          { role: "system", content: buildStudioRegeneratePrompt(section, existingContentText) },
          { role: "user", content: "Génère le contenu régénéré demandé." },
        ],
        // Haiku, not Sonnet — a light rewrite of ALREADY-correct content
        // (see buildStudioRegeneratePrompt's own 90/10 instruction) is a
        // fundamentally lower-risk task for a cheaper model than fresh
        // clinical reasoning from scratch: no new differential diagnosis,
        // no new distractor design, just rewording/restructuring text
        // that's already been validated once. ~2x cheaper per token than
        // Sonnet — genuine, honest savings; NOT the "90% of the original
        // cost" some product framing implied, which isn't achievable for a
        // fresh generation of comparable length/depth (see this route's own
        // MAX_VARIATIONS comment for why the REAL "later regenerate is
        // free" mechanism is the variation cache, not a cheaper model).
        { model: HAIKU_MODEL, maxTokens, bypassMock: STUDIO_BYPASS_MOCK }
      );
    } catch (error) {
      await refundGeneration(user.id);
      await refundQcmRegenerateIfNeeded();
      if (error instanceof OpenRouterError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      }
      console.error(`[studio/regenerate:${section}] Échec appel IA:`, error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }

    let sanitized: unknown;
    try {
      const parsed = parseJsonResponse(raw);
      const value = parsed[sectionKey];
      if (value === undefined || value === null) {
        console.error(`[studio/regenerate:${section}] Clé "${sectionKey}" absente. Clés reçues :`, Object.keys(parsed));
        throw new Error(`La réponse de l'IA ne contient pas la clé "${sectionKey}".`);
      }
      const schema = STUDIO_SCHEMAS[section];
      const result = schema.safeParse(sanitizeForPostgres(value));
      if (!result.success) {
        console.error(`[studio/regenerate:${section}] Validation zod échouée :`, result.error.flatten());
        throw new Error(`La réponse de l'IA pour "${section}" ne respecte pas le schéma attendu.`);
      }
      sanitized = result.data;
    } catch (error) {
      await refundGeneration(user.id);
      await refundQcmRegenerateIfNeeded();
      console.error(`[studio/regenerate:${section}] Parsing/validation échoué :`, error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }

    // Insert as the next variation slot. A concurrent request may have
    // already filled it (23505) — that's not an error, just serve THIS
    // student's own freshly-generated content anyway (their own successful,
    // reserved generation) rather than discarding it to go fetch the
    // winner's variation; a future call re-reads `existing` fresh and will
    // correctly see both/the cap either way.
    const inserted = await insertVariation(contentHash, section, existing.length + 1, sanitized);
    if (inserted.conflict) {
      console.warn(`[studio/regenerate:${section}] Conflit d'insertion de variation (course concurrent) — contenu propre servi quand même.`);
    }

    return saveAndRespond(sanitized);
  }

  // --- Legacy fallback (content_hash not set — row predates this feature) ---
  // Original always-fresh, always-billed behavior. No variation caching is
  // possible without a stable cross-student key.
  const { maxTokens } = STUDIO_PROMPT_CONFIG[section];
  const existingContentText = typeof existingValue === "string" ? existingValue : JSON.stringify(existingValue);

  const quotaGate = await reserveGeneration(user);
  if (!quotaGate.allowed) {
    return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
  }

  let raw: string;
  try {
    raw = await callOpenRouter(
      [
        { role: "system", content: buildStudioRegeneratePrompt(section, existingContentText) },
        { role: "user", content: "Génère le contenu régénéré demandé." },
      ],
      // Haiku, not Sonnet — same reasoning as the variation-cache path above.
      { model: HAIKU_MODEL, maxTokens, bypassMock: STUDIO_BYPASS_MOCK }
    );
  } catch (error) {
    await refundGeneration(user.id);
    await refundQcmRegenerateIfNeeded();
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error(`[studio/regenerate:${section}] Échec appel IA (legacy, sans content_hash):`, error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }

  let sanitized: unknown;
  try {
    const parsed = parseJsonResponse(raw);
    const value = parsed[sectionKey];
    if (value === undefined || value === null) {
      console.error(`[studio/regenerate:${section}] Clé "${sectionKey}" absente. Clés reçues :`, Object.keys(parsed));
      throw new Error(`La réponse de l'IA ne contient pas la clé "${sectionKey}".`);
    }
    const schema = STUDIO_SCHEMAS[section];
    const result = schema.safeParse(sanitizeForPostgres(value));
    if (!result.success) {
      console.error(`[studio/regenerate:${section}] Validation zod échouée :`, result.error.flatten());
      throw new Error(`La réponse de l'IA pour "${section}" ne respecte pas le schéma attendu.`);
    }
    sanitized = result.data;
  } catch (error) {
    await refundGeneration(user.id);
    await refundQcmRegenerateIfNeeded();
    console.error(`[studio/regenerate:${section}] Parsing/validation échoué (legacy) :`, error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }

  return saveAndRespond(sanitized);
}
