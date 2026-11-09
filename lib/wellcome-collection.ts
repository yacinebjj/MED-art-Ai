import { fetchSourceJson, plainText, type ImageCandidate } from "@/lib/medical-image-candidates";

/**
 * Wellcome Collection's open images API (https://api.wellcomecollection.org),
 * for the Copilot's image engine (lib/medical-image-engine.ts) — micrographs
 * and biomedical imagery. Only CC BY, CC0 and public-domain pictures (the API
 * filters on it). Served by Wellcome's IIIF image server at the size asked
 * for, never upscaled: 960 px for the reply, 1920 px for the full-screen view.
 */

const IMAGES_API = "https://api.wellcomecollection.org/catalogue/v2/images";
const IIIF_INFO = /^https:\/\/iiif\.wellcomecollection\.org\/image\/([A-Za-z0-9_.-]+)\/info\.json$/;
/** A secondary repository: past this, the picture is chosen without it. */
const REQUEST_TIMEOUT_MS = 4_500;
const RESULTS = 10;
const LICENSES: Record<string, string> = { "cc-by": "CC BY 4.0", "cc-0": "CC0", pdm: "Domaine public" };

interface WellcomeLocation {
  url?: unknown;
  credit?: unknown;
  license?: { id?: unknown };
  locationType?: { id?: unknown };
}

interface WellcomeImage {
  locations?: WellcomeLocation[];
  source?: { title?: unknown; subjects?: { label?: unknown }[] };
  aspectRatio?: unknown;
}

/** Wellcome pictures for search `words` (English), in search order, CC BY / CC0 / public domain only. */
export async function searchWellcome(words: string): Promise<ImageCandidate[]> {
  if (!words.trim()) return [];
  const url = new URL(IMAGES_API);
  url.searchParams.set("query", words);
  url.searchParams.set("pageSize", String(RESULTS));
  url.searchParams.set("locations.license", Object.keys(LICENSES).join(","));
  url.searchParams.set("include", "source.subjects");
  const data = (await fetchSourceJson("wellcome", url, REQUEST_TIMEOUT_MS)) as { results?: unknown };
  const results = Array.isArray(data?.results) ? (data.results as WellcomeImage[]) : [];

  const candidates: ImageCandidate[] = [];
  results.forEach((result, rank) => {
    if (!result || typeof result !== "object") return;
    const locations = Array.isArray(result.locations) ? result.locations : [];
    const location = locations.find((entry) => entry?.locationType?.id === "iiif-image") ?? locations[0];
    const id = typeof location?.url === "string" ? location.url.match(IIIF_INFO)?.[1] : undefined;
    const license = LICENSES[String(location?.license?.id ?? "")];
    if (!id || !license) return;
    const base = `https://iiif.wellcomecollection.org/image/${id}`;
    const ratio = typeof result.aspectRatio === "number" && result.aspectRatio > 0 ? result.aspectRatio : null;
    const title = plainText(result.source?.title, 200);
    const credit = plainText(location?.credit, 120);
    const subjects = (Array.isArray(result.source?.subjects) ? result.source.subjects : []).map((subject) => plainText(subject?.label, 80)).join(" ");
    candidates.push({
      image: {
        src: `${base}/full/!960,960/0/default.jpg`,
        zoomSrc: `${base}/full/!1920,1920/0/default.jpg`,
        width: ratio ? (ratio >= 1 ? 960 : Math.round(960 * ratio)) : null,
        height: ratio ? (ratio >= 1 ? Math.round(960 / ratio) : 960) : null,
        title,
        source: "wellcome",
        // "Wellcome Collection" alone is already said by the source's name.
        credit: credit && credit !== "Wellcome Collection" ? credit : null,
        license,
      },
      text: { primary: title, full: subjects },
      rank,
    });
  });
  return candidates;
}
