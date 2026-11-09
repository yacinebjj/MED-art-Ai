import { commercialCreativeCommons, fetchSourceJson, plainText, type ImageCandidate } from "@/lib/medical-image-candidates";

/**
 * PubMed Central Open Access figures, through NLM's Open-i search
 * (https://openi.nlm.nih.gov), for the Copilot's image engine
 * (lib/medical-image-engine.ts): real clinical pictures — ECG traces,
 * radiographs, CT/MRI, ultrasound, histopathology — from CASE REPORTS and
 * REVIEWS (at=cr,ra), never research panels. Only figures whose article
 * carries a license that allows commercial reuse (CC BY, CC BY-SA, CC BY-ND)
 * are kept: MedArt AI is a paid service, so NC licenses and figures with no
 * stated license are dropped. Open-i serves them at 512 px.
 */

const OPENI_ORIGIN = "https://openi.nlm.nih.gov";
/** A secondary repository: past this, the picture is chosen without it (Open-i is sometimes slow — measured up to 7 s). */
const REQUEST_TIMEOUT_MS = 4_500;
const RESULTS = 15;
/** Open-i's own image path: /imgs/<size>/<shard>/<pmcid>/<file>. */
const IMAGE_PATH = /^\/imgs\/\d+\/\d+\/\d+\/[\w.-]+\.(?:png|jpe?g|gif)$/i;

interface OpenIResult {
  imgLarge?: unknown;
  image?: { caption?: unknown };
  title?: unknown;
  journal_title?: unknown;
  authors?: unknown;
  ccLicense?: unknown;
  licenseURL?: unknown;
}

/** Open-i figures for search `words` (English), in search order, licensed for commercial reuse. */
export async function searchOpenI(words: string): Promise<ImageCandidate[]> {
  if (!words.trim()) return [];
  const url = new URL(`${OPENI_ORIGIN}/api/search`);
  url.searchParams.set("query", words);
  url.searchParams.set("m", "1");
  url.searchParams.set("n", String(RESULTS));
  url.searchParams.set("at", "cr,ra");
  url.searchParams.set("coll", "pmc");
  const data = (await fetchSourceJson("pmc", url, REQUEST_TIMEOUT_MS)) as { list?: unknown };
  const list = Array.isArray(data?.list) ? (data.list as OpenIResult[]) : [];

  const candidates: ImageCandidate[] = [];
  list.forEach((item, rank) => {
    if (!item || typeof item !== "object") return;
    const path = typeof item.imgLarge === "string" ? item.imgLarge : "";
    if (!IMAGE_PATH.test(path)) return;
    const license = commercialCreativeCommons(
      typeof item.ccLicense === "string" ? item.ccLicense : null,
      typeof item.licenseURL === "string" ? item.licenseURL : null
    );
    if (!license) return;
    const caption = plainText(item.image?.caption, 1200);
    const articleTitle = plainText(item.title, 300);
    const journal = plainText(item.journal_title, 120);
    const authors = plainText(item.authors, 400)
      .split(/,\s*/)
      .filter(Boolean);
    const credit = [authors.length > 0 ? `${authors[0]}${authors.length > 1 ? " et al." : ""}` : "", journal].filter(Boolean).join(" — ");
    candidates.push({
      image: {
        src: `${OPENI_ORIGIN}${path}`,
        zoomSrc: null,
        width: null,
        height: null,
        title: plainText(caption, 200) || articleTitle,
        source: "pmc",
        credit: credit || null,
        license,
      },
      // Its own name: the caption's first sentence ("Chest X-ray showing right pneumothorax."), not a multi-panel figure's later panels.
      text: { primary: caption.split(/(?<=[.;])\s/)[0].slice(0, 300), full: `${caption} ${articleTitle}` },
      rank,
    });
  });
  return candidates;
}
