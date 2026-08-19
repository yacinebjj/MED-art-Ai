import type { DemoSectionId } from "@/lib/demo-content";
import {
  CAS_CLINIQUE_SYSTEM_PROMPT,
  EXEMPLES_ANALOGIES_SYSTEM_PROMPT,
  EXPLICATION_SYSTEM_PROMPT,
  QCMS_SYSTEM_PROMPT,
  RESUME_SYSTEM_PROMPT,
} from "@/lib/prompts/public-course-sections";

/**
 * The Studio pipeline for the generic curriculum module workspace
 * (app/dashboard/module/[id]/page.tsx) — "Option A": reuses the same
 * production-proven, JSON-schema system prompts that generate real Supabase
 * courses (lib/prompts/public-course-sections.ts — the ones "La Pleurésie"
 * and "Gastrite" were themselves generated with) for explication and
 * exemples_analogies unmodified, and overrides résumé/cas clinique/QCM
 * with additional Golden Standard mandates — always by APPENDING to the
 * shared prompt, never editing it, so the production per-course pipeline
 * (app/api/generate/*) is never affected.
 *
 * Nothing here touches Supabase — see app/api/studio/generate/route.ts,
 * which validates the model's JSON with zod (lib/ai/studio-schemas.ts) and
 * returns it straight to the frontend instead of persisting it.
 *
 * Model: SAME one the real "Golden Standard" Pleurésie pipeline uses. A
 * request to use "anthropic/claude-3.5-sonnet" was NOT followed literally,
 * because this exact codebase already proved that id dead (404s with "No
 * endpoints found") — re-verified live against
 * https://openrouter.ai/api/v1/models on 2026-08-09: "anthropic/claude-3.5-sonnet"
 * is absent from the catalog, "anthropic/claude-sonnet-5" is present.
 */
export const STUDIO_MODEL = "anthropic/claude-sonnet-5";

/**
 * Every Studio call MUST bypass lib/ai/mock-data.ts's marker matching (see
 * the comment on callOpenRouter's `bypassMock` option) — without this, a
 * JSON-wrapped mock fixture about an unrelated hardcoded topic can silently
 * replace a real Claude call in dev mode whenever a prompt happens to share a
 * substring with the production pipeline's own prompts (which is now
 * guaranteed, since this file imports those exact prompts). Kept as an
 * explicit named constant (not inlined `true`) so every call site that
 * passes it stays self-documenting.
 */
export const STUDIO_BYPASS_MOCK = true;

/**
 * CAS_CLINIQUE_SYSTEM_PROMPT (imported above) asks for exactly 1 case —
 * correct for the production pipeline, which persists one course at a time.
 * The Studio mandate now requires a MINIMUM of 5 distinct clinical cases.
 * Overridden by APPENDING an emphatic override (not by editing the shared
 * production prompt, which app/api/generate/cas-clinique/route.ts still
 * relies on for real courses) — the model reads the whole prompt, so a late,
 * explicit override reliably wins over the earlier "exactement 1" line while
 * every other rule (schema, keys, icon/color palette) stays identical.
 */
const STUDIO_CAS_CLINIQUE_SYSTEM_PROMPT = `${CAS_CLINIQUE_SYSTEM_PROMPT}

SURCHARGE OBLIGATOIRE (remplace la consigne de nombre ci-dessus) : le tableau "cases" doit contenir un MINIMUM ABSOLU DE CINQ (5) cas cliniques complets et distincts — jamais moins, quelle que soit la longueur du cours source. Choisis 5 archétypes cliniques réellement différents du même cours (par exemple : forme typique, forme atypique/piège diagnostique, urgence/forme grave, terrain particulier, complication évolutive) — jamais deux fois le même angle. Chaque cas doit avoir ses 5 actes intégralement rédigés (interrogatoire complet, examen physique complet, bilan complémentaire complet, raisonnement différentiel, prise en charge) — aucun raccourci, aucun acte vide. Chaque cas garde son propre "id" unique ("cas-1" à "cas-5", ou plus si tu identifies un 6e archétype pertinent) et son propre "numero" séquentiel.

PROFONDEUR PHYSIOPATHOLOGIQUE OBLIGATOIRE (Golden Standard — non négociable) : dans CHAQUE cas, pour CHAQUE champ "pourquoi" (acte2_examen_physique, acte3_examens_complementaires, acte4_raisonnement.items) ainsi que pour "acte4_raisonnement.conclusion", détaille minutieusement le mécanisme physiopathologique exact — le processus tissulaire, cellulaire ou moléculaire précis qui relie le symptôme ou le signe observé à la maladie — avec une rigueur médicale absolue. Un "pourquoi" superficiel du type "car c'est un signe évocateur de X" est STRICTEMENT INTERDIT ; explique le mécanisme d'action réel, étape par étape si nécessaire, qui produit ce signe chez CE patient précis.`;

/**
 * RESUME_SYSTEM_PROMPT (imported above) already mandates the exact 6-mode
 * structure — the Golden Standard mandate isn't about structure here, it's
 * about depth: the client flagged that generated bullets can read as bare
 * keyword lists. This override doesn't touch structure/schema at all, only
 * demands every bullet actually explain itself.
 */
const STUDIO_RESUME_SYSTEM_PROMPT = `${RESUME_SYSTEM_PROMPT}

SURCHARGE OBLIGATOIRE (Golden Standard — renforce, sans jamais réduire ni restructurer, les consignes ci-dessus) : pour CHAQUE puce ou point clé de CHAQUE mode (cards.items, cheatsheet cards.items, astuces.details, guideline steps.content, etc.), n'écris JAMAIS un mot-clé ou un terme isolé sans contexte. Pour chaque concept ou point clé, fournis systématiquement une brève explication claire de son rôle et de son fonctionnement. Ne laisse aucune zone d'ombre — l'étudiant doit comprendre le "pourquoi" et le "comment" sans avoir besoin de chercher ailleurs. Ceci ne change ni le nombre de puces demandé ni la structure des 6 modes, seulement le contenu de chaque puce.`;

/**
 * QCMS_SYSTEM_PROMPT (imported above) asks for 8-12 QCM + 4-6 QROC — correct
 * for a normal révision session, but the Studio mandate now requires a much
 * larger "épreuve" (minimum 30 QCM + 5 QROC). Same append-only override
 * strategy as cas clinique above, for the same reason (production route
 * still needs the original counts).
 */
const STUDIO_QCMS_SYSTEM_PROMPT = `${QCMS_SYSTEM_PROMPT}

SURCHARGE OBLIGATOIRE (remplace la consigne de nombre ci-dessus) : le tableau "qcms" doit contenir un MINIMUM ABSOLU DE TRENTE (30) QCM, et le tableau "qrocs" un minimum de CINQ (5) QROC — jamais moins, quelle que soit la longueur du cours source. Les questions doivent être de niveau Résidanat, réellement difficiles (distracteurs plausibles, questions à réponses multiples incluses), avec une explication complète pour chaque option existante (A à E). Numérote "id" séquentiellement à partir de 1, sans trou, pour chacun des deux tableaux.`;

interface StudioPromptConfig {
  systemPrompt: string;
  /**
   * 32000 is not an arbitrary "as high as possible" guess — it's the exact
   * ceiling lib/course-generation-shared.ts's SECTION_CONFIG already uses in
   * production for explication/exemples_analogies (proven reliable there),
   * and a live call made earlier this session at this same ceiling for
   * cas_clinique/qcm completed well under budget (~6700-9000 tokens actually
   * used out of 32000). Per the "no API calls to verify" instruction for
   * this pass, pushing past this already-proven number would be pure
   * speculation with no way to confirm it doesn't 400 — 32000 is the honest
   * "maximum absolu" this codebase can currently back up.
   */
  maxTokens: number;
}

/** Only the tiles the existing Studio UI actually renders (lib/demo-content.ts's DEMO_SECTIONS) get a prompt — there is no 6th tile to add one for. */
export const STUDIO_PROMPT_CONFIG: Record<DemoSectionId, StudioPromptConfig> = {
  explication: { systemPrompt: EXPLICATION_SYSTEM_PROMPT, maxTokens: 32000 },
  resume: { systemPrompt: STUDIO_RESUME_SYSTEM_PROMPT, maxTokens: 32000 },
  cas_clinique: { systemPrompt: STUDIO_CAS_CLINIQUE_SYSTEM_PROMPT, maxTokens: 32000 },
  qcm: { systemPrompt: STUDIO_QCMS_SYSTEM_PROMPT, maxTokens: 32000 },
  exemples_analogies: { systemPrompt: EXEMPLES_ANALOGIES_SYSTEM_PROMPT, maxTokens: 32000 },
};

/** Maps each Studio tile id to the top-level JSON key its prompt actually returns. "qcm" is the one mismatch — DEMO_SECTIONS uses the singular tile id, but QCMS_SYSTEM_PROMPT (shared with production) returns the plural "qcms" key. */
export const STUDIO_SECTION_KEYS: Record<DemoSectionId, string> = {
  explication: "explication",
  resume: "resume",
  cas_clinique: "cas_clinique",
  qcm: "qcms",
  exemples_analogies: "exemples_analogies",
};

/**
 * Builds the FINAL system-prompt string sent to the model: the tile's static
 * instructions (STUDIO_PROMPT_CONFIG[actionType].systemPrompt) followed by
 * the course's full raw text, injected directly into the system message
 * itself — not as a separate user-message turn. This is a deliberate
 * architecture choice: the course content is the one thing every instruction
 * above it refers to ("basé sur ce cours..."), so it belongs in the same
 * message as those instructions, immediately before the final directive that
 * triggers generation.
 */
export function buildStudioSystemPrompt(actionType: DemoSectionId, courseContent: string): string {
  const basePrompt = STUDIO_PROMPT_CONFIG[actionType].systemPrompt;
  return `${basePrompt}

Voici le texte intégral du cours :

${courseContent}

Basé strictement sur ce texte, génère le contenu demandé, au format JSON exact spécifié ci-dessus, sans jamais inventer d'information absente de ce texte.`;
}

/**
 * Per-type rewrite/regenerate instruction — see buildStudioRegeneratePrompt.
 * Explication/résumé ask for a 90/10 light rewrite (90% of substance,
 * structure and facts held IDENTICAL, only ~10% of phrasing/transitions/
 * style reworked); exemples_analogies keeps its own separate ~10% variation
 * wording; cas_clinique/qcm ask for genuinely NEW content on the same
 * medical topics instead, since a "light rewrite" of a clinical case or a
 * QCM question would just be the same question reworded, not a fresh one
 * worth practicing with again.
 *
 * NOTE on token cost: this wording change does NOT reduce completion
 * tokens — a 90%-preserved rewrite is, by definition, the same LENGTH as
 * the original (only ~10% of wording changes, not 10% of the length), so
 * maxTokens stays at the section's full cap in buildStudioRegeneratePrompt
 * below, same as before. See that function's own comment for what this
 * change actually does and doesn't save.
 */
const REGENERATE_INSTRUCTIONS: Record<DemoSectionId, string> = {
  explication:
    "Réécris cette explication en gardant 90% du contenu IDENTIQUE : mêmes informations médicales, même structure, même exactitude factuelle, mot pour mot là où c'est déjà correct. Modifie UNIQUEMENT environ 10% — la formulation, les mots de transition, le rythme des phrases — pour que ça sonne fraîchement écrit, sans jamais sacrifier la continuité pédagogique ni la longueur du contenu.",
  resume:
    "Modifie ce résumé en gardant 90% du contenu IDENTIQUE : mêmes faits essentiels, même structure de puces, même niveau de détail. Modifie UNIQUEMENT environ 10% — le formatage, l'ordre de présentation, quelques tournures — sans jamais retirer d'information ni raccourcir le résumé.",
  cas_clinique:
    "En te basant sur le contexte médical de ces cas cliniques, génère des cas cliniques COMPLÈTEMENT NOUVEAUX et différents (autres archétypes, autre présentation clinique), sur les mêmes sujets médicaux. Ne réutilise aucun des cas ci-dessous.",
  qcm: "Lis ces QCM. Maintenant, génère des questions QCM COMPLÈTEMENT NOUVELLES et DIFFÉRENTES sur les mêmes sujets médicaux. Ne répète jamais exactement les mêmes questions ni les mêmes formulations.",
  exemples_analogies:
    "Réécris ces exemples et analogies avec de légères variations (changement d'environ 10%), en gardant les mêmes idées de fond.",
};

/**
 * Builds the system prompt for a "Regénérer" call (see
 * app/api/studio/regenerate/route.ts). The original source document is
 * NEVER refetched or resent here — only the section's OWN already-generated
 * content (read straight from studio_courses, no source join) goes back to
 * the model — together with the exact same JSON-shape instructions the
 * original generation used (so STUDIO_SCHEMAS validation still passes
 * unchanged) plus the type-specific rewrite/regenerate instruction above.
 * This was ALREADY true before the 90/10 wording above — it isn't new.
 *
 * Honest cost note: this does NOT mean regenerate is cheaper than a fresh
 * generation. Prompt tokens here are the previously-generated content itself
 * (e.g. ~21,700 tokens for a full Explication, per this project's own
 * measured data), which is larger than a fresh call's prompt (the source
 * text truncated to MAX_SOURCE_CHARS, ~3,800 tokens measured) — so prompt
 * tokens actually GROW for content-heavy sections. And completion tokens
 * (the dominant cost driver — priced ~5x prompt tokens, and normally ~85%+
 * of total tokens on a full section) are UNCHANGED: maxTokens stays at the
 * section's full cap, because a 90%-preserved rewrite is still the same
 * LENGTH of output, not a shorter one. There is no safe way to shrink
 * completion tokens for a "keep 90%" task without risking truncating
 * legitimate preserved content. Net effect: a light-rewrite regenerate call
 * costs roughly the SAME as a fresh generation for that section, sometimes
 * slightly more — "not resending the raw PDF" was never the expensive part
 * to begin with.
 */
export function buildStudioRegeneratePrompt(actionType: DemoSectionId, existingContent: string): string {
  const basePrompt = STUDIO_PROMPT_CONFIG[actionType].systemPrompt;
  const instruction = REGENERATE_INSTRUCTIONS[actionType];
  return `${basePrompt}

Voici le contenu DÉJÀ GÉNÉRÉ pour cette section (c'est ta SEULE base de travail — le document source original n'est pas fourni ici, ne suppose rien au-delà de ce contenu) :

${existingContent}

${instruction}

Réponds uniquement avec le JSON exact au format spécifié ci-dessus.`;
}

/**
 * Builds the system prompt for the studio_content_cache FUZZY-match path
 * (see lib/studio-content-cache.ts and app/api/studio/generate/route.ts) —
 * a student's uploaded text came back ~85%+ similar (MinHash) to another
 * student's already-cached course, meaning it's genuinely the same
 * reference material with real differences (a different professor's
 * formatting/titles, added local notes), not a fresh, unrelated course.
 *
 * Deliberately NOT a full regeneration from scratch (that would throw away
 * the whole cost-saving point of the cache) and NOT a verbatim serve of the
 * cached original either (the new student's actual uploaded text may say
 * something the cached version doesn't — silently ignoring that would be
 * wrong, not just unoptimized). Instead: the model gets BOTH the cached
 * base output and the new source text, and is instructed to adapt only
 * where they genuinely differ, at a much smaller maxTokens ceiling than a
 * fresh generation (see STUDIO_DELTA_MAX_TOKENS below) — an edit pass, not
 * a rewrite.
 */
export function buildStudioDeltaAdaptationPrompt(actionType: DemoSectionId, baseContentJson: string, newSourceText: string): string {
  const basePrompt = STUDIO_PROMPT_CONFIG[actionType].systemPrompt;
  return `${basePrompt}

Un autre étudiant a déjà généré le contenu suivant pour un cours quasi-identique (même matière médicale de fond) :

${baseContentJson}

Voici maintenant le texte source EXACT fourni par CE nouvel étudiant, qui correspond à la même matière mais avec des différences réelles (formulation, titres, notes de cours spécifiques à sa faculté, informations supplémentaires) :

${newSourceText}

INSTRUCTION D'ADAPTATION (delta uniquement — PAS une réécriture complète) : compare les deux et adapte le contenu ci-dessus UNIQUEMENT là où le nouveau texte source diffère réellement (titres, terminologie spécifique, informations supplémentaires présentes dans le nouveau texte mais absentes du contenu de référence, structure). Conserve strictement identique tout ce qui est déjà exact et commun aux deux — ne réinvente jamais une information déjà correcte. Si le nouveau texte source ne contient aucune information qui contredit ou complète le contenu de référence, renvoie-le tel quel.

Réponds uniquement avec le JSON exact au format spécifié ci-dessus.`;
}

/**
 * A fraction of the full generation's own ceiling — this is an EDIT pass
 * over already-generated content, not a fresh generation, so it should
 * never need anywhere near as much output. Applied per actionType (each
 * section's own STUDIO_PROMPT_CONFIG maxTokens), never a flat constant,
 * since explication/qcm/cas_clinique already have very different ceilings
 * from each other for the SAME reason at full-generation time.
 */
export function studioDeltaMaxTokens(actionType: DemoSectionId): number {
  return Math.round(STUDIO_PROMPT_CONFIG[actionType].maxTokens * 0.35);
}
