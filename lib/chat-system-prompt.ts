/**
 * Shared persona/system-content builder for the course chat — factored out
 * of app/api/courses/chat/route.ts so lib/cache-prewarming.ts can generate
 * answers through the EXACT same prompt a real student's live message would
 * use. Keeping one source of truth here means a pre-warmed cache entry is
 * never subtly different in style/depth from what the live route would have
 * produced itself.
 */

import type { ChatMessageInput } from "@/lib/ai/openrouter";
import { CHAT_MAX_CONTEXT_CHARS } from "@/lib/chat-constants";

const MAX_CONTEXT_CHARS = CHAT_MAX_CONTEXT_CHARS;

// Deliberately terse — every character here is repriced on every call
// whenever the cache misses (see this block's own cache_control tag at its
// call site), dense in FORM instructions: depth comes from HOW the model is
// told to write, not from length.
//
// IMPORTANT, technical correction to a prior request in this thread: there
// is no mechanism, on ANY provider, for a model to "reuse" a previously-
// generated phrase without regenerating and being billed for it — prompt
// caching only ever discounts INPUT tokens (confirmed against Anthropic's
// own docs: cache_read_input_tokens has no output-side equivalent). What CAN
// genuinely reduce output tokens is asking for less scaffolding text in the
// first place — fixed, literal micro-labels instead of a freshly-composed
// transition sentence every time, and an explicit ban on filler preambles.
export const CHAT_SYSTEM_PROMPT_BASE = `Tu es MedArt Assistant, professeur de médecine brillant (médecine, pharmacie, dentaire). MIROIR DE LANGUE STRICT : réponds TOUJOURS dans la langue du dernier message de l'étudiant, jamais un défaut fixe — anglais reçu -> réponds en anglais, arabe classique -> arabe classique, Darija algérienne -> Darija algérienne (naturelle, pas de l'arabe classique traduit), français -> français. Termes médicaux/techniques toujours dans leur forme standard (souvent française ou latine) même au milieu d'une autre langue, jamais retraduits artificiellement.

Tu maîtrises déjà toute la médecine fondamentale et la terminologie de chaque spécialité (inflammation, ischémie, nécrose, ostéosynthèse, cal vicieux, etc.) — utilise ce vocabulaire directement et avec exactitude, ne redéfinis jamais un terme standard depuis zéro. Concentre chaque réponse sur ce qui est spécifique à la question ou au passage du cours, pas sur des rappels génériques que tu connais déjà.

Structure fixe, toujours ces labels littéraux (jamais de phrase de transition composée) : "**Définition**", "**Physiopathologie**", "**🖼️ Analogie**", "**💡 Perle clinique**" si pertinent. **Gras** sur les termes clés. Aucun préambule ("il est important de comprendre que...", "pour bien saisir ce concept...") — va direct au contenu. Percutant, jamais délayé.

La longueur de ta réponse doit correspondre exactement à ce que la question exige — une question ciblée et précise mérite une réponse courte et dense, pas étirée pour "faire complet". Ne rallonge jamais artificiellement.

Extrait copié du cours → explique ce passage précis, pas tout le document. Question non médicale → réponds normalement.

RÈGLE ANTI-HALLUCINATION (stricte) : appuie-toi UNIQUEMENT sur les extraits du cours fournis ci-dessous et sur tes connaissances médicales fondamentales sûres — n'invente jamais un fait, un chiffre, une classification ou une référence qui n'apparaît ni dans le texte fourni ni dans une connaissance médicale standard et vérifiée. Si l'information demandée n'est présente ni dans le cours ni dans tes connaissances fiables, dis-le clairement plutôt que d'inventer une réponse plausible.

Si le contexte contient à la fois une "Explication déjà validée" et un "Extrait source original" pour la même partie du cours, ne les recopie jamais tels quels : reformule et adapte pour répondre précisément à la question. En cas de divergence entre les deux, l'extrait source fait foi — c'est le document réel de l'étudiant, l'explication est une élaboration a posteriori.

RÈGLE D'OR : terme arabe/darija de l'étudiant = sacré, jamais traduit silencieusement.`;

/**
 * Builds the system message for a NORMAL (non-highlight) chat turn, as TWO
 * content blocks:
 *   1. The persona/instructions — byte-identical across every course and
 *      every student, so it's the cache hit most likely to be reused
 *      platform-wide. cache_control-marked.
 *   2. A handful of RAG-retrieved chunks (never the full course), re-ranked
 *      per QUESTION, so its content changes on virtually every message.
 *      NEVER cache_control-marked: Anthropic charges a ~25% WRITE premium
 *      the first time a prefix is cached, refunded only as a ~90%-off READ
 *      if the exact same bytes are sent again before the cache entry
 *      expires — tagging a block that changes every message guarantees
 *      paying that premium with essentially zero chance of ever reading
 *      from it, strictly worse than not caching it.
 * Anthropic caches by exact-prefix match, so cache_control MUST sit on
 * static content only, and nothing dynamic (history, the new question) can
 * come before it in the request.
 *
 * `useAnthropicCaching` must be false whenever the hybrid router (see
 * lib/chat-model-routing.ts) picked ECONOMY_MODEL for this call:
 * `cache_control` is an Anthropic-specific prompt-caching directive with no
 * verified behavior on a non-Anthropic provider routed through OpenRouter.
 *
 * `ttl: "1h"` (see ContentBlock's own comment in lib/ai/openrouter.ts) —
 * the default 5-minute ephemeral cache treats any realistic pause between a
 * student's messages (reading, thinking) as a fresh write; 1 hour survives
 * that gap and turns far more of a real conversation's messages into cheap
 * cache READS instead of full-price rewrites.
 */
export function buildSystemContent(sourceText: string | null, useAnthropicCaching: boolean): ChatMessageInput["content"] {
  const blocks: NonNullable<Extract<ChatMessageInput["content"], unknown[]>> = [
    { type: "text", text: CHAT_SYSTEM_PROMPT_BASE, ...(useAnthropicCaching ? { cache_control: { type: "ephemeral" as const, ttl: "1h" as const } } : {}) },
  ];

  if (sourceText) {
    blocks.push({
      type: "text",
      text: `Extraits pertinents du cours (contexte, pas le document entier) :\n"""\n${sourceText.slice(0, MAX_CONTEXT_CHARS)}\n"""`,
    });
  }

  return blocks;
}
