/**
 * PROACTIVE MEDICAL IMAGES in Copilot replies — product orders 2026-11-09
 * ("Master Copilot Surgery", then "Ultimate Copilot Visual Engine"). The free
 * models illustrate a medical answer on their own, in plain Markdown
 * (lib/ai/medical-image-directive.ts). A model's link is never shown as it
 * is: it can name a file that doesn't exist, or a thumbnail width Wikimedia
 * refuses (HTTP 400 — only standard widths are served, https://w.wiki/GHai).
 * Every image goes through app/api/assistant/medical-image, whose engine
 * (lib/medical-image-engine.ts) finds the best REAL picture across several
 * open repositories — Wikimedia Commons, PubMed Central Open Access (through
 * NLM's Open-i) and Wellcome Collection — keeping only licenses that allow
 * commercial reuse. The reply shows that verified picture
 * (components/assistant/MedicalFigure.tsx), flush, with an in-app full-screen
 * view and download — or nothing at all, never a broken image, never a
 * caption without its picture. The browser loads it from MedArt's own address
 * (app/api/assistant/medical-image/view), never from the repository: from
 * some students' connections the repositories' hosts can't be reached at all
 * (2026-11-09). $0: public APIs, the repositories' pictures, our CDN.
 *
 * Client-safe: shared by the renderer and the server.
 */

export type MedicalImageSource = "wikimedia" | "pmc" | "wellcome";

/** How each repository is named under a picture. */
export const MEDICAL_IMAGE_SOURCE_LABELS: Record<MedicalImageSource, string> = {
  wikimedia: "Wikimedia Commons",
  pmc: "PubMed Central",
  wellcome: "Wellcome Collection",
};

export interface VerifiedMedicalImage {
  /** The picture shown in the reply: its link on the repository's own image host (loaded through MEDICAL_IMAGE_VIEW_API, carried as is in copies). */
  src: string;
  /** A sharper version for the full-screen view and the download (same host), when the repository has one. */
  zoomSrc: string | null;
  /** Size hints for the layout before the picture arrives (null when the repository doesn't say). */
  width: number | null;
  height: number | null;
  /** The file's or figure's own title — the alt text when the reply gave none. */
  title: string;
  source: MedicalImageSource;
  /** Author(s), or the article's authors and journal. */
  credit: string | null;
  /** "CC BY 4.0", "CC BY-SA 3.0", "CC0", "Domaine public"… — always one that allows commercial reuse. */
  license: string | null;
}

/** What the resolver answers for one image of a reply: the best picture, and other good ones (another picture when this one is already shown higher up in the same reply, or fails to load). */
export interface MedicalImageResolution {
  image: VerifiedMedicalImage;
  alternatives: VerifiedMedicalImage[];
}

/** The request one image of a reply makes to the resolver. */
export interface MedicalImageQuery {
  /** The Commons file the link names ("Name.ext", without "File:"), when it names one. */
  fileName: string | null;
  /** Search words taken from the link's file name (English, like the repositories' captions). */
  keywords: string;
  /** The image's description in the reply (its alt text) — the caption, and a search key. */
  alt: string;
}

/**
 * True for a license that asks for no credit at all — CC0 and the public
 * domain. The Studio's FreeMedImage shows a picture alone, with no caption,
 * credit or link (product order 2026-11-12), which CC BY / CC BY-SA would not
 * allow: it only ever receives such pictures (app/api/studio/free-med-image).
 */
export function isAttributionFreeLicense(license: string | null | undefined): boolean {
  if (typeof license !== "string") return false;
  return /^(?:cc0\b|cc[\s-]?zero\b|public[\s-]*domain\b|domaine\s+public\b|pd(?:[\s-]|$)|pdm\b|no\s+restrictions\b)/i.test(license.trim());
}

export const MEDICAL_IMAGE_API = "/api/assistant/medical-image";
/** The same-origin download of a verified picture (app/api/assistant/medical-image/file). */
export const MEDICAL_IMAGE_FILE_API = "/api/assistant/medical-image/file";
/** A verified picture as the reply shows it, from MedArt's own address (app/api/assistant/medical-image/view). */
export const MEDICAL_IMAGE_VIEW_API = "/api/assistant/medical-image/view";
export const MAX_IMAGE_SRC_CHARS = 2000;
export const MAX_IMAGE_ALT_CHARS = 200;
export const MAX_IMAGE_ALTERNATIVES = 3;

/** The only hosts a verified picture may come from, per repository. */
const SOURCE_HOSTS: Record<MedicalImageSource, readonly string[]> = {
  wikimedia: ["upload.wikimedia.org", "thumb.wikimedia.org"],
  pmc: ["openi.nlm.nih.gov"],
  wellcome: ["iiif.wellcomecollection.org"],
};
const MEDIA_HOSTS = new Set(SOURCE_HOSTS.wikimedia);
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

function parseHttps(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

/** The repository whose image host serves `value` (https, no credentials, default port), or null. */
export function imageUrlSource(value: string): MedicalImageSource | null {
  const url = parseHttps(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  for (const source of Object.keys(SOURCE_HOSTS) as MedicalImageSource[]) {
    if (SOURCE_HOSTS[source].includes(host)) return source;
  }
  return null;
}

/** True for an https link to one of the repositories' image hosts — the only links a verified picture or a download may use. */
export function isAllowedImageUrl(value: string): boolean {
  return imageUrlSource(value) !== null;
}

/** True for an https link to Wikimedia's media servers. */
export function isWikimediaMediaUrl(value: string): boolean {
  return imageUrlSource(value) === "wikimedia";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSizeHint(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value > 0);
}

/** A resolver picture as the browser receives it: checked field by field, every link on its own repository's host. */
export function isVerifiedMedicalImage(value: unknown): value is VerifiedMedicalImage {
  if (!value || typeof value !== "object") return false;
  const image = value as Record<string, unknown>;
  const source = image.source;
  if (source !== "wikimedia" && source !== "pmc" && source !== "wellcome") return false;
  return (
    typeof image.src === "string" &&
    imageUrlSource(image.src) === source &&
    (image.zoomSrc === null || (typeof image.zoomSrc === "string" && imageUrlSource(image.zoomSrc) === source)) &&
    isSizeHint(image.width) &&
    isSizeHint(image.height) &&
    typeof image.title === "string" &&
    isNullableString(image.credit) &&
    isNullableString(image.license)
  );
}

/** A resolver answer as the browser receives it: the picture and its alternatives, each checked; invalid alternatives are dropped. */
export function readMedicalImageResolution(value: unknown): MedicalImageResolution | null {
  if (!value || typeof value !== "object") return null;
  const data = value as { image?: unknown; alternatives?: unknown };
  if (!isVerifiedMedicalImage(data.image)) return null;
  const alternatives = Array.isArray(data.alternatives) ? data.alternatives.filter(isVerifiedMedicalImage).slice(0, MAX_IMAGE_ALTERNATIVES) : [];
  return { image: data.image, alternatives: alternatives.filter((alt) => alt.src !== (data.image as VerifiedMedicalImage).src) };
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
 * The link given to a figure the reply only captioned ("Figure 2 :
 * Diagramme du…" with no image — lib/image-markdown-repair.ts): there is no
 * file to look up, the engine searches with the caption. It is never shown
 * or fetched: only verified pictures are (`.invalid` is a reserved domain).
 */
const CAPTION_SEARCH_ORIGIN = "https://figure.medartai.invalid";

export function captionSearchUrl(caption: string): string {
  return `${CAPTION_SEARCH_ORIGIN}/${encodeURIComponent(imageFileSlug(caption))}.png`;
}

export function isCaptionSearchUrl(src: string): boolean {
  return src.trim().startsWith(`${CAPTION_SEARCH_ORIGIN}/`);
}

/**
 * The resolver's request from an image's link and description, or null when
 * there is nothing to look up. A link outside Wikimedia is never shown: its
 * file name and the description can still find the picture. A caption-only
 * figure (captionSearchUrl) is looked for with its description alone.
 */
export function parseMedicalImageQuery(src: unknown, alt: unknown): MedicalImageQuery | null {
  if (typeof src !== "string") return null;
  const link = src.trim();
  if (!link || link.length > MAX_IMAGE_SRC_CHARS || !/^https?:\/\//i.test(link)) return null;
  const description = typeof alt === "string" ? alt.replace(/\s+/g, " ").trim().slice(0, MAX_IMAGE_ALT_CHARS) : "";
  if (isCaptionSearchUrl(link)) return description ? { fileName: null, keywords: "", alt: description } : null;

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

/** A file-name-safe slug for a downloaded picture ("Tracé ECG normal" → "trace-ecg-normal", "cœur" → "coeur"). */
export function imageFileSlug(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "illustration";
}
