/**
 * How ONE batch of the Studio « Examen QCM » is aimed at the course: its focus
 * zone (a contiguous slice of the course) and its accent. Pure text, no model
 * call — shared by the Studio's own batches (lib/ai/studio-qcm.ts) and by every
 * job of the Module exam (lib/exam-generation.ts, app/api/exam/run), so both
 * aim their questions with the very same words (2026-11-18: the exam used to
 * get neither a zone nor an accent, and drifted toward the obvious notions).
 */

/** The six accents of the Studio batches, in order. */
export const BATCH_ACCENTS = [
  "les mécanismes et les enchaînements de cause à conséquence",
  "les prédictions : ce qui se passe quand un élément est altéré, bloqué, absent ou en excès",
  "les mises en situation concrètes à interpréter avec les notions du cours",
  "la distinction entre notions proches que les étudiants confondent",
  "l'intégration entre parties du cours (mécanisme → signe → examen → conduite à tenir)",
  "les nuances, exceptions et conditions qui changent la conclusion",
] as const;

/** Below this, a course is too short to slice meaningfully — every batch sees all of it, with a different accent. */
export const MIN_CHARS_FOR_ZONES = 3_000;

/**
 * Cuts the course into `count` contiguous zones of similar length, each cut
 * moved to the next line break when one is close (else the next space), so a
 * zone never starts mid-word and rarely mid-paragraph.
 */
export function splitIntoFocusZones(text: string, count: number): string[] {
  const clean = text.trim();
  const size = clean.length / count;
  const cuts = [0];
  for (let i = 1; i < count; i++) {
    const ideal = Math.round(i * size);
    const lineBreak = clean.indexOf("\n", ideal);
    const space = clean.indexOf(" ", ideal);
    let cut = lineBreak !== -1 && lineBreak - ideal <= size * 0.2 ? lineBreak : space !== -1 ? space : ideal;
    cut = Math.max(cut, cuts[cuts.length - 1]);
    cuts.push(cut);
  }
  cuts.push(clean.length);
  return cuts.slice(0, -1).map((start, i) => clean.slice(start, cuts[i + 1]).trim());
}

/** « Accent de ce lot : … » — the Studio line, for the batch at `index` (any integer, wraps around). */
export function accentLine(index: number): string {
  const i = ((Math.trunc(index) % BATCH_ACCENTS.length) + BATCH_ACCENTS.length) % BATCH_ACCENTS.length;
  return `Accent de ce lot : ${BATCH_ACCENTS[i]} (au moins 2 questions dans cet esprit, les autres variées selon les types demandés).`;
}

/** The focus-zone block of a batch of `count` questions (the Studio's own text for its batches of 5). */
export function zoneBlock(zone: string, count: number): string {
  const central =
    count <= 1
      ? "Ta question porte sur une notion CENTRALE de cette zone — celle qu'un examinateur juge essentielle, jamais un détail anecdotique."
      : `Au moins ${count - 1} questions sur ${count} portent sur les notions CENTRALES de cette zone — celles qu'un examinateur juge essentielles, jamais un détail anecdotique.`;
  return `ZONE DE FOCUS de ce lot (extrait du cours ci-dessus ; les autres lots couvrent le reste du cours) :
<<<
${zone}
>>>

${central} Une question d'intégration peut relier cette zone au reste du cours. Si la zone ne contient que peu de contenu médical (sommaire, bibliographie, introduction), appuie-toi sur les notions du cours les plus proches de cette zone.`;
}

/** A batch without a zone: the Studio's text for a short course (the whole course, seen under the batch's accent). */
export const WHOLE_COURSE_BLOCK =
  "Le cours est court : couvre-le en entier, en choisissant ses notions centrales sous l'angle de l'accent ci-dessous — les autres lots, avec d'autres accents, testent les mêmes notions sous d'autres angles, donc ne te contente pas de l'angle le plus évident.";
