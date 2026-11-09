/**
 * PROACTIVE MEDICAL IMAGES in Copilot replies — product order 2026-11-09
 * ("Master Copilot Surgery"). The free models illustrate a medical answer on
 * their own with a Wikimedia Commons image, in plain Markdown
 * (lib/ai/medical-image-directive.ts). A model's link is never shown as it
 * is: it can name a file that doesn't exist, or a thumbnail width Wikimedia
 * refuses (HTTP 400 — only standard widths are served, https://w.wiki/GHai).
 * Every image goes through app/api/assistant/medical-image, which finds the
 * real Commons file (lib/wikimedia-commons.ts); the reply shows that verified
 * file (components/assistant/MedicalFigure.tsx), or nothing at all — never a
 * broken image. $0: Wikimedia's public API and its free image hosting.
 *
 * Client-safe: shared by the renderer and the server.
 */

export interface VerifiedMedicalImage {
  /** The verified image: a Commons file on upload.wikimedia.org, or its standard-width thumbnail (upload/thumb.wikimedia.org). */
  src: string;
  width: number;
  height: number;
  /** "File:Name.ext" on Wikimedia Commons. */
  title: string;
  /** The file's page on Commons: author, license, full resolution. */
  pageUrl: string;
  artist: string | null;
  license: string | null;
}

/** The request one image of a reply makes to the resolver. */
export interface MedicalImageQuery {
  /** The Commons file the link names ("Name.ext", without "File:"), when it names one. */
  fileName: string | null;
  /** Search words taken from the link's file name (English on Commons). */
  keywords: string;
  /** The image's description in the reply (its alt text) — the caption, and a last search key. */
  alt: string;
}

export const MEDICAL_IMAGE_API = "/api/assistant/medical-image";
export const MAX_IMAGE_SRC_CHARS = 2000;
export const MAX_IMAGE_ALT_CHARS = 200;

const MEDIA_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);
const IMAGE_FILE = /\.(?:svg|png|jpe?g|gif|webp|tiff?)$/i;
/** A namespace prefix of a file page, in the languages a model may write it in. */
const FILE_NAMESPACE = /^(?:file|fichier|image|datei|archivo|ficheiro|ملف):/i;
/** Characters MediaWiki never allows in a title — a name containing one is searched, not looked up. */
const INVALID_TITLE = /[#<>[\]{}|]/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** True for an https link to Wikimedia's media servers. */
export function isWikimediaMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && MEDIA_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** True for an https link to a file page on Wikimedia Commons. */
export function isCommonsPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "commons.wikimedia.org" && url.pathname.startsWith("/wiki/");
  } catch {
    return false;
  }
}

/** A resolver answer as the browser receives it: checked field by field, links on Wikimedia only. */
export function isVerifiedMedicalImage(value: unknown): value is VerifiedMedicalImage {
  if (!value || typeof value !== "object") return false;
  const image = value as Record<string, unknown>;
  return (
    typeof image.src === "string" &&
    isWikimediaMediaUrl(image.src) &&
    typeof image.pageUrl === "string" &&
    isCommonsPageUrl(image.pageUrl) &&
    typeof image.title === "string" &&
    typeof image.width === "number" &&
    image.width > 0 &&
    typeof image.height === "number" &&
    image.height > 0 &&
    (image.artist === null || typeof image.artist === "string") &&
    (image.license === null || typeof image.license === "string")
  );
}

/** "960px-Name.svg.png" (a thumbnail's own name) → "Name.svg" (its file's). */
function fileNameFromThumbnail(name: string): string {
  const withoutWidth = name.replace(/^(?:lossy-|lossless-)?(?:page\d+-)?\d+px-/i, "");
  return withoutWidth.replace(/\.(svg|tiff?|gif|webp|pdf|djvu)\.(?:png|jpe?g|webp)$/i, ".$1");
}

/**
 * The Commons file an image link names, or null. Understands every way a
 * model writes one: an original (upload.wikimedia.org/wikipedia/commons/a/ab/
 * Name.svg), a thumbnail (…/thumb/a/ab/Name.svg/960px-Name.svg.png, also on
 * thumb.wikimedia.org), with wrong or missing hash folders, and a file page
 * (commons.wikimedia.org/wiki/File:Name.svg, a Wikipedia "#/media/File:…").
 */
export function wikimediaFileName(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  let name: string | null = null;

  if (MEDIA_HOSTS.has(host)) {
    const segments = url.pathname.split("/").filter(Boolean).map(safeDecode);
    const thumb = segments.indexOf("thumb");
    if (thumb !== -1 && segments.length >= thumb + 5) name = segments[thumb + 3];
    else name = fileNameFromThumbnail(segments[segments.length - 1] ?? "");
  } else if (host === "commons.wikimedia.org" || host === "commons.m.wikimedia.org" || host.endsWith(".wikipedia.org")) {
    const path = safeDecode(url.pathname);
    const page = path.match(/^\/wiki\/(.+)$/);
    const fromHash = safeDecode(url.hash).match(/\/media\/(.+)$/);
    const fromTitle = url.searchParams.get("title");
    const candidate = (fromHash?.[1] ?? page?.[1] ?? fromTitle ?? "").trim();
    if (FILE_NAMESPACE.test(candidate)) name = candidate.replace(FILE_NAMESPACE, "");
  }

  if (!name) return null;
  const cleaned = name.replace(FILE_NAMESPACE, "").replace(/\s+/g, " ").trim();
  if (!IMAGE_FILE.test(cleaned) || INVALID_TITLE.test(cleaned) || cleaned.length > 240) return null;
  return cleaned;
}

/** Search words from a file name: "Blausen_0463_HeartAttack.png" → "Blausen 0463 Heart Attack". */
export function fileNameKeywords(fileName: string): string {
  return fileName
    .replace(IMAGE_FILE, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/[_\-.,;:()[\]{}'"’+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/**
 * The resolver's request from an image's link and description, or null when
 * there is nothing to look up. A link outside Wikimedia is never shown: its
 * file name and the description can still find the picture on Commons.
 */
export function parseMedicalImageQuery(src: unknown, alt: unknown): MedicalImageQuery | null {
  if (typeof src !== "string") return null;
  const link = src.trim();
  if (!link || link.length > MAX_IMAGE_SRC_CHARS || !/^https?:\/\//i.test(link)) return null;
  const description = typeof alt === "string" ? alt.replace(/\s+/g, " ").trim().slice(0, MAX_IMAGE_ALT_CHARS) : "";

  const fileName = wikimediaFileName(link);
  let keywords = fileName ? fileNameKeywords(fileName) : "";
  if (!keywords) {
    try {
      const last = safeDecode(new URL(link).pathname.split("/").filter(Boolean).pop() ?? "");
      if (IMAGE_FILE.test(last)) keywords = fileNameKeywords(fileNameFromThumbnail(last));
    } catch {
      // Not a parsable link: the description alone, if any.
    }
  }
  if (!fileName && !keywords && !description) return null;
  return { fileName, keywords, alt: description };
}

/** An image link in a canonical form, so the same picture is recognised however it was escaped. */
export function canonicalImageSrc(src: string): string {
  return safeDecode(src.trim());
}
