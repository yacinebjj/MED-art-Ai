import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import {
  buildResumeMasterclassSystemPrompt,
  buildResumeMasterclassUserMessage,
} from "@/lib/prompts/resume-masterclass";
import { MODE_VISUEL_SYSTEM_PROMPT, buildModeVisuelUserMessage } from "@/lib/prompts/mode-visuel";
import { buildCasCliniqueSystemPrompt, buildCasCliniqueUserMessage } from "@/lib/prompts/cas-clinique";
import { buildQcmBatchSystemPrompt, buildQcmBatchUserMessage } from "@/lib/prompts/qcm-batch";
import { buildQrocSystemPrompt, buildQrocUserMessage } from "@/lib/prompts/qroc";
import {
  PROFESSEUR_ORAL_SYSTEM_PROMPT,
  buildProfesseurOralUserMessage,
} from "@/lib/prompts/professeur-oral";
import {
  EXPLICATION_ULTRA_DETAILLEE_SYSTEM_PROMPT,
  buildExplicationUserMessage,
} from "@/lib/prompts/explication-ultra-detaillee";
import type { ClinicalCase, QcmItem, QrocItem, StudentProfile } from "@/lib/types";

const MAX_COURSE_CHARS = 60_000;

export class CourseGenerationError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function fromOpenRouterError(error: unknown): CourseGenerationError {
  if (error instanceof OpenRouterError) {
    return new CourseGenerationError(error.message, error.status);
  }
  console.error("Unexpected error calling OpenRouter", error);
  return new CourseGenerationError("Une erreur inattendue est survenue.", 500);
}

/** Strips an optional ```json fence the model sometimes adds despite instructions not to. */
function stripCodeFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(stripCodeFence(raw));
  } catch (error) {
    console.error("Failed to parse AI JSON output:", error, raw.slice(0, 500));
    throw new CourseGenerationError("L'IA a renvoyé une réponse invalide. Réessaie.", 502);
  }
}

/**
 * Generates "Résumé" — the Masterclass summary, Astuces mnémotechniques, and
 * categorized Pièges à l'examen, in one Markdown string. Split out of the
 * old 3-section mega-prompt so it gets its own dedicated call and full
 * output budget.
 */
export async function generateResumeMasterclass(
  courseText: string,
  student: StudentProfile
): Promise<string> {
  const truncatedText = courseText.slice(0, MAX_COURSE_CHARS);

  try {
    return await callOpenRouter([
      { role: "system", content: buildResumeMasterclassSystemPrompt(student) },
      { role: "user", content: buildResumeMasterclassUserMessage(truncatedText) },
    ]);
  } catch (error) {
    throw fromOpenRouterError(error);
  }
}

/**
 * Generates "Mode Visuel" — a Mermaid flowchart plus comparison tables, as
 * one Markdown string. The lightest of the 5 sections; no sub-chunking
 * needed. CenterReader renders the ```mermaid fence via MermaidDiagram.
 */
export async function generateModeVisuel(courseText: string): Promise<string> {
  const truncatedText = courseText.slice(0, MAX_COURSE_CHARS);

  try {
    return await callOpenRouter([
      { role: "system", content: MODE_VISUEL_SYSTEM_PROMPT },
      { role: "user", content: buildModeVisuelUserMessage(truncatedText) },
    ]);
  } catch (error) {
    throw fromOpenRouterError(error);
  }
}

function isClinicalCase(value: unknown): value is ClinicalCase {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.numero === "number" &&
    typeof v.archetype === "string" &&
    typeof v.titre === "string" &&
    typeof v.scene === "string" &&
    Array.isArray(v.vitals) &&
    Array.isArray(v.acte1) &&
    Array.isArray(v.acte2) &&
    Array.isArray(v.acte3) &&
    typeof v.acte4 === "object" &&
    v.acte4 !== null &&
    Array.isArray((v.acte4 as Record<string, unknown>).items) &&
    typeof v.acte5 === "object" &&
    v.acte5 !== null &&
    Array.isArray((v.acte5 as Record<string, unknown>).items)
  );
}

/**
 * Generates ONE "Cas Clinique" sub-unit (one archetype out of the 5 in
 * lib/sub-units.ts). Called once per case by the streaming route, in
 * parallel with the other 4 — never invoked for the whole tab at once.
 */
export async function generateCasCliniqueUnit(
  courseText: string,
  student: StudentProfile,
  archetype: string,
  numero: number
): Promise<ClinicalCase> {
  const truncatedText = courseText.slice(0, MAX_COURSE_CHARS);

  let raw: string;
  try {
    raw = await callOpenRouter([
      { role: "system", content: buildCasCliniqueSystemPrompt(student, archetype, numero) },
      { role: "user", content: buildCasCliniqueUserMessage(truncatedText) },
    ]);
  } catch (error) {
    throw fromOpenRouterError(error);
  }

  const parsed = parseJson(raw);
  if (!isClinicalCase(parsed)) {
    throw new CourseGenerationError(
      `Réponse incomplète de l'IA pour le cas clinique n°${numero}.`,
      502
    );
  }
  return parsed;
}

function isQcmItemArray(value: unknown): value is QcmItem[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const v = item as Record<string, unknown>;
    return (
      typeof v.id === "number" &&
      typeof v.question === "string" &&
      Array.isArray(v.options) &&
      Array.isArray(v.reponsesCorrectes) &&
      typeof v.explication === "object" &&
      v.explication !== null
    );
  });
}

/**
 * Generates ONE batch of QCM (see lib/sub-units.ts — 4 batches of 8 = 32
 * total). Called once per batch by the streaming route, in parallel.
 */
export async function generateQcmBatch(
  courseText: string,
  startId: number,
  count: number
): Promise<QcmItem[]> {
  const truncatedText = courseText.slice(0, MAX_COURSE_CHARS);

  let raw: string;
  try {
    raw = await callOpenRouter([
      { role: "system", content: buildQcmBatchSystemPrompt(startId, count) },
      { role: "user", content: buildQcmBatchUserMessage(truncatedText) },
    ]);
  } catch (error) {
    throw fromOpenRouterError(error);
  }

  const parsed = parseJson(raw);
  if (!isQcmItemArray(parsed)) {
    throw new CourseGenerationError(
      `Réponse incomplète de l'IA pour le lot de QCM ${startId}-${startId + count - 1}.`,
      502
    );
  }
  return parsed;
}

function isQrocItemArray(value: unknown): value is QrocItem[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      !!item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).id === "number" &&
      typeof (item as Record<string, unknown>).question === "string" &&
      typeof (item as Record<string, unknown>).reponseOfficielle === "string"
  );
}

/** Generates the QROC sub-unit — the small companion set to the QCM batches. */
export async function generateQroc(courseText: string, count: number): Promise<QrocItem[]> {
  const truncatedText = courseText.slice(0, MAX_COURSE_CHARS);

  let raw: string;
  try {
    raw = await callOpenRouter([
      { role: "system", content: buildQrocSystemPrompt(count) },
      { role: "user", content: buildQrocUserMessage(truncatedText) },
    ]);
  } catch (error) {
    throw fromOpenRouterError(error);
  }

  const parsed = parseJson(raw);
  if (!isQrocItemArray(parsed)) {
    throw new CourseGenerationError("Réponse incomplète de l'IA pour les QROC.", 502);
  }
  return parsed;
}

/**
 * Generates the "Cours Oral" transcript — the primary content shown in the
 * workspace's center reader, using the professeur-oral persona prompt.
 */
export async function generateCoursOral(courseText: string): Promise<string> {
  const truncatedText = courseText.slice(0, MAX_COURSE_CHARS);

  try {
    return await callOpenRouter([
      { role: "system", content: PROFESSEUR_ORAL_SYSTEM_PROMPT },
      { role: "user", content: buildProfesseurOralUserMessage(truncatedText) },
    ]);
  } catch (error) {
    throw fromOpenRouterError(error);
  }
}

/**
 * Generates "Explication Ultra-Détaillée" — a full medical treatise, not a
 * course summary. Its own dedicated call (raw Markdown, no JSON envelope)
 * because the Gold Standard quality bar for this section requires far more
 * volume than a shared call could reliably produce without truncation. The
 * system prompt has no personalization slots, so no student profile needed.
 */
export async function generateExplicationUltraDetaillee(courseText: string): Promise<string> {
  const truncatedText = courseText.slice(0, MAX_COURSE_CHARS);

  try {
    return await callOpenRouter([
      { role: "system", content: EXPLICATION_ULTRA_DETAILLEE_SYSTEM_PROMPT },
      { role: "user", content: buildExplicationUserMessage(truncatedText) },
    ]);
  } catch (error) {
    throw fromOpenRouterError(error);
  }
}
