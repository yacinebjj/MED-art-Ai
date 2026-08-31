import type { DemoSectionId } from "@/lib/demo-content";
import type { ContentBlock } from "@/lib/ai/openrouter";
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
 * The Studio mandate settled on EXACTLY THREE cases per course (reverted
 * down from an earlier "minimum 5" mandate, and reverted away from a
 * lazy/progressive one-case-at-a-time generation flow that used to live here
 * — both undone for cost reasons: 3 well-chosen cases in one call is cheaper
 * than 5, and simpler/more predictable to bill than an open-ended "generate
 * more on demand" flow). Overridden by APPENDING an emphatic override (not by
 * editing the shared production prompt, which
 * app/api/generate/cas-clinique/route.ts still relies on for real courses) —
 * the model reads the whole prompt, so a late, explicit override reliably
 * wins over the earlier "exactement 1" line while every other rule (schema,
 * keys, icon/color palette) stays identical.
 */
const STUDIO_CAS_CLINIQUE_SYSTEM_PROMPT = `${CAS_CLINIQUE_SYSTEM_PROMPT}

SURCHARGE OBLIGATOIRE (remplace la consigne de nombre ci-dessus) : le tableau "cases" doit contenir EXACTEMENT TROIS (3) cas cliniques complets et distincts — ni plus, ni moins, quelle que soit la longueur du cours source. Choisis les 3 présentations cliniques les PLUS IMPORTANTES et les PLUS FRÉQUENTES de ce cours — celles qu'un étudiant a la plus forte probabilité de croiser à l'examen ou en stage — plutôt que de viser la diversité d'angles rares ou exotiques. Chaque cas doit avoir ses 5 actes intégralement rédigés (interrogatoire complet, examen physique complet, bilan complémentaire complet, raisonnement différentiel, prise en charge) — aucun raccourci, aucun acte vide. Chaque cas garde son propre "id" unique ("cas-1" à "cas-3") et son propre "numero" séquentiel.

PROFONDEUR PHYSIOPATHOLOGIQUE OBLIGATOIRE (Golden Standard — non négociable) : dans CHAQUE cas, pour CHAQUE champ "pourquoi" (acte2_examen_physique, acte3_examens_complementaires, acte4_raisonnement.items) ainsi que pour "acte4_raisonnement.conclusion", détaille minutieusement le mécanisme physiopathologique exact — le processus tissulaire, cellulaire ou moléculaire précis qui relie le symptôme ou le signe observé à la maladie — avec une rigueur médicale absolue. Un "pourquoi" superficiel du type "car c'est un signe évocateur de X" est STRICTEMENT INTERDIT ; explique le mécanisme d'action réel, étape par étape si nécessaire, qui produit ce signe chez CE patient précis.

ÉLAGAGE LÉGER (nouveau — ne touche ni la structure ni la profondeur ci-dessus) : élimine uniquement les mots et tournures de remplissage qui n'apportent aucune information clinique (répétitions inutiles, formules creuses) dans "acte1_interrogatoire", "acte2_examen_physique" et ailleurs — sans raccourcir un seul échange, une seule étape d'examen, ou un seul "pourquoi" physiopathologique.

INTÉGRITÉ STRUCTURELLE ABSOLUE (ne concerne QUE la structure, jamais le contenu) : quel que soit le degré de concision demandé ci-dessus pour le TEXTE, tu dois TOUJOURS renvoyer la STRUCTURE JSON complète, sans exception — chacune des 3 cas doit contenir CHACUNE de ses clés ("id", "numero", "archetype", "icon", "color", "titre", "scene", "vitals", "acte1_interrogatoire", "acte2_examen_physique", "acte3_examens_complementaires", "acte4_raisonnement" avec "items" ET "conclusion", "acte5_prise_en_charge" avec "items" ET "surveillance"). Condense les PHRASES si nécessaire, mais NE SUPPRIME JAMAIS une clé de niveau supérieur ou imbriquée — un JSON auquel il manque ne serait-ce qu'une seule clé est un échec total de la tâche, même si le contenu présent est par ailleurs excellent.`;

/**
 * RESUME_SYSTEM_PROMPT (imported above) already mandates the exact 6-mode
 * structure — never touched here. The mandate for this override shifted from
 * "never leave a bare keyword, always explain why/how" (verbose by
 * construction — that was actively adding length) to the opposite priority:
 * maximum density. Every bullet still needs enough context to stand alone
 * (a bare keyword is still banned), but now as ONE short, dense sentence
 * instead of an explanatory passage.
 *
 * Single-shot generation (product direction, explicitly reverted from an
 * earlier lazy per-mode-loading + cross-student cache architecture): all 6
 * modes are always generated together in one call, the instant the Résumé
 * tab is opened — no per-mode click-to-generate, no separate cache. The
 * cost lever here is exclusively prompt density (fewer words per bullet),
 * not deferred/partial generation.
 */
const STUDIO_RESUME_SYSTEM_PROMPT = `${RESUME_SYSTEM_PROMPT}

SURCHARGE OBLIGATOIRE — DENSITÉ MAXIMALE (remplace toute consigne de longueur/verbosité ci-dessus ; la structure des 6 modes reste strictement inchangée) : chaque puce ou point clé (cards.items, cheatsheet cards.items, astuces.details, guideline steps.content, etc.) doit être UNE SEULE phrase courte, dense et autonome — jamais un mot-clé isolé sans aucun contexte, mais jamais non plus une phrase longue ou un mini-paragraphe explicatif. Élimine systématiquement : toute répétition d'une idée déjà énoncée ailleurs dans le même mode, les phrases de transition ou d'introduction sans contenu médical ("il est important de noter que...", "on peut également souligner que..."), et tout mot ou adjectif de remplissage. Le résultat doit être nettement plus compact qu'une rédaction non filtrée, sans jamais donner l'impression d'un résumé tronqué ou incomplet — chaque puce doit rester immédiatement compréhensible seule, juste débarrassée de tout superflu.

INTÉGRITÉ STRUCTURELLE ABSOLUE (ne concerne QUE la structure, jamais le contenu) : quel que soit le degré de concision demandé ci-dessus pour le TEXTE de chaque puce, tu dois TOUJOURS renvoyer la STRUCTURE JSON complète du mode généré (toutes ses clés de premier niveau et imbriquées telles que définies dans le schéma — hero, sections, ddx_table, pieges, cards, steps, quotes, perles, items — même quand une clé n'est pas utilisée par CE mode précis, auquel cas renvoie-la comme tableau vide [] ou objet aux champs vides, jamais comme clé absente). Condense les PHRASES si nécessaire, mais NE SUPPRIME JAMAIS une clé — un JSON auquel il manque ne serait-ce qu'une seule clé est un échec total de la tâche, même si le contenu présent est par ailleurs excellent.`;

/**
 * QCMS_SYSTEM_PROMPT (imported above) asks for 8-12 QCM + 4-6 QROC — the
 * Studio mandate went through a "minimum 30 QCM + 5 QROC" phase (real cost
 * driver: 30+ questions, each with a 5-option explanation, is a LOT of
 * completion tokens) before settling on the current, cost-conscious target:
 * exactly 15 QCM, and QROC dropped entirely — a focused, high-quality 15-
 * question set instead of a 35-item épreuve most students never finish
 * anyway. `qrocs` stays a required key in STUDIO_SCHEMAS (StudioQcmsSchema,
 * now with no minimum) so InteractiveQuiz — SHARED with the real per-course
 * production pipeline via GastriteQcmsStudio/ExamQcmStudio, never edited to
 * assume Studio-only behavior — keeps receiving the exact prop shape it
 * always has; it already hides its QROC section entirely when the array is
 * empty (see that component's own comment).
 */
const STUDIO_QCMS_SYSTEM_PROMPT = `${QCMS_SYSTEM_PROMPT}

SURCHARGE OBLIGATOIRE (remplace la consigne de nombre ci-dessus) : le tableau "qcms" doit contenir EXACTEMENT QUINZE (15) QCM — ni plus, ni moins, quelle que soit la longueur du cours source. AUCUN QROC : ignore toute mention de QROC dans les consignes ci-dessus — le tableau "qrocs" doit être renvoyé comme un tableau VIDE ([]), sans générer la moindre question QROC. Les 15 QCM doivent être de niveau Résidanat, réellement difficiles (distracteurs plausibles, questions à réponses multiples incluses), avec une explication complète pour chaque option existante (A à E). Numérote "id" séquentiellement à partir de 1, sans trou.`;

/**
 * EXPLICATION_SYSTEM_PROMPT (imported above) is the shared, production-proven
 * prompt — NEVER edited directly, so the real per-course pipeline
 * (app/api/generate/explication/route.ts) is unaffected, same reasoning as
 * every other override in this file. The Studio mandate asks for a 10-15%
 * length reduction to cut AI cost WITHOUT losing medical depth, chapter
 * structure, or the clinical/magistral style — this override targets filler
 * specifically, never medical substance, so it's an APPEND, not a rewrite.
 */
const STUDIO_EXPLICATION_SYSTEM_PROMPT = `${EXPLICATION_SYSTEM_PROMPT}

SURCHARGE OBLIGATOIRE — CONCISION SANS PERTE DE PROFONDEUR : conserve intégralement la structure en chapitres, le niveau de détail médical, le style magistral et la rigueur clinique déjà exigés ci-dessus — RIEN de médical ne doit disparaître, aucun mécanisme, aucune notion du cours source ne doit être coupé ou résumé à l'excès. Réduis UNIQUEMENT le volume de mots consacré aux tournures rédactionnelles non-informatives : phrases de transition creuses, reformulations d'une idée déjà exprimée, adjectifs et adverbes de remplissage sans valeur clinique. Vise une réduction globale d'environ 10 à 15% du nombre de mots par rapport à une rédaction non filtrée, obtenue exclusivement en éliminant ce type de superflu rédactionnel.`;

/**
 * Same reasoning as STUDIO_EXPLICATION_SYSTEM_PROMPT above, lighter touch —
 * the mandate here is to keep every analogy and its full pedagogical
 * richness completely intact, trimming only the prose AROUND them.
 */
const STUDIO_EXEMPLES_ANALOGIES_SYSTEM_PROMPT = `${EXEMPLES_ANALOGIES_SYSTEM_PROMPT}

SURCHARGE OBLIGATOIRE — LÉGER ÉLAGAGE (remplace toute consigne de longueur ci-dessus) : garde intégralement chaque analogie, son ton Darija+français, et sa richesse pédagogique — aucune analogie ni aucune notion du cours ne doit disparaître. Allège légèrement UNIQUEMENT les phrases qui entourent les analogies (transitions, répétitions d'une idée déjà illustrée) pour réduire modestement le volume total, sans jamais sacrifier la clarté, le ton ou la profondeur qui caractérisent cette section.`;

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

// explication: deliberately reset to 32000 — explicit product decision to
// accept the higher one-time cost (~$0.21 on STUDIO_MODEL = Sonnet 5) for a
// genuinely massive, zero-truncation-risk course explication. This is the
// ONE section where a large, expensive ceiling is an intentional choice,
// not an unmeasured default.
//
// The other 4 sections: checked against REAL past generations already
// stored in studio_content_cache (a local, read-only Supabase query — zero
// OpenRouter tokens spent to check this): estimated real completion-token
// usage (chars/4) ranged from ~5,400 (exemples_analogies) to ~12,747
// (cas_clinique), all well under 32,000. Lowered to 20,000 — roughly 1.6x
// the highest real value observed (cas_clinique), a real safety margin
// rather than a tight fit, given the sample was thin (n=1 for 3 of the 5
// sections) and a bigger/longer real course could legitimately need more
// than what's been generated so far. Re-check with more real data as
// studio_content_cache accumulates more entries.
export const STUDIO_PROMPT_CONFIG: Record<DemoSectionId, StudioPromptConfig> = {
  explication: { systemPrompt: STUDIO_EXPLICATION_SYSTEM_PROMPT, maxTokens: 32000 },
  resume: { systemPrompt: STUDIO_RESUME_SYSTEM_PROMPT, maxTokens: 20000 },
  cas_clinique: { systemPrompt: STUDIO_CAS_CLINIQUE_SYSTEM_PROMPT, maxTokens: 20000 },
  qcm: { systemPrompt: STUDIO_QCMS_SYSTEM_PROMPT, maxTokens: 20000 },
  exemples_analogies: { systemPrompt: STUDIO_EXEMPLES_ANALOGIES_SYSTEM_PROMPT, maxTokens: 20000 },
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
 * Builds the system message's content blocks: the course's full raw text as
 * its OWN `cache_control: ephemeral`-marked block, FIRST — followed by the
 * tile's per-section instructions as a second, uncached block.
 *
 * Was previously ONE flat string, course text embedded in the MIDDLE
 * (instructions -> course text -> trailing directive), sent as a plain
 * string with no cache_control at all — meaning generating Explication,
 * then Résumé, then Cas Clinique, then QCM, then Exemples/Analogies for the
 * SAME course resent the exact same course text (up to
 * MAX_SOURCE_CHARS=60,000 chars) at FULL price, once per section, even
 * though it never changes between those calls. That's the dominant driver
 * of "generating a whole course's Studio tiles costs $X" for a long course —
 * not any one section's own cost, but paying full price for the same input
 * block five separate times.
 *
 * The course-content block MUST come first (not interleaved with
 * per-section instructions, which differ every call) for Anthropic's cache
 * to be reused ACROSS different section types: cache matching is an exact-
 * prefix match, so anything section-specific before the cached block would
 * invalidate reuse for every other section. Mirrors
 * lib/course-generation-shared.ts's buildSectionMessages (the legacy
 * courses-table pipeline), which already does exactly this.
 */
export function buildStudioSystemMessage(actionType: DemoSectionId, courseContent: string, overrideBasePrompt?: string): ContentBlock[] {
  const basePrompt = overrideBasePrompt ?? STUDIO_PROMPT_CONFIG[actionType].systemPrompt;
  return [
    {
      type: "text",
      text: `Voici le texte intégral du cours :\n\n${courseContent}`,
      // ttl: "1h" (vs. the default 5 min) — a student browsing Studio's
      // multiple windows (Explication, then Résumé, then Cas Clinique...)
      // very plausibly takes longer than 5 minutes reading/deciding between
      // clicks; the default TTL would silently turn every one of those
      // later sections into a fresh, full-price cache WRITE instead of a
      // cheap cache READ. Same reasoning already applied to the course chat
      // route (app/api/courses/chat/route.ts) — verified live against
      // OpenRouter's docs: 1h costs more to write (2x vs 1.25x) but reads
      // are still ~90% off regardless, and the absolute cost delta on one
      // write is worth it the moment even one more section reads from it.
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
    {
      type: "text",
      text: `${basePrompt}\n\nBasé strictement sur ce texte, génère le contenu demandé, au format JSON exact spécifié ci-dessus, sans jamais inventer d'information absente de ce texte.`,
    },
  ];
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
