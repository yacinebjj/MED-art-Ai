import { isWikimediaMediaUrl, type VerifiedMedicalImage } from "@/lib/medical-images";
import { ImageSourceUnavailableError, fetchSourceJson, plainText, type ImageCandidate } from "@/lib/medical-image-candidates";
import { searchWords } from "@/lib/medical-image-relevance";

/**
 * Wikimedia Commons, for the Copilot's image engine (lib/medical-image-engine.ts):
 * the file a reply names, looked up exactly (redirects followed), and a Commons
 * search. Pictures come back as Wikimedia's API itself gives them — the file,
 * or its thumbnail at a standard width (960 px; any other width is refused on
 * a direct request: HTTP 400, https://w.wiki/GHai) and a 1920 px one for the
 * full-screen view when there is one. Art, icons, tiny files and diagrams
 * labelled in a language other than English or French are left out.
 */

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
/** A standard Wikimedia thumbnail width (the 2x one the API offers alongside is 1920, standard too). */
const DISPLAY_WIDTH = 960;
const REQUEST_TIMEOUT_MS = 6_000;
const SEARCH_RESULTS = 10;
/** Smaller than this on its longest side: an icon, not an illustration. */
const MIN_SOURCE_PX = 150;
const DISPLAYABLE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/tiff"]);
/** Commons categories of a picture that is not a medical illustration ("Blue eyes in art", "Silk icons", "Heart icons"…). */
const ART_OR_ICON = /\b(?:icons?|symbols?|emoji|emoticons?|logos?|clip[ -]?art|cartoons?|pictograms?|in art|artworks?|paintings?|caricatures?|memes?)\b/i;
/** A title ending in a language code other than English or French: the labels would be unreadable to the student. */
const FOREIGN_LABELS =
  /(?:^|[\s_\-(.])(ar|az|be|bg|bn|bs|ca|cs|cy|da|de|el|eo|es|et|eu|fa|fi|ga|gl|he|hi|hr|hu|hy|id|is|it|ja|ka|kk|ko|ku|lt|lv|mk|ml|mn|mt|nl|nn|no|pl|pt|pt-br|ro|ru|sh|sk|sl|sq|sr|sv|sw|ta|te|th|tl|tr|uk|ur|uz|vi|zh|zh-hans|zh-hant|zh-cn|zh-tw)\)?$/i;
/** A title in another script (Cyrillic, Greek, Arabic, Hebrew, Indic, Thai, CJK, Korean): its labels would be too. */
const FOREIGN_SCRIPT = /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿऀ-෿฀-๿぀-ヿ㐀-鿿가-힯]/;

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
  responsiveUrls?: Record<string, string>;
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
  const data = (await fetchSourceJson("wikimedia", url, REQUEST_TIMEOUT_MS)) as { query?: { pages?: CommonsPage[] }; error?: { code?: string; info?: string } };
  // An API-level error (lag, read-only, overload) says nothing about the picture: treated as an outage, never remembered.
  if (data && typeof data === "object" && data.error) {
    throw new ImageSourceUnavailableError("wikimedia", `Wikimedia Commons : ${data.error.code ?? "erreur"} ${data.error.info ?? ""}`.trim());
  }
  return Array.isArray(data?.query?.pages) ? data.query.pages : [];
}

function metadata(info: CommonsImageInfo, field: string): unknown {
  return info.extmetadata?.[field]?.value;
}

function titleStem(title: string | undefined): string {
  return (title ?? "").replace(/^File:/i, "").replace(/\.[a-z0-9]{2,5}$/i, "").trim();
}

/** A Commons page as a candidate picture, or null (missing, not an image, an icon or a work of art, a link off Wikimedia). */
function toCandidate(page: CommonsPage, rank: number): ImageCandidate | null {
  const info = page.imageinfo?.[0];
  if (!page.title || page.missing || page.invalid || !info || !info.mime || !DISPLAYABLE_MIME.has(info.mime)) return null;
  if (Math.max(info.width ?? 0, info.height ?? 0) < MIN_SOURCE_PX) return null;
  const categories = plainText(metadata(info, "Categories"), 4000);
  if (ART_OR_ICON.test(categories)) return null;
  const src = info.thumburl || info.url;
  const width = info.thumburl ? info.thumbwidth : info.width;
  const height = info.thumburl ? info.thumbheight : info.height;
  if (!src || !isWikimediaMediaUrl(src)) return null;
  const zoom = info.responsiveUrls?.["2"] ?? info.responsiveUrls?.["1.5"] ?? null;
  const image: VerifiedMedicalImage = {
    src,
    zoomSrc: zoom && isWikimediaMediaUrl(zoom) ? zoom : null,
    width: width && width > 0 ? width : null,
    height: height && height > 0 ? height : null,
    title: titleStem(page.title),
    source: "wikimedia",
    credit: plainText(metadata(info, "Artist"), 120) || null,
    license: plainText(metadata(info, "LicenseShortName"), 40) || null,
  };
  const text = {
    primary: `${titleStem(page.title)} ${plainText(metadata(info, "ObjectName"), 300)}`,
    full: `${plainText(metadata(info, "ImageDescription"), 1500)} ${categories}`,
  };
  return { image, text, rank };
}

/** The Commons file `fileName` names (redirects followed), as a candidate, or null when it doesn't exist or isn't a medical picture. */
export async function lookupCommonsFile(fileName: string): Promise<ImageCandidate | null> {
  const pages = await queryCommons({ titles: `File:${fileName}`, redirects: "1", ...IMAGE_INFO, iiextmetadatalanguage: "en" });
  for (const page of pages) {
    const candidate = toCandidate(page, 0);
    if (candidate) return candidate;
  }
  return null;
}

/** Commons pictures for `query` (bitmaps and drawings only), in search order, labelled in English or French (or not labelled). */
export async function searchCommons(query: string, language: "en" | "fr"): Promise<ImageCandidate[]> {
  const words = searchWords(query);
  if (!words) return [];
  const pages = await queryCommons({
    generator: "search",
    gsrsearch: `${words} filetype:bitmap|drawing`,
    gsrnamespace: "6",
    gsrlimit: String(SEARCH_RESULTS),
    ...IMAGE_INFO,
    iiextmetadatalanguage: language,
  });
  return [...pages]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .filter((page) => !FOREIGN_LABELS.test(titleStem(page.title)) && !FOREIGN_SCRIPT.test(page.title ?? ""))
    .map((page, rank) => toCandidate(page, rank))
    .filter((candidate): candidate is ImageCandidate => candidate !== null);
}
