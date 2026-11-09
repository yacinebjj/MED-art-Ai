import type { MedicalImageSource, VerifiedMedicalImage } from "@/lib/medical-images";
import type { CandidateText } from "@/lib/medical-image-relevance";

/**
 * What every repository module of the Copilot's image engine shares
 * (lib/wikimedia-commons.ts, lib/open-i.ts, lib/wellcome-collection.ts,
 * orchestrated by lib/medical-image-engine.ts): the candidate shape, the
 * polite JSON fetch, and the outage error.
 */

/** A picture a repository offers, before the engine judges it. */
export interface ImageCandidate {
  image: VerifiedMedicalImage;
  /** What the repository says about it — its own name, and everything else (description, caption, categories): what relevance is judged on. */
  text: CandidateText;
  /** Its place in the repository's own results (0 = first). */
  rank: number;
}

/** A repository could not be reached or answered with an error: nothing is known about the picture. */
export class ImageSourceUnavailableError extends Error {
  readonly source: MedicalImageSource;

  constructor(source: MedicalImageSource, message: string) {
    super(message);
    this.name = "ImageSourceUnavailableError";
    this.source = source;
  }
}

/** APIs' etiquette (Wikimedia's User-Agent policy and the like): a descriptive client name with a contact. */
export const IMAGE_ENGINE_USER_AGENT = "MedArtAI/1.0 (https://www.medartai.com; medical-education image lookup)";

/** A repository's JSON answer, within `timeoutMs`; any failure is an ImageSourceUnavailableError for `source`. */
export async function fetchSourceJson(source: MedicalImageSource, url: URL, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": IMAGE_ENGINE_USER_AGENT, "Api-User-Agent": IMAGE_ENGINE_USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new ImageSourceUnavailableError(source, `${source} a répondu ${res.status}.`);
    return (await res.json()) as unknown;
  } catch (error) {
    if (error instanceof ImageSourceUnavailableError) throw error;
    throw new ImageSourceUnavailableError(source, error instanceof Error && error.name === "AbortError" ? `${source} n'a pas répondu à temps.` : `${source} injoignable.`);
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Repository metadata is often HTML: its plain text, entities decoded, at most `max` characters. */
export function plainText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity: string, code: string) => {
      if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? entity;
      const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "CC BY 4.0" from a Creative Commons license URL and its short code — only codes that allow commercial reuse (no NC); null otherwise. */
export function commercialCreativeCommons(code: string | null | undefined, licenseUrl?: string | null): string | null {
  const names: Record<string, string> = { by: "CC BY", bysa: "CC BY-SA", "by-sa": "CC BY-SA", bynd: "CC BY-ND", "by-nd": "CC BY-ND", cc0: "CC0", zero: "CC0" };
  const name = code ? names[code.toLowerCase().replace(/[^a-z0-9-]/g, "")] : undefined;
  if (!name) return null;
  const version = licenseUrl?.match(/\/(\d\.\d)\/?$/)?.[1];
  return version && name !== "CC0" ? `${name} ${version}` : name;
}
