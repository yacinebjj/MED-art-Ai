import { isCommonsPageUrl, isWikimediaMediaUrl, type MedicalImageQuery, type VerifiedMedicalImage } from "@/lib/medical-images";

/**
 * Server side of the Copilot's medical images (see lib/medical-images.ts):
 * turns the image a model wrote into a REAL Wikimedia Commons file, or null.
 *
 *  1. The file the link names, looked up exactly (redirects followed). Found
 *     and displayable: that file — the model's own choice.
 *  2. Otherwise (a name that doesn't exist, a link off Wikimedia), a Commons
 *     search with the link's file-name words, then with the image's
 *     description. A result counts only if it is an image, labelled in
 *     English or French (or not labelled), and its title or description
 *     shares the query's key words — a wrong picture is worse than none.
 *
 * What it returns is what Wikimedia's API itself gave: the file's URL, or its
 * thumbnail at a standard width (960 px) — the only kind of thumbnail
 * Wikimedia serves to other sites. Answers are kept in memory (a found image
 * 12 h, "none" 1 h); a Wikimedia outage throws (CommonsUnavailableError) and
 * is never remembered.
 */

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
/** Wikimedia's API etiquette: a descriptive User-Agent with a contact (https://meta.wikimedia.org/wiki/User-Agent_policy). */
const USER_AGENT = "MedArtAI/1.0 (https://www.medartai.com; medical-education image lookup)";
/** A standard Wikimedia thumbnail width: any other is refused on a direct request (HTTP 400, https://w.wiki/GHai). */
const DISPLAY_WIDTH = 960;
const REQUEST_TIMEOUT_MS = 6_000;
const SEARCH_RESULTS = 10;
/** Smaller than this on its longest side: an icon, not an illustration. */
const MIN_SOURCE_PX = 150;
const DISPLAYABLE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/tiff"]);
/** Commons categories of a picture that is not a medical illustration ("Blue eyes in art", "Silk icons", "Heart icons"…). */
const ART_OR_ICON = /\b(?:icons?|symbols?|emoji|emoticons?|logos?|clip[ -]?art|cartoons?|pictograms?|in art|artworks?|paintings?|caricatures?|memes?)\b/i;

const FOUND_TTL_MS = 12 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;

/** Wikimedia could not be reached or answered with an error: nothing is known about the image. */
export class CommonsUnavailableError extends Error {}

interface MetadataField {
  value?: unknown;
}

interface CommonsImageInfo {
  url?: string;
  thumburl?: string;
  width?: number;
  height?: number;
  thumbwidth?: number;
  thumbheight?: number;
  mime?: string;
  descriptionurl?: string;
  extmetadata?: Record<string, MetadataField | undefined>;
}

interface CommonsPage {
  title?: string;
  index?: number;
  missing?: boolean;
  invalid?: boolean;
  imageinfo?: CommonsImageInfo[];
}

const IMAGE_INFO = {
  prop: "imageinfo",
  iiprop: "url|size|mime|extmetadata",
  iiurlwidth: String(DISPLAY_WIDTH),
  iiextmetadatafilter: "ImageDescription|ObjectName|Artist|LicenseShortName|Categories",
};

async function queryCommons(params: Record<string, string>): Promise<CommonsPage[]> {
  const url = new URL(COMMONS_API);
  for (const [key, value] of Object.entries({ action: "query", format: "json", formatversion: "2", ...params })) {
    url.searchParams.set(key, value);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new CommonsUnavailableError(`Wikimedia Commons a répondu ${res.status}.`);
    const data = (await res.json()) as { query?: { pages?: CommonsPage[] }; error?: { code?: string; info?: string } };
    if (data.error) throw new CommonsUnavailableError(`Wikimedia Commons : ${data.error.code ?? "erreur"} ${data.error.info ?? ""}`.trim());
    return Array.isArray(data.query?.pages) ? data.query.pages : [];
  } catch (error) {
    if (error instanceof CommonsUnavailableError) throw error;
    throw new CommonsUnavailableError(error instanceof Error && error.name === "AbortError" ? "Wikimedia Commons n'a pas répondu à temps." : "Wikimedia Commons injoignable.");
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Commons metadata is HTML: its plain text, entities decoded, at most `max` characters. */
function plainText(value: unknown, max: number): string {
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

function metadata(info: CommonsImageInfo, field: string): unknown {
  return info.extmetadata?.[field]?.value;
}

/** A Commons page as an image the reply can show, or null (missing, not an image, an icon or a work of art, a link off Wikimedia). */
function toVerifiedImage(page: CommonsPage): VerifiedMedicalImage | null {
  const info = page.imageinfo?.[0];
  if (!page.title || page.missing || page.invalid || !info || !info.mime || !DISPLAYABLE_MIME.has(info.mime)) return null;
  if (Math.max(info.width ?? 0, info.height ?? 0) < MIN_SOURCE_PX) return null;
  if (ART_OR_ICON.test(plainText(metadata(info, "Categories"), 4000))) return null;
  const src = info.thumburl || info.url;
  const width = info.thumburl ? info.thumbwidth : info.width;
  const height = info.thumburl ? info.thumbheight : info.height;
  if (!src || !isWikimediaMediaUrl(src) || !width || !height || width <= 0 || height <= 0) return null;
  const pageUrl =
    info.descriptionurl && isCommonsPageUrl(info.descriptionurl)
      ? info.descriptionurl
      : `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_")).replace(/%3A/gi, ":").replace(/%2F/gi, "/")}`;
  return {
    src,
    width,
    height,
    title: page.title,
    pageUrl,
    artist: plainText(metadata(info, "Artist"), 120) || null,
    license: plainText(metadata(info, "LicenseShortName"), 40) || null,
  };
}

async function lookupFile(fileName: string): Promise<VerifiedMedicalImage | null> {
  const pages = await queryCommons({ titles: `File:${fileName}`, redirects: "1", ...IMAGE_INFO, iiextmetadatalanguage: "en" });
  for (const page of pages) {
    const image = toVerifiedImage(page);
    if (image) return image;
  }
  return null;
}

// --- Search and its relevance check --------------------------------------------------

const STOPWORDS = new Set([
  // English
  "the", "of", "and", "or", "in", "on", "at", "to", "for", "with", "from", "by", "an", "as", "is", "are", "its", "this", "that", "into", "showing", "shows", "view", "human",
  // French
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "ou", "en", "au", "aux", "dans", "sur", "par", "pour", "avec", "sans", "qui", "que", "son", "sa", "ses", "ce", "cette", "chez", "montrant", "vue", "humain", "humaine",
]);

/** Words any picture's name may carry — kinds of picture, and sources (Blausen, Gray's plates, OpenStax…): they neither count toward a match nor are required. */
const GENERIC = new Set([
  "diagram", "diagrams", "schema", "schemas", "scheme", "schematic", "illustration", "illustrations", "image", "images", "picture", "figure", "fig", "photo", "photograph", "drawing",
  "labeled", "labelled", "label", "labels", "unlabeled", "unlabelled", "svg", "png", "jpg", "jpeg", "gif", "file", "normal", "simple", "simplified", "version", "vector", "english", "french",
  "cropped", "crop", "edited", "detail", "detailed", "overview", "anatomy", "medical", "representation", "representations", "coupe", "planche",
  "blausen", "gray", "grays", "openstax", "servier", "bioart", "nih", "lynch", "wikimedia", "wikipedia", "commons",
]);

/** A title ending in a language code other than English or French: the labels would be unreadable to the student. */
const FOREIGN_LABELS =
  /(?:^|[\s_\-(.])(ar|az|be|bg|bn|bs|ca|cs|cy|da|de|el|eo|es|et|eu|fa|fi|ga|gl|he|hi|hr|hu|hy|id|is|it|ja|ka|kk|ko|ku|lt|lv|mk|ml|mn|mt|nl|nn|no|pl|pt|pt-br|ro|ru|sh|sk|sl|sq|sr|sv|sw|ta|te|th|tl|tr|uk|ur|uz|vi|zh|zh-hans|zh-hant|zh-cn|zh-tw)\)?$/i;

function words(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2);
}

/** The words a result must share: no stopwords, no generic picture words, no bare numbers. */
function keyWords(text: string): string[] {
  return Array.from(new Set(words(text).filter((word) => !STOPWORDS.has(word) && !GENERIC.has(word) && !/^\d+$/.test(word))));
}

/** Same word, or one inflection of it ("nephron"/"nephrons", "histology"/"histological"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 5) return false;
  let prefix = 0;
  while (prefix < shorter && a[prefix] === b[prefix]) prefix += 1;
  return prefix >= Math.max(5, shorter - 2);
}

function titleStem(title: string | undefined): string {
  return (title ?? "").replace(/^File:/i, "").replace(/\.[a-z0-9]{2,5}$/i, "").trim();
}

/**
 * The first result, in search order, that is a displayable image, readable,
 * and about the query: it shares every key word of a one- or two-word query,
 * at least half of a longer one, and always the most specific (longest) one —
 * "left ventricular hypertrophy ECG" never settles for a bundle-branch-block
 * trace that merely shares "left" and "ECG".
 */
function pickResult(pages: CommonsPage[], query: string): VerifiedMedicalImage | null {
  const wanted = keyWords(query);
  if (wanted.length === 0) return null;
  const required = wanted.length <= 2 ? wanted.length : Math.ceil(wanted.length / 2);
  const anchor = wanted.reduce((longest, word) => (word.length > longest.length ? word : longest), wanted[0]);
  const ranked = [...pages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const page of ranked) {
    const stem = titleStem(page.title);
    if (!stem || FOREIGN_LABELS.test(stem)) continue;
    const image = toVerifiedImage(page);
    const info = page.imageinfo?.[0];
    if (!image || !info) continue;
    const have = words(`${stem} ${plainText(metadata(info, "ObjectName"), 300)} ${plainText(metadata(info, "ImageDescription"), 1500)}`);
    const shares = (word: string) => have.some((candidate) => sameWord(word, candidate));
    if (shares(anchor) && wanted.filter(shares).length >= required) return image;
  }
  return null;
}

/** The search text: the query's words only (no search operators can slip in), at most 12. */
function searchText(text: string): string {
  return words(text).filter((word) => !STOPWORDS.has(word)).slice(0, 12).join(" ");
}

async function searchCommons(query: string, language: "en" | "fr"): Promise<VerifiedMedicalImage | null> {
  const text = searchText(query);
  if (!text || keyWords(query).length === 0) return null;
  const pages = await queryCommons({
    generator: "search",
    gsrsearch: `${text} filetype:bitmap|drawing`,
    gsrnamespace: "6",
    gsrlimit: String(SEARCH_RESULTS),
    ...IMAGE_INFO,
    iiextmetadatalanguage: language,
  });
  return pickResult(pages, query);
}

async function findImage(query: MedicalImageQuery): Promise<VerifiedMedicalImage | null> {
  if (query.fileName) {
    const exact = await lookupFile(query.fileName);
    if (exact) return exact;
  }
  if (query.keywords) {
    const found = await searchCommons(query.keywords, "en");
    if (found) return found;
  }
  if (query.alt && searchText(query.alt) !== searchText(query.keywords)) {
    return searchCommons(query.alt, "fr");
  }
  return null;
}

// --- Memory of answers -----------------------------------------------------------------

const answers = new Map<string, { image: VerifiedMedicalImage | null; expires: number }>();
const inFlight = new Map<string, Promise<VerifiedMedicalImage | null>>();

function remember(key: string, image: VerifiedMedicalImage | null): void {
  if (answers.size >= CACHE_MAX_ENTRIES) {
    const oldest = answers.keys().next().value;
    if (oldest !== undefined) answers.delete(oldest);
  }
  answers.set(key, { image, expires: Date.now() + (image ? FOUND_TTL_MS : NOT_FOUND_TTL_MS) });
}

/** The verified Commons image for one image of a reply, or null when there is none worth showing. Throws CommonsUnavailableError on an outage. */
export async function resolveMedicalImage(query: MedicalImageQuery): Promise<VerifiedMedicalImage | null> {
  const key = `${query.fileName ?? ""}\u0000${query.keywords}\u0000${query.alt}`;
  const known = answers.get(key);
  if (known && known.expires > Date.now()) return known.image;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const lookup = findImage(query)
    .then((image) => {
      remember(key, image);
      return image;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, lookup);
  return lookup;
}
