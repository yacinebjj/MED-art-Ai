/**
 * Cache pre-warming — the one honest answer to "even the very first
 * student's message must be cheap": you cannot make a genuinely NOVEL
 * question's first-ever generation free (output tokens are always billed in
 * full, on every provider, verified repeatedly this session against real
 * pricing and official docs). What you CAN do is make sure the platform,
 * not the waiting student, pays for that first generation — ahead of time,
 * off the live request path, for the questions a 4th-year student is
 * overwhelmingly likely to actually ask about a given course.
 *
 * Triggered fire-and-forget right after a Workspace course is uploaded and
 * chunk-indexed (see app/api/studio/courses/route.ts), this:
 *   1. Asks the model ONCE for the ~5 most likely exam-style questions a
 *      student would ask about this course's content (grounded in its own
 *      indexed chunks — never the full raw text, same rule as the live
 *      chat route).
 *   2. Generates a real, full-depth answer to each — through the EXACT same
 *      prompt/model-routing pipeline a live student message would use (see
 *      lib/chat-system-prompt.ts), so a pre-warmed answer is indistinguishable
 *      in quality from one generated live.
 *   3. Stores each (question, answer) pair into the SAME semantic_cache the
 *      live route reads from (lib/ai/semantic-cache.ts), using the identical
 *      content-hash scope key the live route would compute for this course —
 *      so a real student's later, similarly-worded question lands as a
 *      cache HIT (free) instead of a fresh generation, even if they are
 *      literally the first person to ever open this course's chat.
 *
 * UPDATED: now runs entirely on lib/ai/openrouter.ts's FREE_MODEL_CHAIN
 * (same model chain as the live chat route and the Dashboard Assistant) —
 * genuinely zero dollar cost per course, not just amortized. The remaining
 * real constraint is OpenRouter's own account-wide daily free-tier request
 * cap, which this shares with every other free-tier caller (see
 * lib/platform-spend-guard.ts's reserveFreeTierCapacity, called before both
 * the classification step and each per-question generation below) — a
 * pre-warm run that finds the shared daily budget already exhausted aborts
 * quietly rather than pushing the platform over that real external limit.
 *
 * Fails open at every step, by construction, exactly like every other cache
 * layer in this codebase — any failure here is logged and swallowed, never
 * surfaced to a student, and never re-attempted (a failed pre-warm just
 * means that course's first real question generates normally, same as
 * before this existed).
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError, FREE_MODEL_CHAIN, type ChatMessageInput } from "@/lib/ai/openrouter";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { storeSemanticCacheEntry } from "@/lib/ai/semantic-cache";
import { retrieveRelevantContext } from "@/lib/chat-context-retrieval";
import { reserveFreeTierCapacity } from "@/lib/platform-spend-guard";
import { buildSystemContent } from "@/lib/chat-system-prompt";

/**
 * Tries each model in FREE_MODEL_CHAIN in order (see that constant's own
 * comment), returning the first successful completion. Mirrors the live
 * routes' own fallback loop (app/api/courses/chat/route.ts,
 * app/api/dashboard-assistant/route.ts) — a free-tier model erroring is the
 * routine case here, not exceptional. Returns `null` (never throws) if every
 * model in the chain fails, matching this whole file's fail-open contract.
 */
async function callFreeModelChain(
  messages: ChatMessageInput[],
  options: { maxTokens: number; temperature: number }
): Promise<string | null> {
  for (const model of FREE_MODEL_CHAIN) {
    try {
      return await callOpenRouter(messages, {
        model,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        reasoning: { effort: "low" },
        // bypassMock: true — a mock fixture written into the PERSISTENT
        // semantic_cache (unlike a one-shot dev response) could survive to
        // be served to a real student later; see callOpenRouter's own
        // bypassMock rationale.
        bypassMock: true,
      });
    } catch (error) {
      console.error(
        `[cache-prewarming] Modèle gratuit "${model}" indisponible, bascule sur le suivant:`,
        error instanceof OpenRouterError ? error.message : error instanceof Error ? error.message : error
      );
    }
  }
  return null;
}

// Enough likely questions to cover a course's main themes without turning
// this into an unbounded, ever-growing spend per upload — 5 real
// generations is already the same order of magnitude as what a real student
// asks in a short session.
const MAX_PREWARM_QUESTIONS = 5;

// Grounds the "what would a student ask" step in the course's OWN indexed
// material — never the raw document (same strict rule as the live route).
// A handful of early chunks is enough signal for likely-question generation;
// this step doesn't need the same precision as answering a specific
// question, just a representative sample of what the course covers.
const GROUNDING_CHUNK_COUNT = 6;
const GROUNDING_CHARS_CAP = 6000;

interface LikelyQuestionsPayload {
  questions?: unknown;
}

function parseLikelyQuestions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as LikelyQuestionsPayload;
    if (!Array.isArray(parsed.questions)) return [];
    return parsed.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0).map((q) => q.trim());
  } catch {
    return [];
  }
}

/**
 * Pre-generates and caches likely Q&A for one Workspace course. Fire-and-
 * forget from the caller — never awaited on the student-facing upload
 * response, never throws.
 */
export async function prewarmCourseCache(courseId: number, rawText: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();

    // Ground on the course's own already-indexed chunks — if indexing
    // hasn't completed yet (a real race with indexStudioCourseChunksForChat,
    // both fire-and-forget), there's nothing to ground likely questions in
    // yet. No retry: the course's first real student question still works
    // normally either way, this is purely additive.
    const { data: chunkRows, error: chunkError } = await supabase
      .from("studio_course_chunks")
      .select("content")
      .eq("course_id", courseId)
      .order("chunk_index", { ascending: true })
      .limit(GROUNDING_CHUNK_COUNT);

    if (chunkError || !chunkRows || chunkRows.length === 0) {
      console.log(`[cache-prewarming] course_id=${courseId} — pas encore de chunks indexés, pré-chauffage reporté (le prochain upload/génération pourra le redéclencher).`);
      return;
    }

    const groundingExcerpt = (chunkRows as { content: string }[])
      .map((row) => row.content)
      .join("\n\n---\n\n")
      .slice(0, GROUNDING_CHARS_CAP);

    // Same shared external free-tier ceiling as every live route (see
    // reserveFreeTierCapacity's own comment) — this is a real request
    // against the SAME account-wide daily cap, background job or not, so it
    // must be counted the same way. Abort quietly (fail-open) if exhausted:
    // this is purely additive pre-warming, never worth pushing the platform
    // over its real external limit for.
    if (!(await reserveFreeTierCapacity()).allowed) {
      console.log(`[cache-prewarming] course_id=${courseId} — plafond gratuit quotidien atteint, pré-chauffage reporté.`);
      return;
    }

    const likelyQuestionsRaw = await callFreeModelChain(
      [
        {
          role: "system",
          content:
            'Tu identifies les questions qu\'un étudiant en médecine (4e année) poserait le plus probablement sur cet extrait de cours, style révision d\'examen. Réponds UNIQUEMENT en JSON strict : {"questions": ["...", "...", ...]} — 5 questions courtes, concrètes, en français, chacune sur un concept distinct de l\'extrait.',
        },
        { role: "user", content: groundingExcerpt },
      ],
      { maxTokens: 500, temperature: 0.4 }
    );

    if (likelyQuestionsRaw === null) {
      console.log(`[cache-prewarming] course_id=${courseId} — tous les modèles gratuits ont échoué pour l'étape de classification, pré-chauffage abandonné.`);
      return;
    }

    const questions = parseLikelyQuestions(likelyQuestionsRaw).slice(0, MAX_PREWARM_QUESTIONS);
    if (questions.length === 0) {
      console.log(`[cache-prewarming] course_id=${courseId} — aucune question exploitable générée, pré-chauffage abandonné.`);
      return;
    }

    // MUST match exactly what app/api/courses/chat/route.ts computes for
    // this same course (sha256 of the normalized raw_text) — otherwise a
    // real student's later lookup would search under a different scope key
    // and never find these entries at all.
    const cacheScopeKey = sha256(normalizeText(rawText));

    let cached = 0;
    for (const question of questions) {
      try {
        // Reserved per question — each is its own real free-tier request
        // against the same shared daily ceiling.
        if (!(await reserveFreeTierCapacity()).allowed) {
          console.log(`[cache-prewarming] course_id=${courseId} — plafond gratuit quotidien atteint, arrêt du pré-chauffage (${cached}/${questions.length} déjà mis en cache).`);
          break;
        }

        const retrieved = await retrieveRelevantContext(question, { studioCourseId: courseId });
        // `false` — same reason as the live route: this chain never uses an
        // Anthropic model, so cache_control is never applicable.
        const answer = await callFreeModelChain(
          [
            { role: "system", content: buildSystemContent(retrieved, false) },
            { role: "user", content: question },
          ],
          { maxTokens: 8192, temperature: 0.3 }
        );

        if (answer === null) {
          console.error(`[cache-prewarming] Échec pré-génération (tous les modèles gratuits ont échoué) pour: "${question}"`);
          continue;
        }

        await storeSemanticCacheEntry({ question, answer, courseSlug: cacheScopeKey });
        cached++;
      } catch (innerError) {
        // One failed question must never abort the rest — each is
        // independent, fail-open, log-and-continue.
        console.error(
          "[cache-prewarming] Échec pré-génération d'une question (non bloquant, suivante):",
          innerError instanceof Error ? innerError.message : innerError
        );
      }
    }

    console.log(`[cache-prewarming] course_id=${courseId} — ${cached}/${questions.length} question(s) pré-générée(s) et mises en cache (exact + cross-cours).`);
  } catch (error) {
    console.error("[cache-prewarming] Échec pré-chauffage (non bloquant, la première question réelle générera normalement):", error instanceof Error ? error.message : error);
  }
}
