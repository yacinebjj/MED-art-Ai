import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import {
  buildCourseGenerationSystemPrompt,
  buildCourseGenerationUserMessage,
} from "@/lib/prompts/course-generation";
import {
  PROFESSEUR_ORAL_SYSTEM_PROMPT,
  buildProfesseurOralUserMessage,
} from "@/lib/prompts/professeur-oral";
import type { CourseContent, StudentProfile } from "@/lib/types";

const MAX_COURSE_CHARS = 60_000;

const REQUIRED_KEYS: (keyof CourseContent)[] = [
  "explication",
  "resume",
  "pieges",
  "astuces",
  "casClinique",
  "qcm",
];

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

/**
 * Generates the 6 Studio sections (Explication, Résumé, Pièges, Astuces,
 * Cas Clinique, QCM) in a single call — this is what powers every Studio
 * button except "Cours Oral". Only invoked on a cache miss (see
 * lib/course-content-cache.ts); every call here costs real tokens.
 */
export async function generateCourseContent(
  courseText: string,
  student: StudentProfile
): Promise<CourseContent> {
  const truncatedText = courseText.slice(0, MAX_COURSE_CHARS);

  let raw: string;
  try {
    raw = await callOpenRouter([
      { role: "system", content: buildCourseGenerationSystemPrompt(student) },
      { role: "user", content: buildCourseGenerationUserMessage(truncatedText) },
    ]);
  } catch (error) {
    throw fromOpenRouterError(error);
  }

  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  let parsed: Partial<CourseContent>;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    console.error("Failed to parse AI JSON output:", error, cleaned.slice(0, 500));
    throw new CourseGenerationError("L'IA a renvoyé une réponse invalide. Réessaie.", 502);
  }

  const missingKeys = REQUIRED_KEYS.filter((key) => typeof parsed[key] !== "string");
  if (missingKeys.length > 0) {
    throw new CourseGenerationError(
      `Réponse incomplète de l'IA (sections manquantes : ${missingKeys.join(", ")}).`,
      502
    );
  }

  return parsed as CourseContent;
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
