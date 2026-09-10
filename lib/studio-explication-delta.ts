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
 * MODEL POLICY: every OpenRouter call in this file — the delta-chapter/
 * wrapper calls below, and generateExplicationPart — runs on CHEAP_MODEL
 * (deepseek/deepseek-v3.2) with `reasoning: { effort: "low" }` (added after a
 * real production truncation bug: DeepSeek V3.2 is a hidden-reasoning model,
 * same category as ECONOMY_MODEL, and an uncapped reasoning effort silently
 * burns most of `maxTokens` on invisible "thinking" before writing a single
 * visible character — see CHEAP_MODEL's own comment in lib/ai/openrouter.ts).
 * There is no Sonnet fallback anywhere in the Explication pipeline; the
 * delta-chapter/wrapper calls used to omit `model` entirely (silently
 * defaulting to callOpenRouter's own global Sonnet MODEL) — that default is
 * not relied on here.
 *
 * ARCHITECTURE (rewritten after a real production incident — repeated
 * "échec de génération" 3-4 times in a row, then a truncated result even on
 * success): a full Explication used to be ONE (or, for long sources, several
 * sequential) huge, in-process OpenRouter call(s) inside a single HTTP
 * request/serverless invocation. Vercel enforces its OWN real function
 * duration ceiling — as low as 10-60s depending on plan/Fluid Compute
 * settings — REGARDLESS of this app's own `maxDuration` config, so a
 * multi-minute generation (routine for "ultra-détaillée" output) risked
 * being killed mid-flight with no clean error and no partial credit, and a
 * failure anywhere in a multi-slice loop discarded every already-completed
 * (already-paid-for) slice. Generation is now driven from the BROWSER
 * (lib/studio-explication-client.ts): the full source is deterministically
 * sliced (computeExplicationSlices), and each slice is its own short,
 * independently bounded, independently retryable HTTP request
 * (generateExplicationPart, called from
 * app/api/studio/generate/explication-part/route.ts) — a completed part is
 * held client-side and never re-generated on a later part's failure. See
 * that route's own header comment for the full request/response contract.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getEmbedding } from "@/lib/ai/embeddings";
import { callOpenRouter, CHEAP_MODEL } from "@/lib/ai/openrouter";
import { parseJsonResponse, MAX_SOURCE_CHARS, VALID_JSON_ESCAPE_TARGETS, CONTROL_CHAR_ESCAPES } from "@/lib/course-generation-shared";
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
      // no exception, now runs on CHEAP_MODEL. reasoning: { effort: "low" }
      // — same hidden-reasoning-token truncation fix as the fresh-generation
      // call below in this file, same DeepSeek V3.2 risk.
      const rawDelta = await callOpenRouter(
        [
          { role: "system", content: deltaPrompt },
          { role: "user", content: `Voici le contenu nouveau/modifié :\n"""\n${unmatchedText}\n"""\n\nGénère le JSON demandé.` },
        ],
        { model: CHEAP_MODEL, maxTokens: 16384, bypassMock: true, reasoning: { effort: "low" } }
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
      { model: CHEAP_MODEL, maxTokens: 4000, bypassMock: true, reasoning: { effort: "low" } }
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
 *  2. UNCLOSED-TO-END — the second key was never written at all: the body is
 *     everything from the opening quote to the end of the raw text. A
 *     dangling, unescaped trailing backslash (truncated mid-escape-sequence)
 *     is dropped before decoding — appending a bare `"` after a lone `\`
 *     would be read as an ESCAPED quote, not a closing one, and break the
 *     decode.
 *
 *     IMPORTANT INVARIANT, since callOpenRouter's own finish_reason check
 *     (lib/ai/openrouter.ts) was added: this function is only ever reached
 *     with a COMPLETE response now (genuine token-ceiling truncation —
 *     finish_reason "length" — is caught and thrown as a clean, retryable
 *     error before generateExplicationPart ever sees it). This
 *     UNCLOSED-TO-END shape should therefore now be rare, caused only by a
 *     genuine JSON-formatting defect near the very end of an otherwise
 *     complete response, not by real truncation — do NOT reintroduce
 *     tolerance for actual truncation here; fix it at the source
 *     (callOpenRouter / EXPLICATION_PART_MAX_TOKENS) instead.
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

// buildSourceChunks (lib/search/source-chunking.ts) caps itself at 25 chunks
// of ~2,200 chars each (≈55,000 chars) — feeding it more than that silently
// DROPS the excess rather than chunking it, so a slice size must stay safely
// under that ceiling for every slice to be fully covered by its own call.
//
// LOWERED AGAIN, 15,000 -> 10,000, after a THIRD real, confirmed production
// incident: "flux terminé sans résultat après 281s" — the heartbeat stream
// ended cleanly with zero result line ever written, meaning the whole
// function was killed before its own catch/finally could run. A live
// diagnostic (app/api/diagsleep2, deployed with this route's EXACT
// maxDuration=280, deleted after use) proved this platform enforces that
// ceiling with real precision, not a fuzzy/early kill: a 277s sleep
// completed cleanly, a 285s sleep failed with a clean
// FUNCTION_INVOCATION_TIMEOUT at 280.88s. So the 281s production failure
// WAS a genuine platform kill, and EXPLICATION_PART_TIMEOUT_MS's old 20s
// margin below maxDuration (260s abort vs. 280s kill) was not enough to
// reliably absorb the DB read + slicing + large-response JSON
// parsing/recovery overhead that also happens inside this same budget,
// on top of the OpenRouter call itself. Shrinking the slice further
// directly shrinks how much output a single part can ever legitimately
// need — reducing how often generation time comes anywhere near either
// timeout at all — a course with many chapters is now split into more,
// smaller, individually far more reliable parts rather than fewer, larger,
// riskier ones (the same principle the earlier 50,000 -> 30,000 -> 15,000
// cuts already established). 10,000/2,200 ≈ 5 chunks, comfortably under
// buildSourceChunks' 25-chunk ceiling, with real room to spare.
// LOWERED AGAIN, 10,000 -> 6,000. Slice size is the real driver of how long
// a single part actually generates for (more source to cover = more output
// tokens = more seconds), so this — not the timeout constant — is the lever
// that keeps each individual call far away from the platform wall. A 6,000-
// char slice expands to roughly 5,000-9,000 output tokens of exhaustive
// explanation, i.e. ~60-180s at real throughput, comfortably inside
// EXPLICATION_PART_TIMEOUT_MS. The trade is more parts per course (each its
// own short, independently-retryable HTTP request, already how this pipeline
// works — see lib/studio-explication-client.ts) rather than fewer, longer,
// riskier ones. Total wall-clock rises slightly; the odds any single part
// dies at the wall drop sharply.
const CHUNKED_SLICE_CHARS = 6_000;

/**
 * Safe per-part token ceiling for the client-driven, multi-request
 * Explication pipeline (app/api/studio/generate/explication-part/route.ts —
 * see that route's own header comment for the full architecture).
 *
 * HISTORY — a real, repeated production incident this exact constant caused:
 * two prior rounds of "fix the 504" assumed Vercel's REAL enforced duration
 * ceiling for this project was tight (as low as 10-60s, a documented
 * possibility on some plans/Fluid-Compute configurations) and calibrated
 * EXPLICATION_PART_TIMEOUT_MS/EXPLICATION_PART_MAX_TOKENS defensively around
 * that guess, WITHOUT ever actually measuring it. The guess was wrong: a
 * throwaway diagnostic route (an awaited sleep, no AI call, no side effects,
 * deployed and deleted the same session) empirically confirmed this
 * project's real ceiling comfortably exceeds 250 SECONDS. The 504 the
 * student kept hitting "every single time" was never a platform kill at
 * all — it was THIS code's own EXPLICATION_PART_TIMEOUT_MS (formerly 50s)
 * aborting the OpenRouter call before a genuinely large "ultra-détaillée"
 * generation could finish, which apparently needed more than 50s essentially
 * every time. Lesson encoded here, not just in a commit message: NEVER
 * recalibrate a timeout against an assumed platform ceiling again without
 * measuring it first — see app/api/diagsleep (deleted after use) for the
 * pattern to repeat if this ever needs re-verifying on a different Vercel
 * project/plan.
 *
 * RAISED AGAIN, 20,000 -> 32,000, after a second real, confirmed production
 * incident: a student's Explication came out genuinely INCOMPLETE — stopped
 * mid-content, not a clean error. Root cause, confirmed by direct code
 * inspection (see lib/ai/openrouter.ts's callOpenRouter, now fixed to check
 * `finish_reason`): this constant's own PREVIOUS justification — "well above
 * real historical usage (completion_tokens landing around 9,700-10,000 for a
 * FULL document under the old, pre-chunking architecture)" — was internally
 * inconsistent with this codebase's OWN history: the Explication system
 * prompt explicitly demands unbounded, exhaustive length ("vise largement
 * plus de 8000 mots, sans plafond réel — plus long et plus détaillé est
 * toujours strictement préférable"), and that SAME mandate, on a FULL
 * document under the old architecture, required maxTokens raised to 65,536
 * elsewhere (see lib/ai/studio-prompts.ts) — over 3x what a single slice was
 * budgeted here. Whenever a slice's genuinely-exhaustive output exceeded
 * 20,000 tokens, the response was cut off mid-string by the model provider,
 * and — until the finish_reason fix above — this was NEVER detected: the
 * cut-off JSON failed to parse, recoverExplicationOnly below salvaged
 * whatever partial "explication" text existed, and it was accepted as a
 * complete, successful part with only a trivial 50-character floor. 32,000
 * (paired with CHUNKED_SLICE_CHARS lowered 50,000 -> 30,000 above, so each
 * slice now needs meaningfully less exhaustive output to begin with) is a
 * deliberately conservative middle ground: real headroom above the old
 * ceiling without reaching for the full 65,536 a much larger, whole-document
 * prompt needed, since a single 30,000-char slice's own content is
 * proportionally smaller. If truncation is ever still observed in production
 * logs (search for "OpenRouter response truncated by max_tokens ceiling"),
 * that is now a LOUD, honest, retryable error (not a silent corruption) —
 * treat a recurrence as a signal to raise this further or shrink
 * CHUNKED_SLICE_CHARS again, not to re-add tolerance for it.
 */
// LOWERED 32,000 -> 14,000, alongside CHUNKED_SLICE_CHARS 10,000 -> 6,000.
// 32,000 tokens was never physically generatable inside this route's budget:
// at DeepSeek V3.2's real throughput (roughly 50-100 tok/s) a 32k-token
// completion needs 320-640 SECONDS, against a 280s Vercel wall. The ceiling
// was authorizing an output that could only ever end in a platform kill.
// This is the OUTPUT-side half of "no single call approaches the ceiling":
// CHUNKED_SLICE_CHARS bounds how much a part is ASKED to cover (and so how
// long it actually generates for), while this bounds the worst case. 14,000
// stays comfortably above what a 6,000-char slice genuinely needs (so
// finish_reason "length" truncation stays rare) while capping the worst case
// at ~140-280s — and with callOpenRouter's timeout now correctly covering
// the body phase, an overrun finally fails CLEANLY and retryably instead of
// silently killing the invocation.
const EXPLICATION_PART_MAX_TOKENS = 14_000;

/**
 * Hard abort for a single part's OpenRouter call. LOWERED 260s -> 200s after
 * a real, confirmed production failure this exact margin caused: "flux
 * terminé sans résultat après 281s" — a platform FUNCTION_INVOCATION_TIMEOUT
 * kill (confirmed via a live diagnostic, see CHUNKED_SLICE_CHARS' own
 * comment for the precise measurements: maxDuration=280 is enforced with
 * real precision, not fuzzily), meaning this call's own abort either fired
 * too close to the wall to let the route's catch/finally flush a result
 * line in time, or the surrounding overhead (DB read, slicing, large-
 * response JSON parsing/recovery) that ALSO runs inside the same
 * maxDuration=280 budget ate further into what used to be a 20s margin.
 * 200s leaves a real 80s margin under maxDuration=280 for everything else
 * this route does outside the OpenRouter call itself — still a real,
 * necessary safety net (a genuinely stuck call still fails CLEANLY and
 * retryably instead of the whole function being killed with no response at
 * all), just with enough slack this time to actually survive being that
 * safety net. If this specific "flux terminé sans résultat" shape is ever
 * observed again in production, that is direct evidence 200s is STILL not
 * enough margin — lower it further (and/or shrink CHUNKED_SLICE_CHARS
 * again) rather than raising it back toward the wall.
 */
const EXPLICATION_PART_TIMEOUT_MS = 200_000;

/**
 * Deterministic slice plan for a course's full source text — same slicing
 * this file has always used for oversized documents, now applied
 * UNCONDITIONALLY (every Explication generation is "N parts", even N=1) so a
 * short course's still-potentially-long "ultra-détaillée" output gets the
 * exact same per-request safety margin as a genuinely long one. Pure
 * function of `fullSourceText` — callable independently, by partIndex
 * 0..N-1, across separate HTTP requests, without needing to persist or
 * re-send the plan itself (each request just recomputes it from the same
 * raw_text and gets the same answer).
 */
// How far back from the ideal CHUNKED_SLICE_CHARS boundary this searches for
// a natural break (paragraph, then line, then sentence) before giving up and
// cutting mid-sentence anyway — small relative to CHUNKED_SLICE_CHARS so a
// slice is never meaningfully shorter than intended just to find a boundary.
const BOUNDARY_SEARCH_WINDOW_CHARS = 2000;

/**
 * Finds the best real break point at or before `idealEnd` — a paragraph
 * break first, then a line break, then a sentence end, searched for within
 * BOUNDARY_SEARCH_WINDOW_CHARS of the ideal cut point. Falls back to a hard
 * cut at `idealEnd` only if none exists in that window (rare — a genuinely
 * enormous unbroken block of text).
 *
 * REAL BUG this fixes, found from a real production report: computeExplicationSlices
 * used to cut every slice at a raw, arbitrary character offset with zero
 * regard for where a sentence, paragraph, or chapter actually ended — the
 * SAME source chapter could easily straddle two slices, one ending mid-word
 * or mid-sentence. Combined with generateExplicationPart's own per-part
 * isolation (each part is generated with NO knowledge of what the previous
 * part wrote — see that function's own comment on `previousPartTail`), a
 * part starting on a fragment like "...la stimulation du" had no way to
 * know it was continuing an already-started chapter, and would often either
 * restart the topic with a fresh heading or lose the thread entirely —
 * exactly the reported "chapters get mixed up, the topic changes
 * completely" symptom. This alone does not fully fix that (see
 * `previousPartTail` for the other half), but it removes the single biggest
 * source of genuinely ambiguous, badly-bounded input the model was ever
 * asked to make sense of.
 */
function findSliceBoundary(text: string, idealEnd: number, searchWindowChars: number = BOUNDARY_SEARCH_WINDOW_CHARS): number {
  if (idealEnd >= text.length) return text.length;
  const windowStart = Math.max(0, idealEnd - searchWindowChars);
  const window = text.slice(windowStart, idealEnd);
  const paragraphBreak = window.lastIndexOf("\n\n");
  if (paragraphBreak !== -1) return windowStart + paragraphBreak + 2;
  const lineBreak = window.lastIndexOf("\n");
  if (lineBreak !== -1) return windowStart + lineBreak + 1;
  const sentenceBreak = window.lastIndexOf(". ");
  if (sentenceBreak !== -1) return windowStart + sentenceBreak + 2;
  return idealEnd;
}

/**
 * Splits ONE already-computed slice into `count` smaller, boundary-aware
 * pieces — the escalation path for a part that proved too slow to generate
 * inside its time budget (see lib/studio-explication-client.ts: on a 504
 * timeout the client stops re-requesting the identical doomed slice and
 * asks for its halves, then quarters, instead).
 *
 * Reuses findSliceBoundary so a sub-slice still ends on a real paragraph/
 * line/sentence break rather than mid-word, with a window scaled DOWN to the
 * sub-target (a fixed 2,000-char backward search against a e.g. 3,000-char
 * target could otherwise drag a boundary so far back that the pieces come
 * out wildly uneven, defeating the point of splitting at all).
 *
 * Pure function of (slice, count) — the server recomputes it per request
 * from the same raw_text + partIndex, so nothing about the split has to be
 * persisted or round-tripped.
 */
export function splitSliceIntoSubSlices(slice: string, count: number): string[] {
  if (count <= 1 || slice.length === 0) return [slice];

  const target = Math.ceil(slice.length / count);
  const searchWindow = Math.max(200, Math.min(BOUNDARY_SEARCH_WINDOW_CHARS, Math.floor(target / 4)));
  const out: string[] = [];
  let start = 0;

  // count - 1 boundary-aware cuts, then whatever remains is the last piece —
  // guarantees exactly `count` pieces at most and never an empty/backwards one.
  while (start < slice.length && out.length < count - 1) {
    const idealEnd = Math.min(start + target, slice.length);
    const end = findSliceBoundary(slice, idealEnd, searchWindow);
    const safeEnd = end > start ? end : idealEnd;
    out.push(slice.slice(start, safeEnd));
    start = safeEnd;
  }
  if (start < slice.length) out.push(slice.slice(start));

  const nonEmpty = out.filter((piece) => piece.length > 0);
  return nonEmpty.length > 0 ? nonEmpty : [slice];
}

export function computeExplicationSlices(fullSourceText: string): string[] {
  const slices: string[] = [];
  let start = 0;
  while (start < fullSourceText.length) {
    const idealEnd = Math.min(start + CHUNKED_SLICE_CHARS, fullSourceText.length);
    const end = findSliceBoundary(fullSourceText, idealEnd);
    const safeEnd = end > start ? end : idealEnd; // never an empty/backwards slice
    slices.push(fullSourceText.slice(start, safeEnd));
    start = safeEnd;
  }
  return slices.length > 0 ? slices : [""];
}

/**
 * Generates ONE part's Explication markdown — the unit of work for
 * app/api/studio/generate/explication-part/route.ts. Replaces the old,
 * retired runStudioExplicationChunkedGeneration/
 * runStudioExplicationFreshGenerationWithTagging's in-process loop/single-call:
 * the sequencing now lives in the BROWSER
 * (lib/studio-explication-client.ts), one bounded HTTP request per part,
 * each independently retryable on failure — see EXPLICATION_PART_TIMEOUT_MS's
 * comment for why this is what actually fixes the reported truncation/
 * repeated-failure bug, not just a cosmetic reorganization.
 *
 * No DB writes here — chapter persistence happens once, after every part is
 * collected client-side (see persistExplicationChapters below), called from
 * app/api/studio/generate/explication-finalize/route.ts. Deliberately does
 * NOT request/produce Cross-University Chunk-tagging metadata
 * (`explicationChapterChunks`) — a disclosed trade-off: a course generated
 * through this pipeline never itself becomes a reuse CANDIDATE for a future
 * student (source_chunk_indices stays empty — see persistExplicationChapters),
 * while it can still BENEFIT from runStudioExplicationDeltaPipeline matching
 * against an older, already-tagged candidate. That metadata was always a
 * reuse optimization, not a functional requirement, and threading it through
 * a multi-part, multi-request generation would add real complexity for a
 * secondary benefit — not worth it against the reliability this rewrite
 * exists for.
 */
// How much of the PREVIOUS part's own generated markdown is shown to the
// next part as continuity context — see generateExplicationPart's
// `previousPartTail` param for why this exists. Long enough to reliably
// include the last heading and a few sentences of real content (so the
// model can judge "is the source below continuing THIS chapter or starting
// a new one"), short and cheap enough to add negligible cost/latency next
// to a part whose own budget is EXPLICATION_PART_MAX_TOKENS.
const PREVIOUS_PART_TAIL_CHARS = 800;

/**
 * Cheap, dependency-free trim to PREVIOUS_PART_TAIL_CHARS ending on a real
 * word boundary — used so the continuity excerpt shown to the next part
 * never starts mid-word, which would read as noise rather than genuine
 * context.
 */
function tailForContinuity(markdown: string): string {
  if (markdown.length <= PREVIOUS_PART_TAIL_CHARS) return markdown;
  const raw = markdown.slice(-PREVIOUS_PART_TAIL_CHARS);
  const firstSpace = raw.indexOf(" ");
  return firstSpace === -1 ? raw : raw.slice(firstSpace + 1);
}

export async function generateExplicationPart(
  slice: string,
  explicationSystemPrompt: string,
  partNumber: number,
  totalParts: number,
  // REAL FIX for a real, reported production bug: "chapters get mixed up,
  // the topic changes completely" between parts. Root cause — each part was
  // generated in complete isolation: the model writing part N had ZERO
  // knowledge of what part N-1 actually wrote, only the raw source text for
  // ITS OWN slice. Since a chapter routinely straddles a slice boundary
  // (computeExplicationSlices' own boundary-finding reduces but can't fully
  // eliminate this), the model starting part N had no way to tell "the
  // source I'm given continues a chapter already half-written" from "this
  // is a fresh topic" — it would often restart with a new heading mid-
  // chapter, or lose the thread entirely once the opening sentence was cut
  // off mid-word. Passing the tail of what the PREVIOUS part actually wrote
  // (not the source text — the model's OWN prior output) lets it judge that
  // correctly and continue seamlessly instead of guessing.
  previousPartTail?: string
): Promise<string> {
  const chunks = buildSourceChunks(slice);
  const numberedExtraits = chunks.map((content, j) => `Extrait ${j + 1}:\n${content}`).join("\n\n");
  const continuityInstruction = previousPartTail
    ? `\n\nCONTEXTE DE CONTINUITÉ — voici comment se terminait la partie précédente (${partNumber - 1}/${totalParts}), déjà écrite et déjà montrée à l'étudiant, pour que tu juges correctement si le contenu source ci-dessous continue le MÊME chapitre ou en commence un nouveau :\n"""\n[...] ${tailForContinuity(previousPartTail)}\n"""\nSi les extraits numérotés ci-dessous continuent visiblement ce même chapitre (même sujet, suite logique), CONTINUE-LE directement, sans répéter ni réécrire ce qui précède, et sans ajouter un nouveau titre "## " pour ce même chapitre. N'ouvre un nouveau "## Titre" que lorsque le contenu source aborde un sujet réellement différent.`
    : "";
  const partInstruction =
    totalParts > 1
      ? `\n\n---\nMODIFICATION DE FORMAT POUR CETTE GÉNÉRATION — s'ajoute à tout ce qui précède, ne le remplace pas :\nCe cours source est traité en ${totalParts} parties consécutives (contrainte technique de plateforme, invisible pour l'étudiant qui verra un seul document continu). Tu rédiges ICI la PARTIE ${partNumber}/${totalParts} (les extraits numérotés ci-dessous couvrent UNIQUEMENT cette partie, dans l'ordre du cours). Continue directement le contenu, structuré en chapitres Markdown ("## Titre du chapitre") comme d'habitude. N'écris NI introduction générale du cours NI conclusion récapitulative dans cette partie — seulement le corps des chapitres qu'elle couvre ; les autres parties seront concaténées à la suite.\n\nPRÉCISION IMPORTANTE SUR LA LONGUEUR POUR CETTE PARTIE SPÉCIFIQUEMENT (corrige une lecture possible de la consigne de longueur ci-dessus) : la consigne "vise largement plus de 8000 mots, sans plafond réel" s'applique au DOCUMENT COMPLET, cumulé sur l'ensemble des ${totalParts} parties — jamais à cette seule partie prise isolément. Garde exactement les mêmes exigences de fond pour CETTE partie (exhaustivité clinique réelle, simplicité pédagogique, redondance utile, aucun raccourci sur le contenu source qu'elle couvre) mais n'essaie PAS d'atteindre 8000+ mots pour cette partie seule si le volume réel des extraits ci-dessous ne le justifie pas — une partie qui couvre peu de contenu source doit rester proportionnellement plus courte, jamais artificiellement gonflée pour viser un total qui ne s'applique qu'au document entier.${continuityInstruction}`
      : "";

  const raw = await callOpenRouter(
    [
      { role: "system", content: explicationSystemPrompt + partInstruction },
      {
        role: "user",
        content: `Voici le contenu source${totalParts > 1 ? ` (partie ${partNumber}/${totalParts})` : ""}, découpé en extraits numérotés :\n"""\n${numberedExtraits}\n"""\n\nGénère le JSON demandé.`,
      },
    ],
    {
      model: CHEAP_MODEL,
      maxTokens: EXPLICATION_PART_MAX_TOKENS,
      bypassMock: true,
      reasoning: { effort: "low" },
      timeoutMs: EXPLICATION_PART_TIMEOUT_MS,
    }
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonResponse(raw);
  } catch (error) {
    const recovered = recoverExplicationOnly(raw);
    if (!recovered) throw error;
    console.warn(
      `[studio-explication-delta] JSON invalide/tronqué pour la partie ${partNumber}/${totalParts}, mais 'explication' récupérée isolément:`,
      error instanceof Error ? error.message : error
    );
    parsed = { explication: recovered };
  }
  const partMarkdown = (typeof parsed.explication === "string" ? parsed.explication : "").trim();
  // 50-char floor mirrors the old single-shot path's StudioTextSchema
  // (z.string().min(50)) — a trivially short but non-empty response (e.g.
  // `{"explication":"ok"}`) used to be caught by that Zod validation; this
  // per-part pipeline has no equivalent schema step downstream (parts are
  // joined and persisted as plain markdown), so this function is now the
  // only place that would ever catch it.
  if (partMarkdown.length < 50) {
    throw new Error(`La réponse de l'IA pour la partie ${partNumber}/${totalParts} ne contient pas de champ 'explication' exploitable.`);
  }
  return partMarkdown;
}

/**
 * Splits the fully-assembled Explication markdown into chapters and upserts
 * studio_course_explication_chapters — shared persistence step, called once
 * from app/api/studio/generate/explication-finalize/route.ts after every
 * part has been collected (genuine multi-request generation only — the
 * cache-hit/cross-university-delta shortcuts in explication-part/route.ts
 * persist directly and never reach this). source_chunk_indices is always
 * empty here — see generateExplicationPart's own comment for why.
 */
export async function persistExplicationChapters(courseId: number, explicationMarkdown: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const sections = splitExplicationByChapter(explicationMarkdown);
  const chapterRows = sections.map((section, i) => ({
    course_id: courseId,
    chapter_index: i,
    heading: section.headingText,
    content: section.content,
    source_chunk_indices: [] as number[],
  }));
  if (chapterRows.length === 0) return;
  const { error: chapterSaveError } = await supabase
    .from("studio_course_explication_chapters")
    .upsert(chapterRows, { onConflict: "course_id,chapter_index" });
  if (chapterSaveError) {
    console.error("[studio-explication-delta] Échec sauvegarde de la carte de chapitres (non bloquant):", chapterSaveError.message);
  }
}
