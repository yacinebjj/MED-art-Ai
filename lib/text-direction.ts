/**
 * Which way a block of text reads, from the script MOST of its letters are
 * written in — not merely its first strong character, as dir="auto" decides:
 * a sentence of Darija that opens on a French medical term ("**Hypertension**
 * هي…") still reads right to left, and a French sentence quoting one Arabic
 * word still reads left to right. Arabic letters weigh a little more (short
 * vowels aren't written, so an Arabic word holds fewer letters). When the
 * two are too close to call, the script the text opens with decides.
 * undefined when the text has no letters at all (dir="auto" then decides).
 */

const ARABIC = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
const LATIN = "A-Za-z\\u00C0-\\u024F";

const ARABIC_LETTERS = new RegExp(`[${ARABIC}]`, "g");
const LATIN_LETTERS = new RegExp(`[${LATIN}]`, "g");
const FIRST_LETTER = new RegExp(`[${ARABIC}${LATIN}]`);
const ARABIC_LETTER = new RegExp(`[${ARABIC}]`);

const ARABIC_WEIGHT = 1.4;
const TOO_CLOSE = 0.15;

export function dominantDirection(text: string): "rtl" | "ltr" | undefined {
  const arabic = (text.match(ARABIC_LETTERS)?.length ?? 0) * ARABIC_WEIGHT;
  const latin = text.match(LATIN_LETTERS)?.length ?? 0;
  if (!arabic && !latin) return undefined;
  if (Math.abs(arabic - latin) <= TOO_CLOSE * Math.max(arabic, latin)) {
    const first = text.match(FIRST_LETTER)?.[0];
    return first && ARABIC_LETTER.test(first) ? "rtl" : "ltr";
  }
  return arabic > latin ? "rtl" : "ltr";
}
