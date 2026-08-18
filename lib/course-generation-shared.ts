import { NextResponse } from "next/server";
import { callOpenRouter, OpenRouterError, type ChatMessageInput, type ContentBlock } from "@/lib/ai/openrouter";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { buildSourceChunks } from "@/lib/search/source-chunking";
import { splitExplicationByChapter } from "@/lib/explication-sections";
import {
  buildExplicationDeltaChapterPrompt,
  buildExplicationWrapperPrompt,
  buildResumeContextInjectionAddendum,
  CAS_CLINIQUE_SYSTEM_PROMPT,
  EXEMPLES_ANALOGIES_SYSTEM_PROMPT,
  EXPLICATION_CHUNK_TAGGING_ADDENDUM,
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

/**
 * Server-side defensive strip for HTML content coming from a `contentEditable`
 * surface (see app/api/notes/route.ts — "Mes notes" saves `innerHTML`, which
 * can carry pasted `<script>`/event-handler attributes/`javascript:` URIs).
 * This is a coarse regex backstop, NOT a full sanitizer — the real, thorough
 * allowlist sanitization is `lib/highlight.ts`'s `sanitizeNoteHtml`, which
 * runs client-side before every save (it needs DOM APIs, unavailable here).
 * This function exists because a client can always bypass the browser and
 * POST/PUT directly to this route, so the server must not rely on the client
 * having sanitized anything — it strips the specific, genuinely dangerous
 * constructs (script/style execution, inline event handlers, javascript:
 * navigation) regardless of what the client already did.
 */
export function stripDangerousHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<(iframe|object|embed|link|meta|form)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, "");
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

/**
 * Coverage floor for the CHUNK-BASED Smart Clone check (see
 * findChunkBasedClone() below) — deliberately NOT 0.90 like
 * SIMILAR_COURSE_THRESHOLD above. The 0.90 bar is already enforced per
 * INDIVIDUAL chunk by match_similar_source_chunks() — every chunk counted as
 * "matched" is independently a near-exact match on its own. Requiring the
 * SAME strict bar again at the aggregate level would just re-impose the
 * whole-document dilution problem this check exists to avoid. 55% means
 * "more than half of this course's real paragraphs already exist
 * near-verbatim elsewhere" — high enough to exclude two courses that merely
 * share a boilerplate intro or a common definition, low enough to still
 * catch a professor's reordered/reformatted version of the same source.
 */
const MIN_CHUNK_COVERAGE = 0.55;

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
 * Builds the OpenRouter message array for ONE section call, with the source
 * text placed FIRST in the system message as its own `cache_control`
 * breakpoint — the section's own instructions come AFTER it, uncached.
 *
 * This ordering is deliberate, not arbitrary, and the reverse (instructions
 * first, source text second) would NOT give the same result: Anthropic's
 * prompt cache keys each breakpoint on the cumulative byte prefix UP TO AND
 * INCLUDING it. Putting the source text first means its own breakpoint's key
 * is just hash(sourceText) — identical across all 6 section calls for the
 * SAME course (explication, résumé, cas_clinique, qcms, mind_map,
 * exemples_analogies all read the exact same raw_text). A student who opens
 * several Studio tabs for one course within the cache TTL turns tabs 2-6
 * into a 90%-cheaper cache READ on this block instead of a full-price resend
 * of the whole source document — a saving that requires no other student on
 * the platform and no prior history, so it applies from this app's very
 * first course.
 *
 * The section instructions are deliberately left OUT of any cache_control:
 * putting them on a SECOND breakpoint after the source text would key that
 * breakpoint on hash(sourceText + instructions), which only ever repeats if
 * the exact same course requests the exact same section twice — impossible
 * here, since generateCourseSection() already short-circuits with a DB cache
 * hit before ever reaching this call — or if two courses share near-identical
 * source text, which Smart Clone (the match_similar_courses_by_slug check
 * above) already intercepts before this function runs. Marking a block
 * cache_control when it can structurally never be read back would just add
 * the 1.25x cache-write premium with zero chance of ever recovering it via a
 * 0.1x read, so it stays a plain, normally-priced block instead.
 */
function buildSectionMessages(systemPrompt: string, sourceText: string): ChatMessageInput[] {
  const sourceBlock: ContentBlock = {
    type: "text",
    text: `Voici le contenu brut extrait du document source :\n"""\n${sourceText}\n"""`,
    cache_control: { type: "ephemeral" },
  };
  const instructionsBlock: ContentBlock = { type: "text", text: systemPrompt };

  return [
    { role: "system", content: [sourceBlock, instructionsBlock] },
    { role: "user", content: "Génère le JSON demandé, strictement conforme au schéma et aux règles ci-dessus, à partir du contenu source fourni." },
  ];
}

/**
 * Normalizes a section column's value read via a PLAIN `.from("courses").select(...)`
 * call (as findChunkBasedClone below does) into the same shape the rest of
 * generateCourseSection expects: the parsed JS value (object) for
 * expectedType "object", the raw string for "string". Unlike
 * match_similar_courses_by_slug's rows (explicitly cast `::text` in SQL, so
 * always a string), a plain select can hand back either a string OR an
 * already-parsed object depending on whether the environment stores the
 * column as jsonb or text — blindly calling JSON.parse() on it, like the
 * whole-document path below safely can, would throw on a native jsonb value.
 */
function normalizeSectionValue(raw: unknown, expectedType: "string" | "object"): unknown {
  if (raw === null || raw === undefined) return null;
  if (expectedType === "string") {
    return typeof raw === "string" && raw.trim() ? raw : null;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

/**
 * Chunk-based Smart Clone — checked BEFORE the whole-document
 * (content_embedding) Smart Clone below. A single whole-document cosine
 * score can miss a real match: two courses whose actual medical content is
 * 90% identical but whose cover page, OCR artifacts, or section ordering
 * differ enough dilute that ONE score below the 0.90 threshold. This
 * compares the new course's raw text chunk-by-chunk instead (see
 * supabase/schema.sql's match_similar_source_chunks and
 * course_source_chunks, populated at upload time in
 * app/api/generate-course/route.ts) — a candidate qualifies once at least
 * MIN_CHUNK_COVERAGE of THIS course's chunks each individually cross the
 * same 0.90 cosine bar somewhere in that candidate's chunks, even if the two
 * documents as a whole would never have matched.
 *
 * Fails open exactly like the whole-document check: any error (missing
 * migration, RPC failure, a course with no indexed chunks yet) returns null
 * and generateCourseSection falls straight through to the whole-document
 * check, then to real generation — this can only ever make cloning MORE
 * likely to fire, never less, and never blocks a student's course.
 */
async function findChunkBasedClone(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  slug: string,
  section: Section,
  config: SectionConfig
): Promise<{ candidateSlug: string; coverage: number; value: unknown } | null> {
  const { data, error } = await supabase.rpc("match_similar_source_chunks", {
    p_slug: slug,
    match_threshold: SIMILAR_COURSE_THRESHOLD,
  });

  if (error || !data) return null;

  const candidates = data as { candidate_slug: string; matched_chunks: number; total_chunks: number }[];

  for (const candidate of candidates) {
    if (candidate.total_chunks === 0) continue;
    const coverage = candidate.matched_chunks / candidate.total_chunks;
    if (coverage < MIN_CHUNK_COVERAGE) continue;

    const rawKey = section === "resume" ? "resume" : config.dbColumn;
    const aliasedColumn = section === "resume" ? "resume:resumé" : config.dbColumn;
    const { data: candidateRow } = await supabase
      .from("courses")
      .select(aliasedColumn)
      .eq("slug", candidate.candidate_slug)
      .maybeSingle();

    const raw = (candidateRow as Record<string, unknown> | null)?.[rawKey];
    const value = normalizeSectionValue(raw, config.expectedType);
    if (value !== null) {
      return { candidateSlug: candidate.candidate_slug, coverage, value };
    }
    // This candidate doesn't have the section generated yet — try the next
    // one down the ranked list instead of giving up on chunk-based cloning
    // entirely for this call.
  }

  return null;
}

interface ExplicationChapterRow {
  chapter_index: number;
  heading: string;
  content: string;
  source_chunk_indices: number[];
}

interface AssembledChapter {
  heading: string;
  content: string;
  sourceChunkIndices: number[];
}

/** Parses a model's chapterChunks-style field (array of arrays of 1-indexed extrait numbers) into 0-indexed chunk_index arrays, tolerating malformed/missing entries rather than throwing. */
function parseChapterChunkNumbers(raw: unknown, fallback: number[]): number[] {
  if (!Array.isArray(raw)) return fallback;
  const numbers = raw.filter((n): n is number => typeof n === "number").map((n) => n - 1);
  return numbers.length > 0 ? numbers : fallback;
}

/**
 * Chunk-Based Delta Update for Explication ONLY (the highest-value target:
 * the single most expensive section, dominated by output tokens, and the
 * only one with a real chapter structure to slice). Tries each ranked
 * candidate (from match_similar_source_chunks) in turn until one yields at
 * least one reusable chapter; returns null (fail open) if none do, so the
 * caller falls through to full-fresh generation exactly as before this
 * feature existed.
 *
 * Per the executive decision: comparison happens at the PARAGRAPH-chunk
 * level (course_source_chunks, already built for the whole-section Smart
 * Clone), not on raw-text "chapter" headings — a raw PDF upload has no
 * reliable chapter markup before generation, chunk boundaries do.
 */
async function runExplicationDeltaPipeline(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  slug: string
): Promise<string | null> {
  const { data: candidatesData, error: candidatesError } = await supabase.rpc("match_similar_source_chunks", {
    p_slug: slug,
    match_threshold: SIMILAR_COURSE_THRESHOLD,
  });
  if (candidatesError || !candidatesData) return null;

  const candidates = candidatesData as { candidate_slug: string; matched_chunks: number; total_chunks: number }[];

  for (const candidate of candidates) {
    if (candidate.matched_chunks === 0) continue;

    const { data: candidateChapters, error: chaptersError } = await supabase
      .from("course_explication_chapters")
      .select("chapter_index, heading, content, source_chunk_indices")
      .eq("course_slug", candidate.candidate_slug)
      .order("chapter_index", { ascending: true });

    if (chaptersError || !candidateChapters || candidateChapters.length === 0) continue; // no chapter map on this candidate — try the next one

    const { data: detailedMatches, error: detailError } = await supabase.rpc("match_chunks_against_course", {
      p_slug: slug,
      p_candidate_slug: candidate.candidate_slug,
      match_threshold: SIMILAR_COURSE_THRESHOLD,
    });
    if (detailError || !detailedMatches) continue;

    const matchRows = detailedMatches as { target_chunk_index: number; candidate_chunk_index: number; similarity: number }[];
    const matchedCandidateChunkIndices = new Set(matchRows.map((r) => r.candidate_chunk_index));
    const matchedTargetChunkIndices = new Set(matchRows.map((r) => r.target_chunk_index));

    const chapterRows = candidateChapters as unknown as ExplicationChapterRow[];
    const reusableChapters: AssembledChapter[] = chapterRows
      .filter((ch) => ch.source_chunk_indices.some((idx) => matchedCandidateChunkIndices.has(idx)))
      .map((ch) => ({ heading: ch.heading, content: ch.content, sourceChunkIndices: ch.source_chunk_indices }));

    if (reusableChapters.length === 0) continue; // nothing usable from this candidate — try the next

    const { data: targetChunksData } = await supabase
      .from("course_source_chunks")
      .select("chunk_index")
      .eq("course_slug", slug)
      .order("chunk_index", { ascending: true });
    const targetChunkIndices = ((targetChunksData ?? []) as { chunk_index: number }[]).map((r) => r.chunk_index);
    const unmatchedChunkIndices = targetChunkIndices.filter((idx) => !matchedTargetChunkIndices.has(idx));

    let newChapters: AssembledChapter[] = [];

    if (unmatchedChunkIndices.length > 0) {
      const { data: unmatchedChunkRows } = await supabase
        .from("course_source_chunks")
        .select("chunk_index, content")
        .eq("course_slug", slug)
        .in("chunk_index", unmatchedChunkIndices)
        .order("chunk_index", { ascending: true });

      const unmatchedText = ((unmatchedChunkRows ?? []) as { chunk_index: number; content: string }[])
        .map((r) => `Extrait ${r.chunk_index + 1}:\n${r.content}`)
        .join("\n\n");

      const deltaPrompt = buildExplicationDeltaChapterPrompt(
        reusableChapters.map((ch) => ch.heading),
        reusableChapters.length + 1
      );

      const rawDelta = await callOpenRouter(
        [
          { role: "system", content: deltaPrompt },
          { role: "user", content: `Voici le contenu nouveau/modifié :\n"""\n${unmatchedText}\n"""\n\nGénère le JSON demandé.` },
        ],
        { maxTokens: 8000, bypassMock: true }
      );

      const parsedDelta = parseJsonResponse(rawDelta);
      const newChaptersMarkdown = typeof parsedDelta.newChapters === "string" ? parsedDelta.newChapters : "";
      const chapterChunksRaw = Array.isArray(parsedDelta.chapterChunks) ? parsedDelta.chapterChunks : [];

      newChapters = splitExplicationByChapter(newChaptersMarkdown).map((section, i) => ({
        heading: section.headingText,
        content: section.content,
        sourceChunkIndices: parseChapterChunkNumbers(chapterChunksRaw[i], unmatchedChunkIndices),
      }));
    }

    // Assemble final chapter order: sort reused + new by the minimum chunk
    // index each covers — an approximation of the original document's
    // order, not a guarantee, but a reasonable one since chunks themselves
    // are already in source order.
    const allChapters = [...reusableChapters, ...newChapters].sort((a, b) => {
      const aMin = a.sourceChunkIndices.length ? Math.min(...a.sourceChunkIndices) : Number.MAX_SAFE_INTEGER;
      const bMin = b.sourceChunkIndices.length ? Math.min(...b.sourceChunkIndices) : Number.MAX_SAFE_INTEGER;
      return aMin - bMin;
    });

    // The wrapper (intro/Sommaire/Avant-propos/Récapitulatif) is regenerated
    // every time — a real, disclosed cost, small relative to the chapters
    // it saved from being regenerated.
    const wrapperPrompt = buildExplicationWrapperPrompt(allChapters.map((ch) => ch.heading));
    const rawWrapper = await callOpenRouter(
      [
        { role: "system", content: wrapperPrompt },
        { role: "user", content: "Génère le JSON demandé." },
      ],
      { maxTokens: 4000, bypassMock: true }
    );
    const parsedWrapper = parseJsonResponse(rawWrapper);
    const intro = typeof parsedWrapper.intro === "string" ? parsedWrapper.intro : "";
    const sommaire = typeof parsedWrapper.sommaire === "string" ? parsedWrapper.sommaire : "";
    const avantPropos = typeof parsedWrapper.avantPropos === "string" ? parsedWrapper.avantPropos : "";
    const recapitulatif = typeof parsedWrapper.recapitulatif === "string" ? parsedWrapper.recapitulatif : "";

    const assembledMarkdown = [intro, sommaire, avantPropos, ...allChapters.map((ch) => ch.content), recapitulatif]
      .filter(Boolean)
      .join("\n\n");

    // Persist THIS course's own chapter map (re-numbered/re-ordered) so it
    // can serve as a future candidate for the next similar upload too.
    const chapterRowsToInsert = allChapters.map((ch, i) => ({
      course_slug: slug,
      chapter_index: i,
      heading: ch.heading,
      content: ch.content,
      source_chunk_indices: ch.sourceChunkIndices,
    }));
    if (chapterRowsToInsert.length > 0) {
      const { error: chapterSaveError } = await supabase
        .from("course_explication_chapters")
        .upsert(chapterRowsToInsert, { onConflict: "course_slug,chapter_index" });
      if (chapterSaveError) {
        console.error("[generate/explication] Échec sauvegarde de la carte de chapitres (non bloquant):", chapterSaveError.message);
      }
    }

    console.log(
      `[generate/explication] DELTA UPDATE depuis slug="${candidate.candidate_slug}" — ${reusableChapters.length}/${allChapters.length} chapitre(s) réutilisé(s), ${newChapters.length} régénéré(s).`
    );

    return assembledMarkdown;
  }

  return null;
}

/**
 * Full-fresh Explication generation WITH chapter/chunk tagging — used the
 * first time a topic is generated (no delta candidate exists yet) so that
 * FUTURE similar uploads have something to delta against. The only
 * difference from a plain generation: source text is sent as numbered
 * extraits instead of one block, and the model is asked for an extra
 * "explicationChapterChunks" field mapping each chapter to which extraits
 * informed it — see EXPLICATION_CHUNK_TAGGING_ADDENDUM.
 */
async function runExplicationFreshGenerationWithTagging(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  slug: string,
  truncatedText: string
): Promise<string> {
  const chunks = buildSourceChunks(truncatedText);
  const numberedExtraits = chunks.map((content, i) => `Extrait ${i + 1}:\n${content}`).join("\n\n");

  const raw = await callOpenRouter(
    [
      { role: "system", content: EXPLICATION_SYSTEM_PROMPT + EXPLICATION_CHUNK_TAGGING_ADDENDUM },
      {
        role: "user",
        content: `Voici le contenu source, découpé en extraits numérotés :\n"""\n${numberedExtraits}\n"""\n\nGénère le JSON demandé.`,
      },
    ],
    { maxTokens: SECTION_CONFIG.explication.maxTokens }
  );

  const parsed = parseJsonResponse(raw);
  const explicationMarkdown = typeof parsed.explication === "string" ? parsed.explication : "";
  if (!explicationMarkdown.trim()) {
    throw new Error("La réponse de l'IA ne contient pas de champ 'explication' exploitable.");
  }

  const chapterChunksRaw = Array.isArray(parsed.explicationChapterChunks) ? parsed.explicationChapterChunks : [];
  const sections = splitExplicationByChapter(explicationMarkdown);

  const chapterRows = sections.map((section, i) => ({
    course_slug: slug,
    chapter_index: i,
    heading: section.headingText,
    content: section.content,
    source_chunk_indices: parseChapterChunkNumbers(chapterChunksRaw[i], []),
  }));

  if (chapterRows.length > 0) {
    const { error } = await supabase
      .from("course_explication_chapters")
      .upsert(chapterRows, { onConflict: "course_slug,chapter_index" });
    if (error) {
      console.error("[generate/explication] Échec sauvegarde des chapitres taggés (non bloquant):", error.message);
    }
  }

  return explicationMarkdown;
}

/**
 * Résumé's "Context-Injection" — finds a similar course's already-generated
 * Résumé (same ranked-candidate RPC as the delta pipeline above, but no
 * coverage gate: even a partial match is useful as a factual reference) to
 * inject as a [GROUND TRUTH] the model must use for FACTS only, never copy
 * structurally. Returns null (fail open) if none found — the caller then
 * generates Résumé exactly as before this feature existed.
 */
async function findBaseResumeForInjection(supabase: ReturnType<typeof getSupabaseAdmin>, slug: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("match_similar_source_chunks", {
    p_slug: slug,
    match_threshold: SIMILAR_COURSE_THRESHOLD,
  });
  if (error || !data) return null;

  const candidates = data as { candidate_slug: string; matched_chunks: number; total_chunks: number }[];
  for (const candidate of candidates) {
    if (candidate.matched_chunks === 0) continue;
    const { data: candidateRow } = await supabase
      .from("courses")
      .select("resume:resumé")
      .eq("slug", candidate.candidate_slug)
      .maybeSingle();
    const raw = (candidateRow as Record<string, unknown> | null)?.resume;
    if (raw !== null && raw !== undefined) {
      return typeof raw === "string" ? raw : JSON.stringify(raw);
    }
  }
  return null;
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

  // --- Chunk-based Smart Clone (checked FIRST) -------------------------------
  // See findChunkBasedClone()'s own doc comment for why this runs before the
  // whole-document check below: it catches real matches the whole-document
  // score dilutes away. Same fail-open contract as the block below — any
  // error here just falls through, first to the whole-document check, then
  // to real generation.
  try {
    const chunkClone = await findChunkBasedClone(supabase, slug, section, config);
    if (chunkClone) {
      const sanitizedClone = sanitizeForPostgres(chunkClone.value);
      const { error: cloneUpdateError } = await supabase
        .from("courses")
        .update({ [config.dbColumn]: sanitizedClone })
        .eq("slug", slug);

      if (cloneUpdateError) {
        console.error(
          `[generate/${section}] Smart Clone (chunks) — échec sauvegarde de la section clonée (fail-open, poursuite):`,
          cloneUpdateError.message
        );
      } else {
        console.log(
          `[generate/${section}] SMART CLONE (CHUNK-BASED) — section clonée depuis slug="${chunkClone.candidateSlug}" (couverture ${(chunkClone.coverage * 100).toFixed(1)}%) — 0$ appel OpenRouter.`
        );
        return NextResponse.json({ success: true, cached: false, cloned: true, cloneMethod: "chunks", section, data: sanitizedClone });
      }
    }
  } catch (error) {
    console.error(`[generate/${section}] Smart Clone (chunks) — exception inattendue (fail-open, poursuite):`, errorMessage(error));
  }

  // --- Silent Semantic Deduplication ("Smart Clone", whole-document) --------
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

  // --- Explication: Chunk-Based Delta Update, tried first, fully self-contained ---
  // Either returns early (delta reuse or tagged-fresh-generation succeeded)
  // or falls straight through to the plain generic path below, completely
  // unchanged, on ANY failure — same fail-open contract as every Smart
  // Clone check above.
  if (section === "explication") {
    try {
      const delta = await runExplicationDeltaPipeline(supabase, slug);
      const explicationMarkdown = delta ?? (await runExplicationFreshGenerationWithTagging(supabase, slug, truncatedText));

      if (explicationMarkdown && explicationMarkdown.trim().length >= 50) {
        const sanitizedValue = sanitizeForPostgres(explicationMarkdown);
        const { error: updateError } = await supabase.from("courses").update({ explication: sanitizedValue }).eq("slug", slug);

        if (!updateError) {
          console.log(`[generate/explication] Généré via pipeline delta/tagging en ${Date.now() - startedAt} ms (slug="${slug}").`);
          return NextResponse.json({ success: true, cached: false, section, data: sanitizedValue });
        }
        console.error(
          `[generate/explication] Échec sauvegarde après pipeline delta/tagging (fail-open, bascule génération classique):`,
          updateError.message
        );
      }
    } catch (error) {
      console.error(
        `[generate/explication] Pipeline delta/tagging échoué (fail-open, bascule génération classique):`,
        errorMessage(error)
      );
    }
    // Nothing above returned — fall through to the exact plain path below.
  }

  // --- Résumé: Context-Injection — augments the system prompt only, the
  // generic call/parse/save flow right below stays identical either way. ---
  let effectiveSystemPrompt = config.systemPrompt;
  if (section === "resume") {
    try {
      const baseResume = await findBaseResumeForInjection(supabase, slug);
      if (baseResume) {
        effectiveSystemPrompt = config.systemPrompt + buildResumeContextInjectionAddendum(baseResume);
        console.log(`[generate/resume] Context-Injection activée depuis un cours similaire (slug="${slug}").`);
      }
    } catch (error) {
      console.error(`[generate/resume] Context-Injection échouée (fail-open, génération classique):`, errorMessage(error));
    }
  }

  console.log(`[generate/${section}] Appel à OpenRouter (slug="${slug}")...`);
  let raw: string;
  try {
    const aiStartedAt = Date.now();
    raw = await callOpenRouter(buildSectionMessages(effectiveSystemPrompt, truncatedText), { maxTokens: config.maxTokens });
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
