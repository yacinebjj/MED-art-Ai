import type { DemoSectionId } from "@/lib/demo-content";
import {
  CAS_CLINIQUE_SYSTEM_PROMPT,
  EXEMPLES_ANALOGIES_SYSTEM_PROMPT,
  EXPLICATION_SYSTEM_PROMPT,
  MIND_MAP_SYSTEM_PROMPT,
  QCMS_SYSTEM_PROMPT,
  RESUME_SYSTEM_PROMPT,
} from "@/lib/prompts/public-course-sections";

/**
 * The Studio pipeline for the generic curriculum module workspace
 * (app/dashboard/module/[id]/page.tsx) — "Option A": reuses the same
 * production-proven, JSON-schema system prompts that generate real Supabase
 * courses (lib/prompts/public-course-sections.ts — the ones "La Pleurésie"
 * and "Gastrite" were themselves generated with) for explication and
 * exemples_analogies unmodified, and overrides résumé/cas clinique/QCM/mind
 * map with additional Golden Standard mandates — always by APPENDING to the
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

/**
 * Mind Map — Golden Standard hybrid, v7 (= v5, restored). v6 ("AI
 * Infographic Image Pipeline" — a single Ideogram image with the whole
 * poster's text baked in) was tried for real and produced exactly the
 * failure this codebase already had 3 documented prior attempts of: garbled
 * title ("OTITTÉ MÉDICAL AIGUÀ" instead of "OTITE MOYENNE AIGUË"), every
 * label unreadable/invented, and the requested layout (cascade, protocol
 * grid, warning box) ignored outright by the model. Seen firsthand, then
 * reverted back to this hybrid on the client's own instruction.
 *
 * Split of responsibilities:
 *  1. The RELIABLE part — this prompt's {nodes, links} extraction, each
 *     node short-labeled (2-5 words) and tagged with its own specific icon
 *     — renders as HTML (DynamicMindMapStudio: sticker clusters, a numbered
 *     mechanism cascade, a numbered treatment protocol grid, a red warning
 *     box built from complications) via lib/lucide-icon-lookup.ts, never
 *     dependent on an external image model getting clinical terminology
 *     right.
 *  2. The Ideogram part is an EXTRA field on the same object,
 *     "ideogram_prompt" — explicitly required to contain "no text, no
 *     letters, no words, no numbers anywhere in the image", since every
 *     documented failure (3 before, now 4) was specifically about
 *     rendering TEXT. An image that never asks for text cannot fail that
 *     way. app/api/studio/generate/route.ts calls Ideogram with this prompt
 *     and fails OPEN — the HTML board still renders even if the image call
 *     errors, a bonus accent illustration, never a blocker.
 */
const STUDIO_MIND_MAP_SYSTEM_PROMPT = `${MIND_MAP_SYSTEM_PROMPT}

SURCHARGE OBLIGATOIRE — FORMAT "MASTERCLASS INFOGRAPHIC" (renforce, sans jamais réduire, le nombre de nœuds/liens demandé ci-dessus) : le rendu final est une planche d'infographie unique, sans le moindre défilement — chaque "label" de nœud DOIT donc être un mot-clé ou une expression ultra-courte de 2 À 5 MOTS MAXIMUM, jamais une phrase complète ni une explication. Chaque "label" de lien (la relation entre deux nœuds) doit être UN SEUL VERBE OU UNE EXPRESSION DE 1 À 3 MOTS ("cause", "révèle", "traite", "se complique en"...), jamais une justification développée. Si un concept est complexe, découpe-le en plusieurs nœuds courts reliés entre eux plutôt que d'écrire un label long.

SURCHARGE OBLIGATOIRE — UNE ICÔNE PAR NŒUD (ajoute un champ "icon" à CHAQUE objet du tableau "nodes", en plus de "id"/"label"/"type") : choisis, pour CHAQUE nœud individuellement, l'icône qui représente le MIEUX son contenu spécifique — jamais un choix générique basé uniquement sur "type", mais sur le sens précis du "label" (ex : un nœud sur la fièvre → "flame" ou "thermometer" ; un nœud sur une bactérie → "bug" ; un nœud sur le cerveau/système nerveux → "brain" ; un nœud sur une piqûre/injection/vaccin → "syringe" ; un nœud sur un examen de laboratoire → "microscope" ou "test-tube" ; un nœud sur l'oreille → "ear" ; un nœud sur l'œil → "eye" ; un nœud sur un délai/une urgence → "clock" ou "hourglass" ; un nœud sur un saignement/liquide → "droplet" ; un nœud sur une fracture/os → "bone" ; un nœud sur un décès/gravité extrême → "skull" ; un nœud sur une alerte grave → "shield-alert" ou "siren" ; un nœud sur un nourrisson/enfant → "baby" ; un nœud sur un traitement médicamenteux → "pill". La valeur de "icon" doit être EXACTEMENT l'une de ces chaînes (kebab-case) : shield, bug, pill, flame, stethoscope, activity, alert-triangle, bar-chart-3, check-circle-2, wind, zap, heart-pulse, brain, thermometer, syringe, microscope, ear, eye, droplet, clock, skull, waves, baby, bone, test-tube, siren, scan-line, heart-crack, shield-alert, hourglass. N'utilise JAMAIS la même icône pour tous les nœuds d'une même section — varie-la selon le contenu réel de chaque label.

SURCHARGE OBLIGATOIRE (ajoute un champ supplémentaire à l'objet "mind_map" ci-dessus — ne retire et ne modifie RIEN d'autre) : ajoute un champ "ideogram_prompt" contenant un prompt de génération d'image en ANGLAIS, destiné à l'API Ideogram, décrivant une illustration PUREMENT CONCEPTUELLE, ARTISTIQUE ET SYMBOLIQUE du sujet central du cours (métaphore visuelle, ambiance, formes, couleurs, composition picturale) — inspirée du sujet mais jamais un diagramme, jamais une infographie.

RÈGLE ABSOLUE ET NON NÉGOCIABLE POUR "ideogram_prompt" : cette image ne doit contenir STRICTEMENT AUCUN TEXTE, AUCUNE LETTRE, AUCUN MOT, AUCUN CHIFFRE, AUCUNE ÉTIQUETTE, nulle part dans l'image. Inclus littéralement dans le prompt la phrase "no text, no letters, no words, no numbers, no labels anywhere in the image". Décris uniquement des formes organiques ou abstraites, une palette de couleurs médicale cohérente, et une composition visuelle évocatrice du sujet (ex : pour une pathologie pulmonaire, des formes évoquant des poumons stylisés et des particules flottantes symbolisant l'inflammation, sans aucun mot nulle part). Le prompt doit faire au moins 80 mots et être entièrement en anglais.

Schéma exact (complet, avec les champs ajoutés) :
{
  "mind_map": {
    "nodes": [
      { "id": "n1", "label": "...", "type": "symptome", "icon": "flame" },
      { "id": "n2", "label": "...", "type": "mecanisme", "icon": "brain" }
    ],
    "links": [
      { "source": "n1", "target": "n2", "label": "..." }
    ],
    "ideogram_prompt": "Purely artistic, symbolic illustration, no text, no letters, no words, no numbers, no labels anywhere in the image, describing shapes, colors and composition evoking the course's central medical concept."
  }
}`;

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

/** Only the 6 tiles the existing Studio UI actually renders (lib/demo-content.ts's DEMO_SECTIONS) get a prompt — there is no 7th tile to add one for. */
export const STUDIO_PROMPT_CONFIG: Record<DemoSectionId, StudioPromptConfig> = {
  explication: { systemPrompt: EXPLICATION_SYSTEM_PROMPT, maxTokens: 32000 },
  resume: { systemPrompt: STUDIO_RESUME_SYSTEM_PROMPT, maxTokens: 32000 },
  cas_clinique: { systemPrompt: STUDIO_CAS_CLINIQUE_SYSTEM_PROMPT, maxTokens: 32000 },
  qcm: { systemPrompt: STUDIO_QCMS_SYSTEM_PROMPT, maxTokens: 32000 },
  // 8000: a full 15-25 node graph with a per-node icon field AND a separate
  // descriptive Ideogram prompt in the same JSON object comfortably fits.
  mind_map: { systemPrompt: STUDIO_MIND_MAP_SYSTEM_PROMPT, maxTokens: 8000 },
  exemples_analogies: { systemPrompt: EXEMPLES_ANALOGIES_SYSTEM_PROMPT, maxTokens: 32000 },
};

/** Maps each Studio tile id to the top-level JSON key its prompt actually returns. "qcm" is the one mismatch — DEMO_SECTIONS uses the singular tile id, but QCMS_SYSTEM_PROMPT (shared with production) returns the plural "qcms" key. */
export const STUDIO_SECTION_KEYS: Record<DemoSectionId, string> = {
  explication: "explication",
  resume: "resume",
  cas_clinique: "cas_clinique",
  qcm: "qcms",
  mind_map: "mind_map",
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
