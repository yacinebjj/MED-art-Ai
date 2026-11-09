import {
  MAX_IMAGE_ALT_CHARS,
  MEDICAL_IMAGE_API,
  canonicalImageSrc,
  isVerifiedMedicalImage,
  type VerifiedMedicalImage,
} from "@/lib/medical-images";

/**
 * The browser's side of the Copilot's medical images (lib/medical-images.ts):
 * one check per image link (app/api/assistant/medical-image), shared by every
 * reply that shows it and remembered for the rest of the visit, so a reply
 * re-rendering while it streams, or a thread reopened, asks nothing again.
 */

type Resolution = VerifiedMedicalImage | null;

const MAX_REMEMBERED = 500;
/** Request key → answer (null: no real image fits). */
const answers = new Map<string, Resolution>();
const inFlight = new Map<string, Promise<Resolution>>();
/** Canonical link → its answer, for copies of a reply (withVerifiedImages). */
const answersByLink = new Map<string, Resolution>();
/** Verified images already painted once: shown again (a re-mounted block), they don't fade in a second time. */
const painted = new Set<string>();

function rememberIn<V>(map: Map<string, V>, key: string, value: V): void {
  if (!map.has(key) && map.size >= MAX_REMEMBERED) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

function description(alt: string): string {
  return alt.replace(/\s+/g, " ").trim().slice(0, MAX_IMAGE_ALT_CHARS);
}

function requestKey(src: string, alt: string): string {
  return `${canonicalImageSrc(src)}\u0000${description(alt)}`;
}

/** What is already known about an image: the verified image, null (none fits), or undefined (not checked yet). */
export function peekMedicalImage(src: string, alt: string): Resolution | undefined {
  return answers.get(requestKey(src, alt));
}

/**
 * The verified image for a link a reply wrote, or null. A definite answer
 * (found, or 404/400: nothing fits) is remembered; a failure that may pass
 * (offline, 429, Wikimedia down) resolves null for now and is asked again by
 * the next figure that shows this link.
 */
export function resolveMedicalImageInBrowser(src: string, alt: string): Promise<Resolution> {
  const key = requestKey(src, alt);
  if (answers.has(key)) return Promise.resolve(answers.get(key) ?? null);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const params = new URLSearchParams({ src: src.trim(), alt: description(alt) });
  const request = fetch(`${MEDICAL_IMAGE_API}?${params.toString()}`, { credentials: "same-origin" })
    .then(async (res): Promise<Resolution> => {
      if (res.status === 404 || res.status === 400) {
        rememberIn(answers, key, null);
        rememberIn(answersByLink, canonicalImageSrc(src), null);
        return null;
      }
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as { image?: unknown } | null;
      if (!isVerifiedMedicalImage(data?.image)) return null;
      rememberIn(answers, key, data.image);
      rememberIn(answersByLink, canonicalImageSrc(src), data.image);
      return data.image;
    })
    .catch((): Resolution => null)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export function markMedicalImagePainted(src: string): void {
  if (painted.size >= MAX_REMEMBERED) painted.clear();
  painted.add(src);
}

export function wasMedicalImagePainted(src: string): boolean {
  return painted.has(src);
}

const IMAGE_MARKDOWN = /!\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

/**
 * A reply's Markdown as the student saw it, for what they take away (copy,
 * Mes notes, export): each image link the reply wrote becomes the verified
 * Commons file it was shown as, an image that was not shown (none fits) is
 * left out, one not checked yet stays as written.
 */
export function withVerifiedImages(markdown: string): string {
  return markdown.replace(IMAGE_MARKDOWN, (whole: string, alt: string, src: string) => {
    const known = answersByLink.get(canonicalImageSrc(src));
    if (known === undefined) return whole;
    return known ? `![${alt}](${known.src})` : "";
  });
}
