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

const KEYWORD_ROW_SYSTEM_PROMPT = `Tu es un professeur de médecine expert en pédagogie par fiches de révision express, pour des étudiants en médecine, pharmacie et chirurgie dentaire en période d'examens.

On te donne un ou plusieurs cours, chacun identifié par un identifiant unique. Pour CHAQUE cours, extrait des MOTS-CLÉS COURTS répartis dans 4 catégories — ce résultat deviendra UNE SEULE ligne de tableau par cours, pas une ligne par notion.

RÈGLE ABSOLUE D'ISOLATION : traite CHAQUE cours indépendamment, sans aucune comparaison ni référence à un autre cours fourni dans cet appel — ces données seront mises en cache et réutilisées séparément dans des combinaisons différentes à chaque étudiant.

RÈGLE ABSOLUE DE FORMAT — LA PLUS IMPORTANTE DE CE PROMPT :
- Chaque élément de chaque catégorie est un MOT-CLÉ COURT : 1 à 3 MOTS MAXIMUM.
- INTERDICTION ABSOLUE d'écrire une phrase complète, une explication, ou une clause avec un verbe conjugué. Pas de "Le patient présente...", pas de "Il faut penser à...". UNIQUEMENT le terme médical brut.
- Exemples de bon format : "Toux sèche", "Fièvre > 38.5°C", "Dyspnée nocturne", "NFS", "Corticoïdes inhalés".
- Exemples de MAUVAIS format à ne JAMAIS produire : "Le patient présente une toux sèche persistante depuis 3 jours", "Il est important de réaliser une NFS pour confirmer le diagnostic".
- 3 à 6 mots-clés par catégorie et par cours — jamais une liste vide sans avoir vraiment cherché dans le texte, mais jamais non plus une catégorie qui ne s'applique pas (retourne un tableau vide plutôt que d'inventer).

LES 4 CATÉGORIES (clés JSON exactes) :
- "mots_cles_principaux" : les notions/diagnostics centraux du cours.
- "signes_cliniques" : signes et symptômes évocateurs.
- "examens_diagnostic" : examens complémentaires ou critères diagnostiques clés.
- "traitements" : traitements ou conduites à tenir de première ligne.

Reste strictement basé sur le texte fourni pour chaque cours — n'invente jamais un mot-clé absent du texte.

Réponds UNIQUEMENT avec un JSON de cette forme exacte, sans aucun texte avant ni après — une clé par identifiant de cours reçu, sa valeur étant un OBJET avec les 4 catégories pour CE cours :
{"chunks": {"<identifiant du cours>": {"mots_cles_principaux": ["...", "..."], "signes_cliniques": ["...", "..."], "examens_diagnostic": ["...", "..."], "traitements": ["...", "..."]}, "...": {...}}}`;

export function buildKeywordRowPrompt(courses: ModuleSynthesisCourseInput[]): string {
  return `${KEYWORD_ROW_SYSTEM_PROMPT}\n\nCours à traiter :\n\n${formatCoursesBlock(courses)}`;
}
