import { captionSearchUrl } from "@/lib/medical-images";

/**
 * A reply's images, written the way the renderer can show them (product
 * order 2026-11-09: "the AI outputs the text caption but the image does not
 * show up"). A model often illustrates without the exact Markdown image
 * syntax — and only `![caption](link)` becomes a picture
 * (components/assistant/MedicalFigure.tsx). Repaired here, before the reply
 * is parsed (lib/assistant-markdown.ts):
 *  - a figure caption alone on its line ("Figure 2 : Diagramme du…",
 *    "**Fig. 3 –** …", "[Figure 1 : …]") becomes an image the engine looks
 *    for with the caption itself — shown if a real picture fits, gone if not:
 *    never a caption without its picture;
 *  - a caption next to an image is merged into it (its caption, one line);
 *  - a link to an image file without "!" ([…](…png)), a bare image URL
 *    alone on its line, "![…] (…)" with a space, an image wrapped in
 *    `code`, an HTML <img>: proper Markdown images.
 * A line still arriving (the end of a streaming reply) is left alone until it
 * is complete — its caption or link isn't whole yet.
 */

const IMAGE_FILE_URL = /^https?:\/\/[^\s<>()]+\.(?:png|jpe?g|gif|svg|webp|tiff?)(?:[?#][^\s<>()]*)?$/i;
const FILE_PAGE_URL = /^https?:\/\/[^\s<>()]+(?:\/wiki\/|#\/media\/)(?:file|fichier|image):[^\s<>()]+$/i;
/** "Figure 2 :", "Fig. 3 –", "Illustration :" — unambiguous picture labels (not "Image :" or "Schéma :", which also introduce text). */
const LABEL = String.raw`(?:figure|fig\.?|illustration)`;
const EMPHASIS = String.raw`(?:\*\*|__|\*|_)`;
/** Optional list bullet or quote marker, kept when the line is rewritten. */
const PREFIX = String.raw`^(\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?)`;
const CAPTION_LINE = new RegExp(
  `${PREFIX}(?:\\p{Extended_Pictographic}\\uFE0F?\\s*)?${EMPHASIS}?${LABEL}\\s*(?:n[°o]\\.?\\s*)?\\d{0,3}\\s*${EMPHASIS}?\\s*[:.–—-]\\s*${EMPHASIS}?\\s*(.+?)\\s*$`,
  "iu"
);
/** "![…]" with no link after it, or "[…]" naming a picture ("[Figure 2 : …]", "[Schéma du néphron]"). */
const BRACKET_CAPTION_LINE = new RegExp(`${PREFIX}(!?)\\[([^\\]\\n]{4,200})\\]\\s*$`, "u");
const PICTURE_WORD = /\b(?:figure|fig|image|illustration|sch[ée]ma|diagramme?|photo|radiographie|coupe|planche)\b/iu;
/** A whole line that is a link: "[text](url)", maybe after a caption label and inside emphasis. */
const LINK_LINE = new RegExp(`${PREFIX}(?:${EMPHASIS}?${LABEL}\\s*\\d{0,3}\\s*[:.–—-]\\s*)?${EMPHASIS}?\\[([^\\]\\n]*)\\]\\((\\S+?)\\)${EMPHASIS}?\\s*$`, "iu");
/** A whole line that is a URL, maybe after a caption ("Figure 2 : caption — url", "caption : <url>"). */
const URL_LINE = new RegExp(`${PREFIX}(?:(.{2,200}?)\\s*[:–—-]\\s+)?<?(https?:\\/\\/\\S+?)>?\\s*$`, "u");
const IMAGE_MARKDOWN = /!\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/;
const GENERIC_ALTS = new Set(["", "image", "figure", "schema", "schéma", "illustration", "diagramme", "diagram", "photo", "picture"]);

function isImageLink(url: string): boolean {
  return IMAGE_FILE_URL.test(url) || FILE_PAGE_URL.test(url);
}

/** A caption's own words: no label, no emphasis or quote marks around it, no closing punctuation. */
function cleanCaption(text: string): string {
  return text
    .replace(new RegExp(`^${LABEL}\\s*(?:n[°o]\\.?\\s*)?\\d{0,3}\\s*[:.–—-]\\s*`, "iu"), "")
    .replace(/^[\s*_"«“]+|[\s*_"»”.]+$/gu, "")
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

/** A caption alone on its line (no link in it), with its prefix — or null. */
function captionOnly(line: string): { prefix: string; caption: string } | null {
  if (/https?:\/\/|\]\(/i.test(line)) return null;
  let prefix: string;
  let raw: string;
  const labelled = line.match(CAPTION_LINE);
  if (labelled) {
    prefix = labelled[1];
    raw = labelled[2];
  } else {
    const bracketed = line.match(BRACKET_CAPTION_LINE);
    if (!bracketed || (!bracketed[2] && !PICTURE_WORD.test(bracketed[3]))) return null;
    prefix = bracketed[1];
    raw = bracketed[3];
  }
  const caption = cleanCaption(raw);
  return caption.length >= 4 && caption.length <= 200 ? { prefix, caption } : null;
}

/** The caption to keep when a caption line meets an image: the image's own unless it says nothing. */
function mergedAlt(alt: string, caption: string): string {
  return GENERIC_ALTS.has(alt.trim().toLowerCase()) || alt.trim().length < 4 ? caption : alt;
}

export function repairImageMarkdown(text: string, openEnded = false): string {
  if (!text) return text;
  // Anywhere in the text: an image in `code`, an HTML <img>, "![…] (…)".
  const fixed = text
    .replace(/`(!\[[^\]`\n]*\]\(https?:\/\/[^)`\s]+\))`/g, "$1")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = attribute(tag, "src");
      if (!src || !/^https?:\/\//i.test(src)) return tag;
      return `![${(attribute(tag, "alt") ?? "").replace(/[[\]]/g, "")}](${src})`;
    })
    .replace(/!\[([^\]\n]*)\]\s+\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/g, "![$1]($2)");

  const lines = fixed.split("\n");
  const last = lines.length - 1;
  const complete = (index: number) => !(openEnded && index === last);

  // A link to an image file, or a bare image URL, alone on its line: an image.
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!complete(index) || IMAGE_MARKDOWN.test(line) || line.trimStart().startsWith("|")) continue;
    const link = line.match(LINK_LINE);
    if (link && isImageLink(link[3])) {
      const labelled = line.match(CAPTION_LINE);
      const caption = cleanCaption(link[2]) || (labelled ? cleanCaption(labelled[2].replace(/\[[^\]]*\]\(\S+?\).*$/, "")) : "");
      lines[index] = `${link[1]}![${caption}](${link[3]})`;
      continue;
    }
    const url = line.match(URL_LINE);
    if (url && isImageLink(url[3])) {
      lines[index] = `${url[1]}![${url[2] ? cleanCaption(url[2]) : ""}](${url[3]})`;
    }
  }

  // A caption line: merged into the image it belongs to, or itself an image the engine looks for.
  /** The image line `step` away from `from`, across at most `maxBlanks` blank lines — or -1. */
  const nearestImage = (from: number, step: 1 | -1, maxBlanks: number): number => {
    for (let index = from + step, blanks = 0; index >= 0 && index < lines.length; index += step) {
      if (!lines[index].trim()) {
        if (++blanks > maxBlanks) return -1;
        continue;
      }
      return IMAGE_MARKDOWN.test(lines[index]) ? index : -1;
    }
    return -1;
  };
  const needsCaption = (line: string) => mergedAlt(line.match(IMAGE_MARKDOWN)?.[1] ?? "", "x") === "x";
  const captioned = new Set<number>();
  const drop = new Set<number>();
  for (let index = 0; index < lines.length; index++) {
    if (!complete(index)) continue;
    const found = captionOnly(lines[index]);
    if (!found) continue;
    // Each image takes one caption: the one right against it, else one a blank line above it, else one a
    // blank line below an image that has no caption of its own. Any other caption is a figure of its own.
    const free = (target: number) => target !== -1 && !captioned.has(target);
    let target = [nearestImage(index, 1, 0), nearestImage(index, -1, 0)].find(free) ?? -1;
    if (target === -1 && free(nearestImage(index, 1, 1))) target = nearestImage(index, 1, 1);
    if (target === -1) {
      const below = nearestImage(index, -1, 1);
      if (free(below) && needsCaption(lines[below])) target = below;
    }
    if (target !== -1) {
      lines[target] = lines[target].replace(IMAGE_MARKDOWN, (_, alt: string, src: string) => `![${mergedAlt(alt, found.caption)}](${src})`);
      captioned.add(target);
      drop.add(index);
    } else {
      lines[index] = `${found.prefix}![${found.caption}](${captionSearchUrl(found.caption)})`;
    }
  }
  return lines.filter((_, index) => !drop.has(index)).join("\n");
}
