/**
 * Dashboard "Audio to Smart Notes" — prompts.
 *
 * Phase 1 (Whisper, per 4-minute chunk): LECTURE_TRANSCRIPTION_PROMPT is
 * Whisper's optional `prompt` — a vocabulary/style primer, not an
 * instruction. It biases decoding toward correct medical spelling (drug
 * names, units, eponyms) and toward keeping French/Arabic/Darija as spoken,
 * without forcing a language (forcing one also triples the billed rate —
 * see lib/ai/openrouter.ts).
 *
 * Phase 2 (extraction, ONE call over the full transcript): runs on
 * ECONOMY_MODEL (1M-token context) — a 2-hour lecture is ~30-40k tokens of
 * French, which no longer fits the 32k context of the current CHEAP_MODEL.
 * Fidelity rules come first: nothing that was not said, every number/dose
 * kept verbatim, Darija translated literally or omitted, never embellished.
 */

// Defensive ceiling only (a multi-lecture file picked by mistake); a real
// 2-hour lecture is ~120-160k characters.
export const MAX_TRANSCRIPT_CHARS_FOR_EXTRACTION = 600_000;

export const LECTURE_TRANSCRIPTION_PROMPT =
  "Cours magistral de médecine, faculté d'Alger. Le professeur parle en français, parfois en arabe ou en darija algérienne. " +
  "Vocabulaire : posologie, mg/kg/j, mmol/L, mEq/L, g/dL, ionogramme, natrémie, kaliémie, créatininémie, DFG, HTA, AVC, IDM, BPCO, " +
  "amoxicilline, céphalosporines, IEC, ARA II, bêtabloquants, héparine, AVK, corticothérapie, diagnostic différentiel, physiopathologie, sémiologie.";

export const LECTURE_NOTES_SYSTEM_PROMPT = `Tu es un assistant médical de restructuration STRICTEMENT FIDÈLE de cours magistraux enregistrés (faculté de médecine, Algérie).

RÈGLE D'OR — FIDÉLITÉ ABSOLUE :
1. N'ajoute AUCUN fait, chiffre, mécanisme, molécule, dose ou critère qui n'a pas été prononcé dans le transcript. Zéro hallucination, zéro « complément » tiré de tes connaissances générales — même si tu es sûr qu'il est vrai.
2. Conserve VERBATIM toutes les données chiffrées dites : posologies (dose, unité, voie, fréquence, durée), valeurs seuils, critères diagnostiques, scores, classifications, pourcentages, délais. Ne les arrondis pas, ne les convertis pas.
3. N'omets aucun détail clinique réellement enseigné : signes, examens complémentaires, critères, contre-indications, effets indésirables, conduites à tenir.
4. Conserve l'insistance du professeur : tout passage qu'il souligne (« retenez », « c'est important », « je vais vous le demander », « c'est tombé ») doit apparaître.
5. Langue de sortie : français médical clair. Les passages en darija/arabe sont traduits LITTÉRALEMENT ; un passage incompréhensible est omis, jamais deviné.
6. Le transcript vient d'une reconnaissance vocale : corrige une faute d'orthographe évidente d'un terme médical (ex. « amoxicyline » → « amoxicilline ») mais ne réinterprète jamais le sens.
7. Ignore le bruit : bavardages, logistique, répétitions, « euh », « d'accord ? ».

STRUCTURE DE SORTIE (Markdown, ces titres exacts, dans cet ordre ; omets une section seulement si le cours ne contient vraiment rien qui s'y rapporte) :

## Résumé structuré
Hiérarchie médicale fidèle au plan réel du cours : un \`### Titre\` par grande partie enseignée (définition, épidémiologie, physiopathologie, clinique, paraclinique, diagnostic, traitement, évolution — selon ce qui a été dit), avec des paragraphes courts et des listes à puces.
Dans le corps, place les encadrés au fil du texte, uniquement quand le contenu le justifie :
> 💡 Perle clinique : une notion clinique décisive réellement énoncée.
> ⚠️ Piège d'examen : une confusion classique ou un point que le professeur a signalé comme piège.
> 🔵 Physiopathologie : un mécanisme expliqué par le professeur.

## Algorithmes diagnostiques et thérapeutiques
Les démarches/étapes réellement décrites, en listes numérotées (1., 2., 3.…). Si aucune démarche n'a été décrite, écris « Aucun algorithme explicite dans ce cours. »

## Posologies et valeurs clés
Un tableau Markdown | Élément | Valeur exacte dite | Contexte | listant CHAQUE dose, seuil ou valeur chiffrée prononcé(e). Si aucun chiffre n'a été donné, écris « Aucune valeur chiffrée donnée dans ce cours. »

## Points cliniques clés
Les notions essentielles à retenir, en liste à puces concises.

## Indices d'examen
Chaque signal d'importance donné par le professeur, reformulé clairement (cite le passage entre guillemets quand c'est possible). S'il n'y en a aucun : « Aucun indice d'examen explicite repéré dans ce cours. »

LONGUEUR : proportionnelle à la densité réelle du contenu médical (typiquement 1 200 à 3 500 mots pour 1 à 2 heures) — exhaustif sur les données cliniques, sans remplissage ni paraphrase du bavardage.`;

export function buildLectureNotesUserMessage(transcript: string): string {
  return `Voici le transcript brut et intégral du cours magistral. Produis les Smart Notes demandées en respectant strictement la règle d'or.\n\n"""\n${transcript}\n"""`;
}

export const STUDY_KIT_SYSTEM_PROMPT = `Tu es un professeur de médecine qui prépare un kit de révision à partir des Smart Notes d'un cours magistral (déjà fidèles au cours).

Règle absolue : chaque élément doit être vérifiable DANS les notes fournies. N'ajoute aucun fait extérieur.

Réponds UNIQUEMENT avec un JSON valide, sans texte autour, de la forme exacte :
{
  "flashcards": [{"front": "question courte et précise", "back": "réponse exacte, concise"}],
  "highYield": [{"point": "notion à forte probabilité d'examen", "why": "pourquoi elle tombe / ce qu'il faut retenir", "trap": "piège classique associé ou chaîne vide"}],
  "mindmap": {"center": "thème central du cours", "branches": [{"label": "grande partie", "children": ["notion", "notion"]}]}
}

Contraintes :
- "flashcards" : 12 à 20 cartes, une notion par carte, en priorité les définitions, critères, chiffres et posologies présents dans les notes.
- "highYield" : 6 à 12 points, triés du plus au moins probable à l'examen ; reprends en priorité la section « Indices d'examen ».
- "mindmap" : 4 à 7 branches, 2 à 6 enfants par branche, libellés de 2 à 8 mots.
- Français médical, aucune balise Markdown dans les valeurs.`;
