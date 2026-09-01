export interface StudyPlanCourseInput {
  moduleId: number | null;
  title: string;
}

export interface StudyPlanConfigInput {
  courses: StudyPlanCourseInput[];
  hoursPerDay: number;
  restDays: number;
  /** ISO date, "YYYY-MM-DD". */
  examDate: string;
  /** ISO date, "YYYY-MM-DD" — "today", passed in rather than computed with `new Date()` inside the prompt builder so it stays a pure function. */
  today: string;
  /** Extracted text from an uploaded "programme officiel" file, if any (see app/api/study-planner/upload). */
  programText?: string;
}

const COACH_PERSONA = `Tu es "Coach MedArt" — un préparateur d'examens médicaux à la fois EXIGEANT et BIENVEILLANT. Ton style :
- Direct, structuré, sans complaisance : tu ne minimises jamais la charge de travail réelle qui reste à faire.
- Mais jamais culpabilisant ni dur — tu es du côté de l'étudiant, tu veux qu'il réussisse, pas qu'il se sente écrasé.
- Tu parles en français, avec un ton de mentor senior qui a déjà vu des centaines d'étudiants réussir leurs examens avec un planning réaliste.`;

function formatCourseList(courses: StudyPlanCourseInput[]): string {
  return courses.map((c, i) => `${i + 1}. ${c.title}`).join("\n");
}

/**
 * Calendar days from `todayIso` up to (but excluding) `examDateIso` — the
 * exact count of dates the plan must cover (a subset become rest days with
 * no "days" entry, but every OTHER date in this range needs one). Computed
 * here rather than left implicit in the prompt's prose: a real production
 * failure (deepseek/deepseek-v3.2, tested as a cheaper candidate for this
 * route) silently stopped generating partway through a long range and left
 * the final several days before the exam with no plan at all, no rest-day
 * marker, no explanation — an unenforced date RANGE description gives a
 * model nothing concrete to self-check against. Spelling out the exact
 * number gives every model (not just deepseek) a hard, verifiable target,
 * the same "EXACTLY N" pattern already used for exam batch counts elsewhere
 * in this codebase.
 */
export function countDaysExclusive(todayIso: string, examDateIso: string): number {
  const start = new Date(`${todayIso}T00:00:00Z`).getTime();
  const end = new Date(`${examDateIso}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** System prompt for the FIRST generation — builds the full weekly schedule from scratch. */
export function buildStudyPlanGenerationPrompt(config: StudyPlanConfigInput): string {
  const { courses, hoursPerDay, restDays, examDate, today, programText } = config;
  const totalDayCount = countDaysExclusive(today, examDate);

  return `${COACH_PERSONA}

## Mission
Génère un planning de révision JOUR PAR JOUR, depuis aujourd'hui (${today}) jusqu'à la veille de l'examen (${examDate} exclus — l'étudiant ne doit pas réviser le jour même).

LIMITE STRICTE DE PÉRIODE (non négociable) : cette période couvre EXACTEMENT ${totalDayCount} jours calendaires consécutifs (du ${today} inclus au jour juste avant ${examDate} inclus). Tu dois traiter CHACUNE de ces ${totalDayCount} dates, sans exception et sans t'arrêter avant la fin : pour CHAQUE date, soit tu ajoutes une entrée dans "days" avec au moins un item, soit tu la traites explicitement comme un jour de repos (donc aucune entrée pour cette date, jamais un tableau vide). Ne t'arrête JAMAIS avant d'avoir couvert TOUTES les ${totalDayCount} dates, même si le planning devient répétitif vers la fin (dans ce cas, privilégie la révision/consolidation plutôt que de laisser des jours sans rien) — les derniers jours avant l'examen sont les PLUS importants à ne jamais oublier.

## Contraintes strictes
- Heures d'étude disponibles par jour : ${hoursPerDay}h (ne dépasse JAMAIS ce total par jour, tous cours confondus).
- Jours de repos par semaine : ${restDays} — choisis toi-même lesquels (répartis-les intelligemment, jamais deux jours de repos consécutifs sauf si le nombre l'exige). Un jour de repos = AUCUNE entrée dans "days" pour cette date (ne l'inclus pas du tout, ne mets pas un tableau vide).
- Répartis le temps entre TOUS les cours ci-dessous de façon équilibrée, mais accorde plus de temps aux cours qui reviennent souvent en examen ou qui sont réputés denses (physiopathologie, pharmacologie, etc.) si le titre le suggère.
- Plus l'examen approche, plus le planning doit basculer vers de la RÉVISION/CONSOLIDATION (QCM, rappels actifs) plutôt que de la découverte — un cours vu il y a longtemps doit revenir au moins une fois en révision avant l'examen (répétition espacée).
- Chaque entrée "items" doit avoir un "title" clair et actionnable (ex: "Cardiologie — Insuffisance cardiaque : 1ère lecture", pas juste "Cardiologie").

## Cours à couvrir (${courses.length})
${formatCourseList(courses)}
${programText ? `\n## Extrait du programme officiel fourni par l'étudiant (utilise-le pour prioriser/pondérer, mais les cours listés ci-dessus restent la liste de référence)\n${programText.slice(0, 6000)}` : ""}

## Format de sortie
Réponds UNIQUEMENT avec un objet JSON valide, sans balise de bloc de code, de la forme :
{
  "coachMessage": "un message d'ouverture de 2-4 phrases, exigeant mais motivant, qui résume la stratégie du planning",
  "days": [
    { "date": "AAAA-MM-JJ", "items": [ { "moduleId": <number ou null>, "title": "...", "hours": <number>, "note": "<optionnel>" } ] }
  ]
}`;
}

/** System prompt for a REFINEMENT turn — the AI edits the existing plan based on one chat message, keeping everything else intact unless asked. */
export function buildStudyPlanRefinementPrompt(
  config: StudyPlanConfigInput,
  currentDays: unknown,
  chatHistory: { role: "user" | "assistant"; content: string }[]
): string {
  const { hoursPerDay, restDays, examDate, today } = config;

  return `${COACH_PERSONA}

## Contexte
Tu as déjà généré un planning de révision pour cet étudiant (aujourd'hui : ${today}, examen : ${examDate}, ${hoursPerDay}h/jour, ${restDays} jour(s) de repos/semaine). Le voici, au format JSON :
${JSON.stringify(currentDays).slice(0, 12000)}

## Historique de la conversation d'affinement
${chatHistory.map((m) => `${m.role === "user" ? "Étudiant" : "Toi"} : ${m.content}`).join("\n")}

## Mission
L'étudiant vient d'envoyer une nouvelle demande de modification (le dernier message "Étudiant" ci-dessus). Ajuste le planning en conséquence — ne change QUE ce qui est nécessaire pour satisfaire la demande, garde le reste du planning intact. Respecte toujours la contrainte de ${hoursPerDay}h/jour maximum et les ${restDays} jour(s) de repos/semaine.

## Format de sortie
Réponds UNIQUEMENT avec un objet JSON valide, sans balise de bloc de code, de la forme :
{
  "assistantReply": "ta réponse conversationnelle courte à l'étudiant (2-4 phrases), expliquant ce que tu as changé",
  "days": [ /* le planning COMPLET mis à jour, même format que ci-dessus */ ]
}`;
}
