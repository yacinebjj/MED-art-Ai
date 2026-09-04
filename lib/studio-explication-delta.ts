/**
 * Cross-University Chunk Caching for studio_courses' Explication — the
 * studio_courses port of lib/course-generation-shared.ts's
 * runExplicationDeltaPipeline (built for the legacy `courses` pipeline).
 * See supabase/schema.sql's own header comment on this feature block for
 * the full design rationale (why 0.90 per-chunk with no aggregate-coverage
 * gate, why this is Explication-only, the safety invariant on how reused
 * content can ever reach a student).
 *
 * Scoped to Explication only, deliberately — the SAME reasoning already
 * established this session for why "local extraction" can't work for Cas
 * Clinique/QCM applies here too: those are synthesized content (a fabricated
 * patient vignette, novel exam questions with distractors), not a
 * restructuring of source paragraphs, so there is no meaningful
 * "chapter reused verbatim, only the different part regenerated" operation
 * for them. Explication is uniquely suited to this because it IS a fairly
 * direct exposition of the source material, chapter by chapter.
 *
 * Fails open at every step, by construction: any missing prerequisite,
 * Supabase error, or RPC failure returns `null`, and the caller
 * (app/api/studio/generate/route.ts) falls straight through to a normal,
 * full-price Explication generation — exactly the same contract as every
 * other cache/clone layer already in this codebase.
 *
 * MODEL POLICY (definitive product decision): every OpenRouter call in this
 * file — the delta-chapter/wrapper calls below AND
 * runStudioExplicationFreshGenerationWithTagging — runs on ECONOMY_MODEL
 * (google/gemini-3.7-flash) with `reasoning: { effort: "low" }` set
 * explicitly. There is no Sonnet fallback anywhere in the Explication
 * pipeline; the delta-chapter/wrapper calls used to omit `model` entirely
 * (silently defaulting to callOpenRouter's own global Sonnet MODEL) — that
 * default is no longer relied on here.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getEmbedding } from "@/lib/ai/embeddings";
import { callOpenRouter, ECONOMY_MODEL } from "@/lib/ai/openrouter";
import { parseJsonResponse, VALID_JSON_ESCAPE_TARGETS, CONTROL_CHAR_ESCAPES } from "@/lib/course-generation-shared";
import { buildSourceChunks } from "@/lib/search/source-chunking";
import { splitExplicationByChapter } from "@/lib/explication-sections";
import { buildExplicationDeltaChapterPrompt, buildExplicationWrapperPrompt } from "@/lib/prompts/public-course-sections";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Lowered from 0.90 to 0.85 by explicit product decision, AFTER inspecting
 * real content at this exact boundary: a live Blida/Alger test measured its
 * highest real chunk-pair similarity at 0.8946 (a classification of elbow
 * dislocation types — "Luxations en Dehors" / "LUXATION DIVERGENTE" /
 * "LUXATION ISOLÉE", MONTEGGIA, pronation douloureuse de BROCA), and reading
 * both texts side by side showed genuinely near-verbatim phrasing — a
 * standardized medical classification, not university-specific protocol.
 *
 * IMPORTANT — this is evidence from ONE pair, not a platform-wide guarantee:
 * 0.85-0.90 is not proven safe for every topic, only observed safe for this
 * one. Standardized classifications/eponyms (this case) are the kind of
 * content most likely to still be safe at 0.85; a topic with more genuine
 * inter-institution variation in emphasis or protocol could plausibly reach
 * 0.85-0.90 similarity while actually differing in a way that matters
 * academically. studio_cross_university_reuse_log records every reuse this
 * threshold approves — treat it as a required, ongoing audit trail now, not
 * an optional nicety, and revisit this constant if a logged reuse is ever
 * found to have merged genuinely different content.
 */
const CHUNK_MATCH_THRESHOLD = 0.85;

interface ChapterRow {
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

function parseChapterChunkNumbers(raw: unknown, fallback: number[]): number[] {
  if (!Array.isArray(raw)) return fallback;
  const numbers = raw.filter((n): n is number => typeof n === "number").map((n) => n - 1);
  return numbers.length > 0 ? numbers : fallback;
}

/** Lazily chunks+embeds this course's raw_text into studio_course_chunks — only once, on the first Explication attempt (mirrors app/api/search/route.ts's self-healing indexing). No-op if already indexed. Fail-open: an error here just means this course can't be matched against (yet), never blocks generation. */
async function ensureStudioCourseChunked(
  supabase: SupabaseAdmin,
  courseId: number,
  rawText: string,
  universityTag: string | null
): Promise<void> {
  const { count, error: countError } = await supabase
    .from("studio_course_chunks")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId);

  if (countError) {
    console.error("[studio-explication-delta] Échec vérification indexation (non bloquant):", countError.message);
    return;
  }
  if ((count ?? 0) > 0) return;

  const chunks = buildSourceChunks(rawText);
  if (chunks.length === 0) return;

  const embeddings = await Promise.all(chunks.map((chunk) => getEmbedding(chunk)));
  const rows = chunks.map((content, i) => ({
    course_id: courseId,
    chunk_index: i,
    content,
    embedding: embeddings[i],
    university_tag: universityTag,
  }));

  const { error: insertError } = await supabase
    .from("studio_course_chunks")
    .upsert(rows, { onConflict: "course_id,chunk_index" });
  if (insertError) {
    console.error("[studio-explication-delta] Échec sauvegarde chunks (non bloquant):", insertError.message);
  }
}

/** Best-effort audit row per reused chapter — see studio_cross_university_reuse_log's own comment in supabase/schema.sql. Never blocks the pipeline on failure. */
async function logCrossUniversityReuse(
  supabase: SupabaseAdmin,
  targetCourseId: number,
  candidateCourseId: number,
  targetUniversity: string | null,
  reusableChapters: AssembledChapter[],
  similarityByCandidateChunk: Map<number, number>
): Promise<void> {
  try {
    const { data: candidateOwner } = await supabase
      .from("studio_courses")
      .select("user_id")
      .eq("id", candidateCourseId)
      .maybeSingle<{ user_id: string }>();

    let sourceUniversity: string | null = null;
    if (candidateOwner) {
      const { data: candidateProfile } = await supabase
        .from("profiles")
        .select("university")
        .eq("id", candidateOwner.user_id)
        .maybeSingle<{ university: string | null }>();
      sourceUniversity = candidateProfile?.university ?? null;
    }

    const rows = reusableChapters.map((ch) => {
      const similarities = ch.sourceChunkIndices
        .filter((idx) => similarityByCandidateChunk.has(idx))
        .map((idx) => similarityByCandidateChunk.get(idx)!);
      return {
        target_course_id: targetCourseId,
        source_course_id: candidateCourseId,
        target_university: targetUniversity,
        source_university: sourceUniversity,
        chapter_heading: ch.heading,
        similarity: similarities.length > 0 ? Math.max(...similarities) : CHUNK_MATCH_THRESHOLD,
      };
    });

    const { error } = await supabase.from("studio_cross_university_reuse_log").insert(rows);
    if (error) console.error("[studio-explication-delta] Échec écriture audit (non bloquant):", error.message);
  } catch (error) {
    console.error("[studio-explication-delta] Échec écriture audit — exception (non bloquant):", error instanceof Error ? error.message : error);
  }
}

/**
 * Standalone entry point for indexing a studio_courses row into
 * studio_course_chunks RIGHT AWAY, at upload time — called from
 * app/api/studio/courses/route.ts's POST, fire-and-forget, so the chat's
 * question-specific RAG retrieval (lib/chat-context-retrieval.ts) has real
 * chunks to rank from the student's very first message.
 *
 * Before this existed, studio_course_chunks was ONLY ever populated lazily,
 * inside runStudioExplicationDeltaPipeline below — which only runs when the
 * student generates the Studio "Explication" tab AND that generation misses
 * the whole-document cache. A student going straight from upload to Chat
 * (a completely normal, arguably more common path than opening Explication
 * first) hit an unindexed course on every single message, so
 * retrieveRelevantContext always returned `null` and the chat fell back to
 * sending the full raw_text (up to CHAT_MAX_CONTEXT_CHARS = 100_000 chars,
 * ~25-30k tokens) on every message — this was the dominant real driver of
 * the "~$0.04/message" cost report, not a caching bug per se.
 *
 * Deliberately does NOT run the cross-university candidate search or
 * opt-out check below — those exist for Explication reuse specifically;
 * indexing for chat retrieval should happen unconditionally, regardless of
 * a module's cross-university sharing setting. Fails open exactly like
 * every other layer here: errors are logged, never thrown, so a failed
 * background index never affects the upload response the student already
 * received.
 */
export async function indexStudioCourseChunksForChat(courseId: number, rawText: string, userId: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("university")
      .eq("id", userId)
      .maybeSingle<{ university: string | null }>();
    await ensureStudioCourseChunked(supabase, courseId, rawText, profileRow?.university ?? null);
  } catch (error) {
    console.error("[studio-explication-delta] Échec indexation post-upload (non bloquant):", error instanceof Error ? error.message : error);
  }
}

/**
 * Attempts a cross-university, chunk-level delta generation of this
 * course's Explication. Returns the assembled Markdown on success, or
 * `null` on any missing prerequisite / failure (fail-open — caller falls
 * through to a normal full generation).
 */
export async function runStudioExplicationDeltaPipeline(
  courseId: number,
  rawText: string,
  userId: string
): Promise<string | null> {
  const supabase = getSupabaseAdmin();

  // Resolves curriculum_module_id from the course row itself — the route
  // only has courseId, and this keeps that call site simple. Also doubles
  // as an existence check: no row (or no module id on it) fails open below.
  const { data: courseRow, error: courseError } = await supabase
    .from("studio_courses")
    .select("curriculum_module_id")
    .eq("id", courseId)
    .maybeSingle<{ curriculum_module_id: number | null }>();
  if (courseError || !courseRow?.curriculum_module_id) {
    if (courseError) console.error("[studio-explication-delta] Échec lecture module du cours (fail-open):", courseError.message);
    return null;
  }

  // Opt-out gate — checked FIRST, before spending anything (even an
  // embedding call) on this module's behalf.
  const { data: moduleRow, error: moduleError } = await supabase
    .from("curriculum_modules")
    .select("cross_university_sharing_enabled")
    .eq("id", courseRow.curriculum_module_id)
    .maybeSingle<{ cross_university_sharing_enabled: boolean }>();
  if (moduleError) {
    console.error("[studio-explication-delta] Échec lecture opt-out module (fail-open):", moduleError.message);
    return null;
  }
  if (moduleRow?.cross_university_sharing_enabled === false) {
    console.log(`[studio-explication-delta] course_id=${courseId} — module ${courseRow.curriculum_module_id} a désactivé le partage cross-université (opt-out).`);
    return null;
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("university")
    .eq("id", userId)
    .maybeSingle<{ university: string | null }>();
  const universityTag = profileRow?.university ?? null;

  try {
    await ensureStudioCourseChunked(supabase, courseId, rawText, universityTag);
  } catch (error) {
    console.error("[studio-explication-delta] Échec indexation (fail-open):", error instanceof Error ? error.message : error);
    return null;
  }

  console.log(`[studio-explication-delta] course_id=${courseId} (université="${universityTag ?? "non renseignée"}") — recherche de candidats cross-université (seuil ${CHUNK_MATCH_THRESHOLD})...`);

  const { data: candidatesData, error: candidatesError } = await supabase.rpc("match_similar_studio_chunks", {
    p_course_id: courseId,
    match_threshold: CHUNK_MATCH_THRESHOLD,
  });
  if (candidatesError || !candidatesData) {
    if (candidatesError) console.error("[studio-explication-delta] Échec RPC match_similar_studio_chunks (fail-open):", candidatesError.message);
    return null;
  }

  const candidates = candidatesData as { candidate_course_id: number; matched_chunks: number; total_chunks: number }[];
  console.log(
    `[studio-explication-delta] course_id=${courseId} — ${candidates.length} candidat(s) trouvé(s) avec au moins 1 chunk ≥ ${CHUNK_MATCH_THRESHOLD}` +
      (candidates.length > 0
        ? `: ${candidates.map((c) => `course_id=${c.candidate_course_id} (${c.matched_chunks}/${c.total_chunks})`).join(", ")}`
        : " — aucun, génération complète classique.")
  );

  for (const candidate of candidates) {
    if (candidate.matched_chunks === 0) continue;

    const { data: candidateChapters, error: chaptersError } = await supabase
      .from("studio_course_explication_chapters")
      .select("chapter_index, heading, content, source_chunk_indices")
      .eq("course_id", candidate.candidate_course_id)
      .order("chapter_index", { ascending: true });
    if (chaptersError || !candidateChapters || candidateChapters.length === 0) continue; // no chapter map yet — try the next candidate

    const { data: detailedMatches, error: detailError } = await supabase.rpc("match_studio_chunks_against_course", {
      p_course_id: courseId,
      p_candidate_course_id: candidate.candidate_course_id,
      match_threshold: CHUNK_MATCH_THRESHOLD,
    });
    if (detailError || !detailedMatches) continue;

    const matchRows = detailedMatches as { target_chunk_index: number; candidate_chunk_index: number; similarity: number }[];
    const matchedCandidateChunkIndices = new Set(matchRows.map((r) => r.candidate_chunk_index));
    const similarityByCandidateChunk = new Map(matchRows.map((r) => [r.candidate_chunk_index, r.similarity]));

    // Candidate-chunk-index -> target-chunk-index(es) translation. THIS is
    // the fix for a real bug found in production (mixed-up sentence order,
    // occasionally missing content, on real cross-university Explication
    // reuse — e.g. Blida/Alger): a reused chapter's `source_chunk_indices`
    // is stored in the CANDIDATE course's own chunk-numbering space (e.g.
    // Alger's), which has NO relationship to the target course's (e.g.
    // Blida's) chunk numbering — two independent documents, independently
    // chunked. Sorting/covering by those raw candidate-space numbers as if
    // they were the target's own was comparing apples to oranges. This map
    // (from match_studio_chunks_against_course's own per-pair rows, already
    // fetched above) is the real, already-available translation table.
    const candidateToTargetIndices = new Map<number, number[]>();
    for (const row of matchRows) {
      const existing = candidateToTargetIndices.get(row.candidate_chunk_index);
      if (existing) existing.push(row.target_chunk_index);
      else candidateToTargetIndices.set(row.candidate_chunk_index, [row.target_chunk_index]);
    }

    const chapterRows = candidateChapters as unknown as ChapterRow[];
    const reusableChapters: AssembledChapter[] = chapterRows
      .filter((ch) => ch.source_chunk_indices.some((idx) => matchedCandidateChunkIndices.has(idx)))
      .map((ch) => ({
        heading: ch.heading,
        content: ch.content,
        // Translated into the TARGET course's own chunk-index space — never
        // the raw candidate indices past this point. This is what both the
        // sort below and the coverage check just after it now rely on.
        sourceChunkIndices: ch.source_chunk_indices.flatMap((idx) => candidateToTargetIndices.get(idx) ?? []),
      }))
      // A chapter whose translation came back empty contributes no real,
      // locatable coverage in the target document — treat it as not
      // reused rather than let it silently claim a "position" it doesn't
      // have (defensive; the outer .filter above means this shouldn't fire
      // in practice, since it already required at least one matched index).
      .filter((ch) => ch.sourceChunkIndices.length > 0);

    if (reusableChapters.length === 0) continue; // nothing usable from this candidate — try the next

    void logCrossUniversityReuse(supabase, courseId, candidate.candidate_course_id, universityTag, reusableChapters, similarityByCandidateChunk);

    const { data: targetChunksData } = await supabase
      .from("studio_course_chunks")
      .select("chunk_index")
      .eq("course_id", courseId)
      .order("chunk_index", { ascending: true });
    const targetChunkIndices = ((targetChunksData ?? []) as { chunk_index: number }[]).map((r) => r.chunk_index);

    // COVERAGE, not raw similarity matching — the second real bug this
    // fixes. Previously, a target chunk was excluded from fresh generation
    // merely because it similarity-matched SOME candidate chunk, even if
    // that candidate chunk wasn't actually attributed to any of the
    // candidate's own chapters (e.g. it was part of the candidate's wrapper,
    // or simply never chapter-tagged). That content then appeared in
    // NEITHER a reused chapter NOR a freshly-generated one — a silent gap,
    // read by a student as an incomplete/thin explanation. Now a target
    // chunk only counts as handled if it's actually PULLED INTO a reused
    // chapter's (correctly translated) sourceChunkIndices.
    const coveredTargetChunkIndices = new Set(reusableChapters.flatMap((ch) => ch.sourceChunkIndices));
    const unmatchedChunkIndices = targetChunkIndices.filter((idx) => !coveredTargetChunkIndices.has(idx));

    let newChapters: AssembledChapter[] = [];

    if (unmatchedChunkIndices.length > 0) {
      const { data: unmatchedChunkRows } = await supabase
        .from("studio_course_chunks")
        .select("chunk_index, content")
        .eq("course_id", courseId)
        .in("chunk_index", unmatchedChunkIndices)
        .order("chunk_index", { ascending: true });

      const unmatchedText = ((unmatchedChunkRows ?? []) as { chunk_index: number; content: string }[])
        .map((r) => `Extrait ${r.chunk_index + 1}:\n${r.content}`)
        .join("\n\n");

      const deltaPrompt = buildExplicationDeltaChapterPrompt(
        reusableChapters.map((ch) => ch.heading),
        reusableChapters.length + 1
      );

      // 16384 (was 8000) — a long course with many unmatched chunks can
      // genuinely need more room for the new-chapters delta than 8000
      // tokens allowed, which was truncating the JSON mid-structure on
      // exactly the "cours longs" case reported in production. Model
      // explicit (was defaulting to callOpenRouter's global Sonnet MODEL) —
      // see this file's own header comment: every Studio Explication path,
      // no exception, now runs on ECONOMY_MODEL with the matching
      // reasoning cap.
      const rawDelta = await callOpenRouter(
        [
          { role: "system", content: deltaPrompt },
          { role: "user", content: `Voici le contenu nouveau/modifié :\n"""\n${unmatchedText}\n"""\n\nGénère le JSON demandé.` },
        ],
        { model: ECONOMY_MODEL, maxTokens: 16384, bypassMock: true, reasoning: { effort: "low" } }
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

    const allChapters = [...reusableChapters, ...newChapters].sort((a, b) => {
      const aMin = a.sourceChunkIndices.length ? Math.min(...a.sourceChunkIndices) : Number.MAX_SAFE_INTEGER;
      const bMin = b.sourceChunkIndices.length ? Math.min(...b.sourceChunkIndices) : Number.MAX_SAFE_INTEGER;
      return aMin - bMin;
    });

    // The wrapper (intro/Sommaire/Avant-propos/Récapitulatif) is ALWAYS
    // regenerated fresh, for every course — never reused across courses,
    // let alone across universities. This is a real, disclosed cost, and
    // also a deliberate safety property: the narrative framing a student
    // reads is always genuinely their own course's, never borrowed.
    const wrapperPrompt = buildExplicationWrapperPrompt(allChapters.map((ch) => ch.heading));
    const rawWrapper = await callOpenRouter(
      [
        { role: "system", content: wrapperPrompt },
        { role: "user", content: "Génère le JSON demandé." },
      ],
      { model: ECONOMY_MODEL, maxTokens: 4000, bypassMock: true, reasoning: { effort: "low" } }
    );
    const parsedWrapper = parseJsonResponse(rawWrapper);
    const intro = typeof parsedWrapper.intro === "string" ? parsedWrapper.intro : "";
    const sommaire = typeof parsedWrapper.sommaire === "string" ? parsedWrapper.sommaire : "";
    const avantPropos = typeof parsedWrapper.avantPropos === "string" ? parsedWrapper.avantPropos : "";
    const recapitulatif = typeof parsedWrapper.recapitulatif === "string" ? parsedWrapper.recapitulatif : "";

    const assembledMarkdown = [intro, sommaire, avantPropos, ...allChapters.map((ch) => ch.content), recapitulatif]
      .filter(Boolean)
      .join("\n\n");

    // Persist THIS course's own chapter map so it can serve as a future
    // candidate (from any university) for the next similar upload too.
    const chapterRowsToInsert = allChapters.map((ch, i) => ({
      course_id: courseId,
      chapter_index: i,
      heading: ch.heading,
      content: ch.content,
      source_chunk_indices: ch.sourceChunkIndices,
    }));
    if (chapterRowsToInsert.length > 0) {
      const { error: chapterSaveError } = await supabase
        .from("studio_course_explication_chapters")
        .upsert(chapterRowsToInsert, { onConflict: "course_id,chapter_index" });
      if (chapterSaveError) {
        console.error("[studio-explication-delta] Échec sauvegarde de la carte de chapitres (non bloquant):", chapterSaveError.message);
      }
    }

    console.log(
      `[studio-explication-delta] DELTA CROSS-UNIVERSITY depuis course_id=${candidate.candidate_course_id} — ${reusableChapters.length}/${allChapters.length} chapitre(s) réutilisé(s), ${newChapters.length} régénéré(s).`
    );

    return assembledMarkdown;
  }

  return null;
}

/**
 * Full-fresh Explication generation WITH chapter/chunk tagging — used the
 * first time a course has no delta candidate. Mirrors
 * runExplicationFreshGenerationWithTagging in lib/course-generation-shared.ts
 * exactly, adapted to studio_course_chunks/studio_course_explication_chapters.
 * Persists this course's OWN chapter map so future uploads (any university)
 * can delta against it.
 */
/**
 * Escapes a span KNOWN to sit entirely inside one JSON string value — its
 * true start/end already located STRUCTURALLY by recoverExplicationOnly
 * below (via the surrounding, known key names), never by counting quotes
 * within this span itself. Unlike fixInvalidJsonEscapes, this NEVER toggles
 * in/out of "string mode" on a bare `"` — there is no legitimate string
 * boundary inside this span at all, so every raw `"` here is content (the
 * model quoting a term with a straight quote instead of the instructed
 * French guillemets — confirmed real production failure, e.g. `la protéine
 * "flippase"`), never JSON structure, and must always be escaped rather
 * than mistaken for a closing quote. This is exactly the failure
 * fixInvalidJsonEscapes' own toggle-based scan cannot recover from: once an
 * unescaped content quote flips its `inString` state, every character after
 * it (including a real trailing bracket-diagram newline, a real trailing
 * backslash, anything) is scanned in the wrong mode for the rest of the
 * document.
 */
function escapeKnownStringBody(text: string): string {
  let result = "";
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      const next = text[i + 1];
      if (next !== undefined && VALID_JSON_ESCAPE_TARGETS.has(next)) {
        result += ch;
        escaped = true;
      } else {
        result += "\\\\";
      }
      continue;
    }
    if (ch < " ") {
      result += CONTROL_CHAR_ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
      continue;
    }
    if (ch === '"') {
      result += '\\"'; // ALWAYS escape — this span never legitimately closes here.
      continue;
    }
    result += ch;
  }
  return result;
}

const EXPLICATION_KEY_RE = /"explication"\s*:\s*"/;
// Anchors on the ONLY other key this response ever has — its presence pins
// down exactly where the explication string's closing quote sits,
// regardless of any unescaped quote/backslash/control character earlier in
// the body. Global + "last match wins" below: nothing legitimate can ever
// follow "explicationChapterChunks" except its own value and the closing
// brace, so the LAST occurrence of this exact key pattern in the remaining
// text is always the real one, even in the astronomically unlikely case
// the explication prose itself mentions this key name.
const NEXT_KEY_RE = /"\s*,\s*"explicationChapterChunks"/g;

/**
 * Last-resort recovery for a genuinely broken/truncated JSON response from
 * runStudioExplicationFreshGenerationWithTagging specifically: "explication"
 * is the FIRST key the model writes, "explicationChapterChunks" (a
 * disposable cache-optimization hint — see this function's own header
 * comment on why a wrong/missing value there is harmless) is the SECOND and
 * LAST. Confirmed live (real production failures, then reproduced — TWO
 * distinct root causes so far): when the combined explication+chunk-tagging
 * response hits a JSON defect — token ceiling, an escaping quirk, an
 * unescaped content quote, anything — while writing that disposable SECOND
 * field, the actual lesson content the student is waiting on is very often
 * already complete and sitting right there in the raw text, just
 * unreachable via a normal JSON.parse because the OVERALL document never
 * closed cleanly.
 *
 * Locates the explication string's body STRUCTURALLY (via EXPLICATION_KEY_RE
 * / NEXT_KEY_RE above) rather than by counting quotes character-by-character
 * within it — the previous quote-counting implementation (a `(?:\\.|[^"\\])*`
 * regex) silently mis-recovered, or outright failed to recover, the instant
 * the model's prose contained EVEN ONE unescaped straight quote used as
 * ordinary punctuation (e.g. quoting a technical term) anywhere before the
 * true end: that regex necessarily stops at the FIRST unescaped `"` it
 * meets, mistaking real content for the closing quote — a real, reproduced
 * production failure distinct from (and not fixed by) the invalid-escape-
 * target / raw-control-character cases fixInvalidJsonEscapes already
 * handles. Anchoring on the surrounding known key names instead sidesteps
 * this entirely: the true boundary comes from JSON structure that's
 * external to the body, never from characters inside a body we don't yet
 * trust.
 *
 * Two shapes, in order:
 *  1. ANCHORED — "explicationChapterChunks" is found somewhere after
 *     "explication"'s opening quote: the body is everything between them,
 *     regardless of what it contains (unescaped quotes, raw newlines,
 *     invalid escape targets — escapeKnownStringBody above fixes all three
 *     in one pass, unconditionally, since we already know this whole span
 *     is content).
 *  2. UNCLOSED-TO-END — the second key was never written at all (the
 *     response was cut off before ever reaching it, e.g. genuine token-
 *     ceiling truncation while still writing "explication" itself, the far
 *     more common shape for a very long response): the body is everything
 *     from the opening quote to the end of the raw text. A dangling,
 *     unescaped trailing backslash (truncated mid-escape-sequence) is
 *     dropped before decoding — appending a bare `"` after a lone `\` would
 *     be read as an ESCAPED quote, not a closing one, and break the decode.
 *
 * Neither shape ever fabricates content or silently serves a suspiciously
 * short fragment — both are rejected by the same 50-char floor
 * StudioTextSchema itself enforces. If recovery still fails, this returns
 * null and the caller's original error surfaces exactly as it did before
 * this recovery path existed.
 */
function recoverExplicationOnly(raw: string): string | null {
  const startMatch = raw.match(EXPLICATION_KEY_RE);
  if (!startMatch) return null;
  const bodyStart = (startMatch.index ?? 0) + startMatch[0].length;
  const rest = raw.slice(bodyStart);

  let nextKeyMatch: RegExpExecArray | null = null;
  for (const m of rest.matchAll(NEXT_KEY_RE)) nextKeyMatch = m;

  let body: string;
  const isUnclosedToEnd = nextKeyMatch === null;
  if (nextKeyMatch) {
    body = rest.slice(0, nextKeyMatch.index);
  } else {
    body = rest;
  }

  if (isUnclosedToEnd) {
    let trailingBackslashes = 0;
    while (body.endsWith("\\".repeat(trailingBackslashes + 1))) trailingBackslashes++;
    if (trailingBackslashes % 2 === 1) body = body.slice(0, -1); // dangling half of an escape sequence — drop it, nothing valid to preserve.
  }

  const decoded = tryDecodeJsonString(escapeKnownStringBody(body));
  if (decoded && decoded.trim().length >= 50) return decoded;

  return null;
}

/** `JSON.parse('"' + escaped + '"')` without throwing — returns null on any decode failure instead. */
function tryDecodeJsonString(escaped: string): string | null {
  try {
    return JSON.parse(`"${escaped}"`) as string;
  } catch {
    return null;
  }
}

export async function runStudioExplicationFreshGenerationWithTagging(
  courseId: number,
  truncatedText: string,
  explicationSystemPrompt: string,
  explicationChunkTaggingAddendum: string,
  maxTokens: number
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const chunks = buildSourceChunks(truncatedText);
  const numberedExtraits = chunks.map((content, i) => `Extrait ${i + 1}:\n${content}`).join("\n\n");

  // ECONOMY_MODEL (Gemini 3.7 Flash) — swapped from the implicit Sonnet
  // default after a real side-by-side test against this exact prompt
  // (explicationSystemPrompt, i.e. STUDIO_EXPLICATION_SYSTEM_PROMPT): equal
  // or greater word count, full medical accuracy, and (after two targeted
  // prompt fixes — a strict-tutoiement surcharge and a no-LaTeX-in-JSON
  // rule) a clean register match and zero JSON-escaping failures, at ~76%
  // lower cost per call. The `explicationChapterChunks` tagging field this
  // call additionally requests (via explicationChunkTaggingAddendum) was
  // NOT part of that test — turned out to be the real gap: a real
  // production failure showed this SECOND field can occasionally push a
  // combined response into a JSON defect (token ceiling, an escaping
  // quirk) that fails the WHOLE parse, discarding an explication that was
  // often already complete. recoverExplicationOnly (below) now recovers
  // that case specifically — the tagging metadata is still genuinely
  // disposable (parseChapterChunkNumbers's `?? []` fallback), but a broken
  // JSON around it is no longer allowed to take the explicationMarkdown down
  // with it. The cross-university delta-chapter/wrapper calls above use
  // different, untested prompts but now run on this SAME model+reasoning
  // policy too — see this file's own header comment.
  // reasoning: { effort: "low" } — confirmed production root cause of
  // truncated/invalid JSON on long courses: OpenRouter's hidden reasoning
  // tokens are NOT a separate budget from the visible completion on
  // google/gemini-3.7-flash (see callOpenRouter's own doc comment and
  // app/api/studio/generate/route.ts's identical fix) — uncapped, they can
  // silently consume most of `maxTokens` before a single character of the
  // actual explication is written, no matter how generous the ceiling is.
  const raw = await callOpenRouter(
    [
      { role: "system", content: explicationSystemPrompt + explicationChunkTaggingAddendum },
      {
        role: "user",
        content: `Voici le contenu source, découpé en extraits numérotés :\n"""\n${numberedExtraits}\n"""\n\nGénère le JSON demandé.`,
      },
    ],
    { model: ECONOMY_MODEL, maxTokens, bypassMock: true, reasoning: { effort: "low" } }
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonResponse(raw);
  } catch (error) {
    const recovered = recoverExplicationOnly(raw);
    if (!recovered) throw error;
    console.warn(
      "[studio-explication-delta] JSON global invalide/tronqué, mais 'explication' récupérée isolément (chunk-tagging perdu pour cette génération, non bloquant pour l'étudiant):",
      error instanceof Error ? error.message : error
    );
    parsed = { explication: recovered, explicationChapterChunks: [] };
  }
  const explicationMarkdown = typeof parsed.explication === "string" ? parsed.explication : "";
  if (!explicationMarkdown.trim()) {
    throw new Error("La réponse de l'IA ne contient pas de champ 'explication' exploitable.");
  }

  const chapterChunksRaw = Array.isArray(parsed.explicationChapterChunks) ? parsed.explicationChapterChunks : [];
  const sections = splitExplicationByChapter(explicationMarkdown);

  const chapterRows = sections.map((section, i) => ({
    course_id: courseId,
    chapter_index: i,
    heading: section.headingText,
    content: section.content,
    source_chunk_indices: parseChapterChunkNumbers(chapterChunksRaw[i], []),
  }));
  if (chapterRows.length > 0) {
    const { error: chapterSaveError } = await supabase
      .from("studio_course_explication_chapters")
      .upsert(chapterRows, { onConflict: "course_id,chapter_index" });
    if (chapterSaveError) {
      console.error("[studio-explication-delta] Échec sauvegarde de la carte de chapitres (fraîche, non bloquant):", chapterSaveError.message);
    }
  }

  return explicationMarkdown;
}
