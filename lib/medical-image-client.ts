import {
  MAX_IMAGE_ALT_CHARS,
  MEDICAL_IMAGE_API,
  MEDICAL_IMAGE_FILE_API,
  MEDICAL_IMAGE_VIEW_API,
  canonicalImageSrc,
  imageFileSlug,
  isCaptionSearchUrl,
  readMedicalImageResolution,
  type MedicalImageResolution,
  type VerifiedMedicalImage,
} from "@/lib/medical-images";

/**
 * The browser's side of the Copilot's medical images (lib/medical-images.ts):
 * one check per image link (app/api/assistant/medical-image), shared by every
 * reply that shows it and remembered for the rest of the visit, so a reply
 * re-rendering while it streams, or a thread reopened, asks nothing again.
 */

type Answer = MedicalImageResolution | null;

/**
 * Sent with every check: the answer's shape changed with the multi-repository
 * engine, and a browser may still hold day-old answers of the old shape for
 * the same link — a new parameter is a new address, so they're never read.
 */
const ANSWER_VERSION = "2";
const MAX_REMEMBERED = 500;
/** Request key → answer (null: no real picture fits). */
const answers = new Map<string, Answer>();
const inFlight = new Map<string, Promise<Answer>>();
/** Canonical link → the picture shown for it (copies of a reply: withVerifiedImages). */
const shownByLink = new Map<string, VerifiedMedicalImage | null>();
/** Pictures already painted once: shown again (a re-mounted block), they don't fade in a second time. */
const painted = new Set<string>();

/** Part of every view address (the CDN keeps pictures by address): raising it fetches every picture anew. */
const VIEW_VERSION = "1";

/**
 * Where a reply's picture is loaded from: MedArt's own address, which fetches
 * it from the repository (app/api/assistant/medical-image/view). The browser
 * never has to reach the repository itself — from some students' connections
 * it can't: on 2026-11-09 every Wikimedia host timed out there, and the
 * picture waited, invisible, under its caption and credit.
 */
export function medicalImageViewHref(src: string): string {
  return `${MEDICAL_IMAGE_VIEW_API}?${new URLSearchParams({ src, v: VIEW_VERSION }).toString()}`;
}

/**
 * How long a figure waits for its picture before trying the next address
 * (components/assistant/MedicalFigure.tsx). MedArt's address fails fast when
 * it fails (an HTTP error), so its wait is only a safety net. The repository's
 * own address is the one that hangs: on a connection that can't reach it, the
 * request neither loads nor fails. An object, so tests can shorten the waits.
 */
export const MEDICAL_IMAGE_LOAD_TIMEOUT_MS = { viaMedArt: 45_000, direct: 15_000 };

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

/** What is already known about an image: its resolution, null (no picture fits), or undefined (not checked yet). */
export function peekMedicalImage(src: string, alt: string): Answer | undefined {
  return answers.get(requestKey(src, alt));
}

/**
 * The verified picture (and alternatives) for a link a reply wrote, or null.
 * A definite answer (found, or 404/400: nothing fits) is remembered; a
 * failure that may pass (offline, 429, a repository down) resolves null for
 * now and is asked again by the next figure that shows this link.
 */
export function resolveMedicalImageInBrowser(src: string, alt: string): Promise<Answer> {
  const key = requestKey(src, alt);
  if (answers.has(key)) return Promise.resolve(answers.get(key) ?? null);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const params = new URLSearchParams({ src: src.trim(), alt: description(alt), v: ANSWER_VERSION });
  const request = fetch(`${MEDICAL_IMAGE_API}?${params.toString()}`, { credentials: "same-origin" })
    .then(async (res): Promise<Answer> => {
      if (res.status === 404 || res.status === 400) {
        rememberIn(answers, key, null);
        rememberIn(shownByLink, canonicalImageSrc(src), null);
        return null;
      }
      if (!res.ok) return null;
      const resolution = readMedicalImageResolution(await res.json().catch(() => null));
      if (!resolution) return null;
      rememberIn(answers, key, resolution);
      return resolution;
    })
    .catch((): Answer => null)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

/** The picture a figure ended up showing for `link` (after any switch to an alternative): what copies of the reply carry. */
export function rememberShownMedicalImage(link: string, image: VerifiedMedicalImage): void {
  rememberIn(shownByLink, canonicalImageSrc(link), image);
}

export function markMedicalImagePainted(src: string): void {
  if (painted.size >= MAX_REMEMBERED) painted.clear();
  painted.add(src);
}

export function wasMedicalImagePainted(src: string): boolean {
  return painted.has(src);
}

/** "Télécharger": the picture's best version, saved through MedArt's own address (app/api/assistant/medical-image/file). */
export function medicalImageDownloadHref(image: VerifiedMedicalImage, caption: string): string {
  const params = new URLSearchParams({ src: image.zoomSrc ?? image.src, name: imageFileSlug(caption || image.title) });
  return `${MEDICAL_IMAGE_FILE_API}?${params.toString()}`;
}

const IMAGE_MARKDOWN = /!\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

/**
 * A reply's Markdown as the student saw it, for what they take away (copy,
 * Mes notes, export): each image link the reply wrote becomes the verified
 * picture it was shown as, an image that was not shown (none fits) is left
 * out, one not checked yet stays as written.
 */
export function withVerifiedImages(markdown: string): string {
  return markdown.replace(IMAGE_MARKDOWN, (whole: string, alt: string, src: string) => {
    const shown = shownByLink.get(canonicalImageSrc(src));
    // A caption-only figure not looked up yet: its caption, never the placeholder link.
    if (shown === undefined) return isCaptionSearchUrl(src) ? (alt.trim() ? `*${alt.trim()}*` : "") : whole;
    return shown ? `![${alt}](${shown.src})` : "";
  });
}
