import { resolveStudioSchema } from "@/lib/ai/studio-schemas";
import { errorMessage, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import type { JsonSectionId } from "@/lib/demo-content";

/**
 * Parses + Zod-validates one Studio JSON response. Shared by
 * app/api/studio/generate (the first generation of a section) and
 * app/api/studio/regenerate (QCM "Régénérer"), so both reject a malformed
 * model response by the exact same rules and feed the same corrective note
 * back into their retry loops. Lives in lib/ rather than in either route
 * because a Next.js route.ts may only export route handlers/config.
 */
export function parseAndValidateStudioSection(
  raw: string,
  actionType: JsonSectionId,
  sectionKey: string,
  studyYear: number | null | undefined
): { success: true; data: unknown } | { success: false; correctiveNote: string } {
  let parsedValue: unknown;
  try {
    const parsed = parseJsonResponse(raw);
    const value = parsed[sectionKey];
    if (value === undefined || value === null) {
      throw new Error(`La réponse de l'IA ne contient pas la clé "${sectionKey}".`);
    }
    parsedValue = sanitizeForPostgres(value);
  } catch (error) {
    return {
      success: false,
      correctiveNote: `la réponse n'était pas un JSON valide, ou la clé "${sectionKey}" était absente (${errorMessage(error)}).`,
    };
  }

  // resolveStudioSchema — the ONE section whose schema genuinely varies by
  // year (cas_clinique: année 1 = essai motivationnel, année 2 = 1 cas
  // physiologique, année 3+/inconnue = le schéma standard inchangé). Every
  // other actionType ignores `studyYear` entirely and gets its usual,
  // unconditional schema.
  const result = resolveStudioSchema(actionType, studyYear).safeParse(parsedValue);
  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    console.error(`[studio:${actionType}] Validation zod échouée :`, fieldErrors);
    return { success: false, correctiveNote: `champs invalides ou manquants (d'après la validation) : ${JSON.stringify(fieldErrors)}.` };
  }

  return { success: true, data: result.data };
}
