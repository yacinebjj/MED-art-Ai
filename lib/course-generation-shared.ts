import { NextResponse } from "next/server";
import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import {
  buildSourceTextUserMessage,
  CAS_CLINIQUE_SYSTEM_PROMPT,
  EXEMPLES_ANALOGIES_SYSTEM_PROMPT,
  EXPLICATION_SYSTEM_PROMPT,
  MIND_MAP_SYSTEM_PROMPT,
  QCMS_SYSTEM_PROMPT,
  RESUME_SYSTEM_PROMPT,
} from "@/lib/prompts/public-course-sections";

/**
 * Shared helpers + the shared modular-generation pipeline used by:
 *  - app/api/generate-course/route.ts (instant upload: extract + insert only)
 *  - app/api/generate/explication/route.ts
 *  - app/api/generate/resume/route.ts
 *  - app/api/generate/cas-clinique/route.ts
 *  - app/api/generate/qcm/route.ts
 *  - app/api/generate/mind-map/route.ts
 *  - app/api/generate/exemples-analogies/route.ts
 *
 * Each of the 6 route files above is a thin wrapper calling
 * `generateCourseSection` with a fixed `Section` — kept as separate route
 * files (rather than one parameterized route) per spec, but sharing this one
 * implementation so the sanitization/parsing/error-handling logic — all of
 * it hard-won debugging real Supabase/OpenRouter failures — is never
 * duplicated 5 times.
 */

export const MAX_SOURCE_CHARS = 60_000; // matches the cap used by the rest of the app's AI pipeline

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // strip combining diacritical marks (accents) left by NFD normalization
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Postgres refuses any text/jsonb value containing a NUL byte (U+0000) --
 * insert/update fails with `22P05 unsupported Unicode escape sequence`,
 * confirmed live against this exact table. PDF extraction (officeparser)
 * and, more rarely, the model's own output can both introduce a stray NUL.
 * Strips it (and other C0 control characters that aren't legitimate
 * whitespace) from every string, at every depth, in place before anything
 * gets near Supabase.
 */
const POSTGRES_UNSAFE_CONTROL_CHARS = new RegExp("[" + "\x00-\x08\x0B\x0C\x0E-\x1F" + "]", "g");

export function sanitizeForPostgres<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(POSTGRES_UNSAFE_CONTROL_CHARS, "") as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForPostgres(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeForPostgres(val);
    }
    return out as unknown as T;
  }
  return value;
}

/** Formats any thrown value into a plain string message, never leaking `[object Object]`. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Strips Markdown code-fence wrapping the model sometimes adds despite
 * explicit instructions not to (the "```json ... ```" trap) — handles a
 * fence anywhere in the string, not just at the very start/end, since the
 * model occasionally prefixes a sentence before the fenced block too.
 */
function stripMarkdownFences(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();
  return raw.trim();
}

/** Parses the model's raw output into a plain object, with a clear error on malformed/truncated JSON. */
export function parseJsonResponse(raw: string): Record<string, unknown> {
  const cleaned = stripMarkdownFences(sanitizeForPostgres(raw));
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    console.error("[course-generation] JSON.parse failed:", error, "\nRaw output (first 1000 chars):", raw.slice(0, 1000));
    throw new Error("L'IA a renvoyé un JSON invalide ou tronqué (limite de tokens atteinte). Réessaie.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("L'IA n'a pas renvoyé un objet JSON à la racine.");
  }

  return parsed as Record<string, unknown>;
}

export type Section = "explication" | "resume" | "cas_clinique" | "qcms" | "mind_map" | "exemples_analogies";

/**
 * Cosine similarity floor for "Silent Semantic Deduplication" (Smart Clone —
 * see generateCourseSection() below). Deliberately higher than the 0.88 chat
 * cache threshold: cloning a whole generated section is a much bigger bet
 * than reusing one Q&A answer, so this only fires when the source document
 * is near-identical (same course, different scan/export/professor
 * formatting), never merely "the same general topic".
 */
const SIMILAR_COURSE_THRESHOLD = 0.9;

/** One row of match_similar_courses_by_slug()'s result — see supabase/schema.sql. Every section column is cast to `text` in SQL regardless of the column's real storage type, so callers always JSON.parse() the "object" ones themselves. */
interface SimilarCourseRow {
  slug: string;
  similarity: number;
  explication: string | null;
  resume: string | null;
  cas_clinique: string | null;
  qcms: string | null;
  mind_map: string | null;
  exemples_analogies: string | null;
}

interface SectionConfig {
  dbColumn: string;
  systemPrompt: string;
  expectedType: "string" | "object";
  /** Per-section OpenRouter output budget — explication asks for 3000-8000 words of dense Markdown, which needs far more headroom than the structured JSON sections. */
  maxTokens: number;
}

const SECTION_CONFIG: Record<Section, SectionConfig> = {
  explication: { dbColumn: "explication", systemPrompt: EXPLICATION_SYSTEM_PROMPT, expectedType: "string", maxTokens: 32000 },
  // The DB column is literally named "resumé" (French accent) — the JSON
  // key from the model and the frontend type both stay ASCII "resume".
  resume: { dbColumn: "resumé", systemPrompt: RESUME_SYSTEM_PROMPT, expectedType: "object", maxTokens: 16000 },
  cas_clinique: { dbColumn: "cas_clinique", systemPrompt: CAS_CLINIQUE_SYSTEM_PROMPT, expectedType: "object", maxTokens: 16000 },
  qcms: { dbColumn: "qcms", systemPrompt: QCMS_SYSTEM_PROMPT, expectedType: "object", maxTokens: 16000 },
  mind_map: { dbColumn: "mind_map", systemPrompt: MIND_MAP_SYSTEM_PROMPT, expectedType: "object", maxTokens: 8000 },
  // Now targets the SAME exhaustiveness as explication (3000-7000+ words),
  // but in Darija — Arabic script tokenizes less efficiently per word than
  // French, so this needs AT LEAST as much headroom as explication's 32000,
  // not less.
  exemples_analogies: { dbColumn: "exemples_analogies", systemPrompt: EXEMPLES_ANALOGIES_SYSTEM_PROMPT, expectedType: "string", maxTokens: 32000 },
};

interface RawCourseRow {
  raw_text: string | null;
  [section: string]: unknown;
}

/**
 * The full modular-generation pipeline for ONE section of ONE course,
 * called by each of the 5 thin route wrappers. Every step is isolated so a
 * failure anywhere returns a precise, logged reason instead of a generic
 * "Impossible d'enregistrer ce cours":
 *   1. Fetch the row (source raw_text + current value of every section, so
 *      an already-generated section short-circuits with zero AI calls).
 *   2. Call OpenRouter with a system prompt that ONLY asks for this section.
 *   3. Strip Markdown fences, strip NUL bytes, JSON.parse in its own try/catch.
 *   4. Validate the parsed shape roughly matches what's expected.
 *   5. `update()` just this section's column, in its own try/catch, logging
 *      the exact Postgres code/message/details/hint on failure.
 */
export async function generateCourseSection(slug: string, section: Section): Promise<NextResponse> {
  const startedAt = Date.now();
  const config = SECTION_CONFIG[section];

  if (!slug || typeof slug !== "string") {
    return NextResponse.json({ success: false, error: "Le champ 'slug' est requis." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    console.error(`[generate/${section}] Supabase non configuré.`);
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  // Select ONLY raw_text + THIS section's own column — never the other 4
  // sections' columns. Reproduced live: the select used to unconditionally
  // list every section's column, so adding a 6th section (mind_map) whose
  // ALTER TABLE hadn't been run yet broke generation for ALL FIVE existing
  // sections on EVERY course with a single Postgres "column does not exist"
  // error, masked behind a misleading "Cours introuvable" 404. Scoping the
  // select to just the requested section's column makes that entire class
  // of bug structurally impossible going forward.
  // The DB column is named "resumé" (accent) — aliased to ASCII "resume" for
  // the same reason as app/api/courses/slug/[slug]/route.ts: supabase-js's
  // compile-time select-string parser can't statically parse the accent.
  const aliasedColumn = section === "resume" ? "resume:resumé" : config.dbColumn;
  const selectColumns = `raw_text, ${aliasedColumn}`;

  const { data: row, error: fetchError } = (await supabase
    .from("courses")
    .select(selectColumns)
    .eq("slug", slug)
    .maybeSingle()) as unknown as { data: RawCourseRow | null; error: unknown };

  if (fetchError || !row) {
    console.error(`[generate/${section}] Cours introuvable pour slug="${slug}":`, fetchError);
    return NextResponse.json({ success: false, error: "Cours introuvable pour ce slug." }, { status: 404 });
  }

  // Cache hit: already generated (or pre-authored, like gastrite) — no AI call.
  const existing = row[section];
  if (existing !== null && existing !== undefined) {
    console.log(`[generate/${section}] Cache hit — aucun appel IA.`);
    return NextResponse.json({ success: true, cached: true, section, data: existing });
  }

  // --- Silent Semantic Deduplication ("Smart Clone") ------------------------
  // Before paying for a real OpenRouter call, check whether another course —
  // any slug, any faculty, any professor's own phrasing/"كركاسة" — already
  // has near-identical raw_text (cosine similarity > 0.9, computed entirely
  // in Postgres from this row's content_embedding) AND already has THIS
  // exact section generated. If so, clone that value straight into this row:
  // same content, $0 OpenRouter cost, completely invisible to the student —
  // their row, their chat history, their QCM attempts stay fully independent;
  // only the generated payload itself is reused.
  //
  // Fails open by construction: this entire block is one try/catch, and
  // ANY failure (RPC error, malformed cloned JSON, save error) falls straight
  // through to the normal generation path below — a broken dedup check must
  // never block a student from getting their section, it should just degrade
  // to a normal (billed) generation, exactly like before this feature existed.
  try {
    const { data: similarCourses, error: matchError } = await supabase.rpc("match_similar_courses_by_slug", {
      p_slug: slug,
      match_threshold: SIMILAR_COURSE_THRESHOLD,
      match_count: 5,
    });

    if (matchError) {
      console.error(
        `[generate/${section}] Smart Clone — recherche de cours similaires échouée (fail-open, génération normale):`,
        matchError.message
      );
    } else {
      const candidates = (similarCourses ?? []) as SimilarCourseRow[];
      const master = candidates.find((candidate) => candidate[section] !== null && candidate[section] !== undefined);

      if (master) {
        const rawCloneValue = master[section] as string;
        const clonedValue = config.expectedType === "object" ? JSON.parse(rawCloneValue) : rawCloneValue;
        const sanitizedClone = sanitizeForPostgres(clonedValue);

        const { error: cloneUpdateError } = await supabase
          .from("courses")
          .update({ [config.dbColumn]: sanitizedClone })
          .eq("slug", slug);

        if (cloneUpdateError) {
          console.error(
            `[generate/${section}] Smart Clone — échec sauvegarde de la section clonée (fail-open, génération normale):`,
            cloneUpdateError.message
          );
        } else {
          console.log(
            `[generate/${section}] SMART CLONE — section clonée depuis slug="${master.slug}" (similarité ${master.similarity.toFixed(4)}) — 0$ appel OpenRouter.`
          );
          return NextResponse.json({ success: true, cached: false, cloned: true, section, data: sanitizedClone });
        }
      }
    }
  } catch (error) {
    console.error(`[generate/${section}] Smart Clone — exception inattendue (fail-open, génération normale):`, errorMessage(error));
  }

  const rawText = row.raw_text;
  if (!rawText || rawText.trim().length < 50) {
    console.error(`[generate/${section}] Pas de raw_text exploitable pour slug="${slug}".`);
    return NextResponse.json(
      { success: false, error: "Ce cours n'a pas de texte source exploitable pour générer ce contenu." },
      { status: 422 }
    );
  }

  const truncatedText = rawText.slice(0, MAX_SOURCE_CHARS);

  console.log(`[generate/${section}] Appel à OpenRouter (slug="${slug}")...`);
  let raw: string;
  try {
    const aiStartedAt = Date.now();
    raw = await callOpenRouter(
      [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: buildSourceTextUserMessage(truncatedText) },
      ],
      { maxTokens: config.maxTokens }
    );
    console.log(`[generate/${section}] Réponse IA reçue en ${Date.now() - aiStartedAt} ms, ${raw.length} caractères.`);
  } catch (error) {
    if (error instanceof OpenRouterError) {
      console.error(`[generate/${section}] Erreur OpenRouter (status ${error.status}):`, error.message);
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error(`[generate/${section}] Échec appel IA:`, error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }

  // --- Parsing dans son propre try/catch dédié --------------------------------
  let value: unknown;
  try {
    const parsed = parseJsonResponse(raw);
    value = parsed[section];
    if (value === undefined || value === null) {
      console.error(`[generate/${section}] Clé "${section}" absente de la réponse IA. Clés reçues:`, Object.keys(parsed));
      throw new Error(`La réponse de l'IA ne contient pas la clé "${section}".`);
    }
    if (config.expectedType === "string" && typeof value !== "string") {
      throw new Error(`La réponse de l'IA pour "${section}" devrait être une chaîne, reçu : ${typeof value}.`);
    }
    if (config.expectedType === "object" && (typeof value !== "object" || Array.isArray(value))) {
      throw new Error(`La réponse de l'IA pour "${section}" devrait être un objet, reçu : ${typeof value}.`);
    }
    if (config.expectedType === "string" && (value as string).trim().length < 50) {
      throw new Error(`La réponse de l'IA pour "${section}" est trop courte.`);
    }
  } catch (error) {
    console.error(`[generate/${section}] Validation/parsing échoué:`, error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }

  const sanitizedValue = sanitizeForPostgres(value);

  // --- Sauvegarde dans son propre try/catch isolé, logue massivement --------
  try {
    const { error: updateError } = await supabase
      .from("courses")
      .update({ [config.dbColumn]: sanitizedValue })
      .eq("slug", slug);

    if (updateError) {
      console.error(`[generate/${section}] ÉCHEC UPDATE SUPABASE — détail complet:`, {
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
        slug,
        dbColumn: config.dbColumn,
      });
      return NextResponse.json(
        {
          success: false,
          error: `Sauvegarde Supabase échouée [${updateError.code ?? "??"}] : ${updateError.message}`,
          supabase: {
            code: updateError.code,
            message: updateError.message,
            details: updateError.details,
            hint: updateError.hint,
          },
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error(`[generate/${section}] EXCEPTION NON GÉRÉE pendant l'update Supabase:`, error);
    return NextResponse.json(
      { success: false, error: `Exception pendant la sauvegarde Supabase : ${errorMessage(error)}` },
      { status: 500 }
    );
  }

  console.log(`[generate/${section}] Généré et sauvegardé en ${Date.now() - startedAt} ms (slug="${slug}").`);

  return NextResponse.json({ success: true, cached: false, section, data: sanitizedValue });
}
