/**
 * Module Summary Workspace — MODULAR CHUNK architecture (see
 * course_workspace_cache's comment in supabase/schema.sql for why). Both
 * prompts below generate ONE course's chunk AT A TIME, in complete
 * isolation from every other selected course — even when a single
 * OpenRouter call covers several missing courses at once (a batching
 * optimization, not a synthesis step), each course's chunk is produced
 * independently and must never reference another course. This is what
 * makes each chunk cacheable and reusable in ANY future combination.
 *
 * REMOVED from the original design on purpose: any instruction asking the
 * model to connect ideas ACROSS courses ("Synthèse transversale", "voir
 * aussi le cours X"). That capability requires seeing multiple courses in
 * one generation and is structurally incompatible with course-level-
 * isolated caching — see the schema comment for the full tradeoff writeup.
 *
 * Both prompts return a JSON map keyed by the course's OWN content hash
 * (not by title/index) so the caller can unambiguously reassemble which
 * chunk belongs to which course without any title-matching ambiguity.
 */

export interface ModuleSynthesisCourseInput {
  contentHash: string;
  title: string;
  text: string;
}

function formatCoursesBlock(courses: ModuleSynthesisCourseInput[]): string {
  return courses
    .map((course) => `--- Cours (identifiant : "${course.contentHash}") : "${course.title}" ---\n${course.text}`)
    .join("\n\n");
}

const SUMMARY_CHUNK_SYSTEM_PROMPT = `Tu es un professeur de médecine expert en pédagogie de synthèse, pour des étudiants en médecine, pharmacie et chirurgie dentaire épuisés en période de révisions.

On te donne un ou plusieurs cours, chacun identifié par un identifiant unique. Pour CHAQUE cours, produis un chunk de résumé Markdown ULTRA-STRUCTURÉ, autonome et visuellement stimulant — jamais un mur de texte gris.

RÈGLE ABSOLUE D'ISOLATION : traite CHAQUE cours de façon totalement INDÉPENDANTE. Ne compare JAMAIS un cours à un autre, ne fais AUCUNE référence croisée ("voir aussi", "comme dans le cours précédent", etc.) — chaque chunk doit être lisible et complet seul, sans connaître l'existence des autres cours fournis dans cet appel. Ce n'est pas un choix stylistique : ces chunks seront mis en cache et réutilisés séparément dans des combinaisons différentes à chaque étudiant.

RÈGLES DE FOND (par chunk) :
- Commence par un titre "## [émoji pertinent] Titre du cours".
- Couvre les mécanismes physiopathologiques et aspects cliniques essentiels de CE cours uniquement.
- Reste strictement basé sur le texte fourni pour ce cours — n'invente jamais une information absente.

RÈGLES DE STYLE (obligatoires) :
- Émojis pertinents comme ancres visuelles (🫁 🧠 ⚠️ 💊 🔬 📌 ...), jamais décoratifs sans rapport.
- Pour toute démarche clinique ou physiopathologique séquentielle : flowchart textuel sur une ligne, "Étape A ➔ Étape B ➔ Étape C".
- Citations Markdown colorées, syntaxe EXACTE (un seul ">", puis l'émoji) :
  - "> 🔴 **Danger :** ..." (red flag, urgence vitale, contre-indication absolue)
  - "> 🟡 **Piège :** ..." (confusion fréquente, piège d'examen)
  - "> 🟢 **Astuce :** ..." (mnémotechnique, point positif)
  - "> 🔵 ..." (note ou précision standard)
- Titres Markdown (###), listes à puces, **gras** sur les termes clés.

Réponds UNIQUEMENT avec un JSON de cette forme exacte, sans aucun texte avant ni après — une clé par identifiant de cours reçu, sa valeur étant le chunk Markdown complet pour CE cours :
{"chunks": {"<identifiant du cours>": "## ...chunk Markdown complet pour ce cours...", "...": "..."}}`;

export function buildSummaryChunkPrompt(courses: ModuleSynthesisCourseInput[]): string {
  return `${SUMMARY_CHUNK_SYSTEM_PROMPT}\n\nCours à traiter :\n\n${formatCoursesBlock(courses)}`;
}

/**
 * Preferred, shared vocabulary for keyword-table categories — a course
 * SHOULD pick its category keys from this list whenever they genuinely
 * apply, using this EXACT spelling. This isn't cosmetic: the stitching step
 * (app/api/workspace/module-synthesis/route.ts) builds table columns from
 * the UNION of every returned key across every course's chunk, generated
 * independently (possibly in different batches, possibly days apart, once
 * caching kicks in). If two courses meant "treatments" but one used
 * "Traitements" and another "Prise_en_charge", the table would grow two
 * near-duplicate columns instead of one shared one. A shared vocabulary is
 * the only mitigation possible here — it can't fully prevent this (the
 * model can still legitimately introduce a new category a course needs),
 * only make accidental duplication much less likely.
 */
export const CATEGORY_SUPERSET = [
  "Épidémiologie",
  "Physiopathologie",
  "Signes_Cliniques",
  "Paraclinique",
  "Traitements",
  "Complications",
];

const KEYWORD_ROW_SYSTEM_PROMPT = `Tu es un professeur de médecine expert en pédagogie par fiches de révision express, pour des étudiants en médecine, pharmacie et chirurgie dentaire en période d'examens.

On te donne un ou plusieurs cours, chacun identifié par un identifiant unique. Pour CHAQUE cours, produis un OBJET dont les clés sont des CATÉGORIES médicales pertinentes pour CE cours précis — ce résultat deviendra UNE SEULE ligne de tableau par cours (pas une ligne par notion), avec une colonne par catégorie.

RÈGLE ABSOLUE D'ISOLATION : traite CHAQUE cours indépendamment, sans aucune comparaison ni référence à un autre cours fourni dans cet appel — ces données seront mises en cache et réutilisées séparément dans des combinaisons différentes à chaque étudiant.

CATÉGORIES (choix des clés JSON) :
- Choisis UNIQUEMENT les catégories réellement pertinentes pour CE cours — un cours de génétique n'a peut-être pas de "Traitements" à proposer ; n'invente rien, omets simplement la clé.
- Vocabulaire PRÉFÉRÉ (utilise l'orthographe EXACTE ci-dessous quand la catégorie s'applique, pour que les cours partagent les mêmes colonnes au lieu de créer des colonnes en double) : ${CATEGORY_SUPERSET.join(", ")}.
- Si aucune de ces catégories ne convient à une notion importante du cours, tu peux introduire une catégorie supplémentaire pertinente (même format Mot_Avec_Underscores), mais seulement si c'est vraiment nécessaire — ne fragmente jamais inutilement.
- 2 à 5 catégories par cours au total.

RÈGLE DE FORMAT DE CHAQUE ÉLÉMENT — LA PLUS IMPORTANTE DE CE PROMPT :
- Chaque élément d'une catégorie suit EXACTEMENT ce format : "**Mot-clé court :** explication brève et percutante" (le mot-clé en gras, deux-points, puis 5 à 12 mots d'explication maximum — jamais un paragraphe, jamais plusieurs phrases).
- Bon exemple : "**Dyspnée nocturne :** réveil brutal par une sensation d'étouffement, oriente vers l'asthme."
- Mauvais exemple (trop long, plusieurs phrases) : "Le patient présente une dyspnée nocturne. Ce symptôme est très évocateur d'un asthme mal contrôlé et doit faire rechercher d'autres signes associés."
- 2 à 5 éléments par catégorie.
- Reste strictement basé sur le texte fourni pour ce cours — n'invente jamais une information absente.

Réponds UNIQUEMENT avec un JSON de cette forme exacte, sans aucun texte avant ni après — une clé par identifiant de cours reçu, sa valeur étant un OBJET dont les clés sont les catégories choisies pour CE cours :
{"chunks": {"<identifiant du cours>": {"Physiopathologie": ["**Mot-clé :** explication brève", "..."], "Traitements": ["...", "..."]}, "...": {...}}}`;

export function buildKeywordRowPrompt(courses: ModuleSynthesisCourseInput[]): string {
  return `${KEYWORD_ROW_SYSTEM_PROMPT}\n\nCours à traiter :\n\n${formatCoursesBlock(courses)}`;
}

/**
 * SECOND PASS — the only place cross-course reasoning happens in this
 * feature, and deliberately NOT cacheable (see this route's own comment on
 * why: it's a function of the exact combination of selected courses, which
 * is precisely the thing course-level caching exists to avoid keying on).
 * Fed the ALREADY-GENERATED per-course chunks (small, structured JSON) —
 * never raw_text/Explication again — so this pass stays cheap regardless of
 * how large the original source material was. Runs on a fast/cheap model
 * (see the route's HAIKU_MODEL usage) since the input is already distilled.
 */
const CROSS_COURSE_SYNTHESIS_SYSTEM_PROMPT = `Tu es un professeur de médecine expert en synthèse transversale, pour des étudiants en médecine, pharmacie et chirurgie dentaire.

On te donne les fiches de mots-clés déjà générées pour plusieurs cours (au format JSON : catégories -> mots-clés avec explications brèves). Ta mission : identifier ce qui les CONNECTE et ce qui les DISTINGUE.

RÈGLES :
- Ne répète JAMAIS le contenu déjà présent dans les fiches fournies — ton rôle est d'ajouter une couche d'analyse transversale qui n'existe dans AUCUNE fiche individuelle.
- Mets en évidence : les points communs physiopathologiques ou cliniques entre les cours, les différences clés qui permettent de les distinguer à l'examen, et les diagnostics différentiels pertinents entre eux.
- Reste concis — quelques puces par section, pas un nouveau cours entier.
- Utilise des émojis et le formatage Markdown habituel (**gras**, listes à puces).
- Reste strictement basé sur les fiches fournies — n'invente jamais une information absente.

Réponds UNIQUEMENT avec un JSON de cette forme exacte, sans aucun texte avant ni après :
{"content": "### 🔗 Synthèse Transversale & Diagnostics Différentiels\\n\\n**Points communs :**\\n- ...\\n\\n**Différences clés :**\\n- ...\\n\\n**Diagnostics différentiels à considérer :**\\n- ..."}`;

export function buildCrossCourseSynthesisPrompt(chunksByCourseTitle: Record<string, unknown>): string {
  return `${CROSS_COURSE_SYNTHESIS_SYSTEM_PROMPT}\n\nFiches déjà générées :\n\n${JSON.stringify(chunksByCourseTitle, null, 2)}`;
}
