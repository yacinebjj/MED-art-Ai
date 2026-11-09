import { MAX_IMAGE_ALTERNATIVES, type MedicalImageQuery, type MedicalImageResolution, type MedicalImageSource, type VerifiedMedicalImage } from "@/lib/medical-images";
import { ImageSourceUnavailableError, type ImageCandidate } from "@/lib/medical-image-candidates";
import { captionAgrees, frenchSearchWords, imageKind, keyWords, relevance, searchWords, type ImageKind } from "@/lib/medical-image-relevance";
import { lookupCommonsFile, searchCommons } from "@/lib/wikimedia-commons";
import { searchOpenI } from "@/lib/open-i";
import { searchWellcome } from "@/lib/wellcome-collection";

/**
 * The Copilot's image engine (see lib/medical-images.ts): turns one image a
 * reply wrote into the best REAL picture, with up to three alternatives, or
 * nothing.
 *
 *  1. The Commons file the link names, when it exists, is a medical picture
 *     and agrees with the reply's caption: the model's own choice, alone. (A
 *     well-known file under an unrelated caption — an example copied into
 *     another answer — is ignored, and so is its name.)
 *  2. Otherwise the repositories that are good at that KIND of picture,
 *     searched at once with the link's words, folded to English — then with
 *     the caption's first words, folded to English (a French file name or a
 *     caption-only figure still finds an English-titled picture):
 *       diagram (schema, anatomy, mechanism) → Wikimedia Commons
 *       trace (ECG)                          → Commons + PubMed Central
 *       imaging (X-ray, CT, MRI, echo…)      → PubMed Central + Commons
 *       microscopy (histology)               → Commons + PubMed Central + Wellcome
 *     Every result must pass lib/medical-image-relevance.ts and agree with
 *     the caption; the survivors are ranked by relevance, the repository's
 *     fit for the kind, and their own search rank. Alternatives favour other
 *     repositories first: if the best picture is already shown higher up in
 *     the reply, or fails to load, the next one is different.
 *  3. Otherwise a Commons search with the reply's caption as written (French
 *     descriptions).
 *
 * Commons is the primary repository: its outage is an error (never
 * remembered, asked again later). A secondary repository down only means
 * fewer choices. Answers are kept in memory (a picture 12 h, "none" 1 h).
 */

const SOURCES_BY_KIND: Record<ImageKind, readonly MedicalImageSource[]> = {
  diagram: ["wikimedia"],
  trace: ["wikimedia", "pmc"],
  imaging: ["pmc", "wikimedia"],
  microscopy: ["wikimedia", "pmc", "wellcome"],
};

/**
 * How well each repository fits a kind of picture — added to a candidate's
 * relevance. Case reports (PubMed Central) are the place for real clinical
 * pictures; their histology is mostly pathology, so for a slide the teaching
 * collections (Wellcome micrographs, Commons) come first.
 */
const SOURCE_FIT: Record<ImageKind, Partial<Record<MedicalImageSource, number>>> = {
  diagram: { wikimedia: 0.2 },
  trace: { wikimedia: 0.2, pmc: 0.15 },
  imaging: { pmc: 0.3, wikimedia: 0.15 },
  microscopy: { wellcome: 0.2, wikimedia: 0.15, pmc: 0.1 },
};

/** Per place down a repository's own results. */
const RANK_PENALTY = 0.03;

const FOUND_TTL_MS = 12 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;

/** A caption's subject is in its first words: the rest describes it. */
const CAPTION_QUERY_WORDS = 5;

function searchSource(source: MedicalImageSource, words: string): Promise<ImageCandidate[]> {
  if (source === "pmc") return searchOpenI(words);
  if (source === "wellcome") return searchWellcome(words);
  return searchCommons(words, "en");
}

interface ScoredImage {
  image: VerifiedMedicalImage;
  score: number;
}

/** The candidates that pass the relevance check (and agree with the reply's caption), best first, each picture once. */
function rank(candidates: ImageCandidate[], query: string, kind: ImageKind, caption: string): ScoredImage[] {
  const scored: ScoredImage[] = [];
  for (const candidate of candidates) {
    const fit = relevance(query, candidate.text);
    if (fit === null || (caption && !captionAgrees(caption, candidate.text))) continue;
    scored.push({ image: candidate.image, score: fit + (SOURCE_FIT[kind][candidate.image.source] ?? 0) - RANK_PENALTY * candidate.rank });
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  return scored.filter(({ image }) => (seen.has(image.src) ? false : (seen.add(image.src), true)));
}

/** A picture's title without its series number: "… fetal liver (01)" and "… fetal liver (02)" are one picture for variety's sake. */
function seriesTitle(image: VerifiedMedicalImage): string {
  return image.title
    .toLowerCase()
    .replace(/[\s_-]*(?:\(\s*\d+\s*\)|\d+)\s*$/, "")
    .trim();
}

/** The best picture, then alternatives — one from each other repository first, then the next best — never two of one series. */
function withVariety(ranked: ScoredImage[]): VerifiedMedicalImage[] {
  const [best, ...rest] = ranked;
  const chosen: VerifiedMedicalImage[] = [best.image];
  const sources = new Set<MedicalImageSource>([best.image.source]);
  const series = new Set<string>([seriesTitle(best.image)]);
  const take = (image: VerifiedMedicalImage) => {
    chosen.push(image);
    sources.add(image.source);
    series.add(seriesTitle(image));
  };
  for (const { image } of rest) {
    if (chosen.length > MAX_IMAGE_ALTERNATIVES) break;
    if (!sources.has(image.source) && !series.has(seriesTitle(image))) take(image);
  }
  for (const { image } of rest) {
    if (chosen.length > MAX_IMAGE_ALTERNATIVES) break;
    if (!chosen.includes(image) && !series.has(seriesTitle(image))) take(image);
  }
  return chosen;
}

/** The repositories good at `kind`, searched at once with `query` folded to English; ranked survivors. */
async function searchByKind(query: string, kind: ImageKind, caption: string): Promise<ScoredImage[]> {
  const words = searchWords(query);
  if (!words) return [];
  const sources = SOURCES_BY_KIND[kind];
  const settled = await Promise.allSettled(sources.map((source) => searchSource(source, words)));
  const candidates: ImageCandidate[] = [];
  for (let index = 0; index < settled.length; index++) {
    const outcome = settled[index];
    if (outcome.status === "fulfilled") candidates.push(...outcome.value);
    else if (sources[index] === "wikimedia") throw outcome.reason;
    else console.warn(`[medical-image] ${sources[index]} indisponible, recherche poursuivie sans :`, outcome.reason instanceof Error ? outcome.reason.message : outcome.reason);
  }
  return rank(candidates, query, kind, caption);
}

async function findImages(query: MedicalImageQuery): Promise<VerifiedMedicalImage[]> {
  const kind = imageKind(`${query.keywords} ${query.alt}`);
  // The model's file name is worth searching with — unless it named an existing file unrelated to its own caption.
  let fileNameSaysSomething = Boolean(query.keywords);

  if (query.fileName) {
    const exact = await lookupCommonsFile(query.fileName);
    if (exact && captionAgrees(query.alt, exact.text, 2)) return [exact.image];
    if (exact) fileNameSaysSomething = false;
  }

  if (fileNameSaysSomething) {
    const ranked = await searchByKind(query.keywords, kind, query.alt);
    if (ranked.length > 0) return withVariety(ranked);
  }

  // The reply's own caption (often French, often the only thing a caption-only figure has), folded to English.
  const captionQuery = keyWords(query.alt).slice(0, CAPTION_QUERY_WORDS).join(" ");
  if (captionQuery && (!fileNameSaysSomething || searchWords(captionQuery) !== searchWords(query.keywords))) {
    const ranked = await searchByKind(captionQuery, kind, query.alt);
    if (ranked.length > 0) return withVariety(ranked);
  }

  // Last, Commons' own French descriptions.
  const french = frenchSearchWords(query.alt);
  if (french) {
    const ranked = rank(await searchCommons(french, "fr"), query.alt, kind, query.alt);
    if (ranked.length > 0) return withVariety(ranked);
  }
  return [];
}

// --- Memory of answers -----------------------------------------------------------------

const answers = new Map<string, { resolution: MedicalImageResolution | null; expires: number }>();
const inFlight = new Map<string, Promise<MedicalImageResolution | null>>();

function remember(key: string, resolution: MedicalImageResolution | null): void {
  if (!answers.has(key) && answers.size >= CACHE_MAX_ENTRIES) {
    const oldest = answers.keys().next().value;
    if (oldest !== undefined) answers.delete(oldest);
  }
  answers.set(key, { resolution, expires: Date.now() + (resolution ? FOUND_TTL_MS : NOT_FOUND_TTL_MS) });
}

/**
 * The verified picture (and alternatives) for one image of a reply, or null
 * when no real picture fits. Throws ImageSourceUnavailableError when
 * Wikimedia Commons, the primary repository, is unreachable.
 */
export async function resolveMedicalImage(query: MedicalImageQuery): Promise<MedicalImageResolution | null> {
  const key = `${query.fileName ?? ""}\u0000${query.keywords}\u0000${query.alt}`;
  const known = answers.get(key);
  if (known && known.expires > Date.now()) return known.resolution;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const lookup = findImages(query)
    .then((images) => {
      const resolution = images.length > 0 ? { image: images[0], alternatives: images.slice(1, 1 + MAX_IMAGE_ALTERNATIVES) } : null;
      remember(key, resolution);
      return resolution;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, lookup);
  return lookup;
}

export { ImageSourceUnavailableError };
