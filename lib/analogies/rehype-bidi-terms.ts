import type { Element, ElementContent, Root, Text } from "hast";

/**
 * Rehype plugin — the fix for the Darija/French "bidi clumping" of the
 * Exemples & Analogies section.
 *
 * In a right-to-left Darija paragraph, a French term ("La Ponction Biopsie
 * Rénale (PBR)", "Geste invasif", "> 0.5") is a left-to-right run with
 * weak/neutral punctuation around it; the Unicode bidi algorithm then
 * reorders parentheses, numbers and the neighbouring Arabic words in ways
 * that scramble the sentence. Wrapping every Latin-script run in its own
 * `dir="ltr"` isolate (rendered as <bdi>) pins it in place: the Arabic flows
 * around it exactly as written.
 *
 * Short runs (a term or a short phrase) become a styled micro-chip; long runs
 * (a whole French sentence) are isolated without the chip styling, so a
 * quoted sentence never turns into a giant pill.
 *
 * Only applied when the section is predominantly Arabic (see parse.ts's
 * `rtl`): an English or French generation keeps ordinary text.
 */

const LATIN = "A-Za-zÀ-ÖØ-öø-ÿŒœÆæ";
// Starts on a Latin letter; may continue through digits, spaces and the
// punctuation that lives INSIDE terms/values ("Critères de Light", "LDH > 0.6",
// "Pleurésie avec épanchement"); ends on a letter, digit, ")" or "%".
const LATIN_RUN = new RegExp(`[${LATIN}](?:[${LATIN}0-9'’\\-–\\s.,:/()%+=<>≥≤]*[${LATIN}0-9)%])?`, "gu");

const CHIP_MAX_CHARS = 42;
const CHIP_MAX_WORDS = 6;

/** Class lists live here (lib/** is in tailwind.config's content globs). */
export const TERM_CHIP_CLASS =
  "mx-0.5 inline-flex max-w-full items-center rounded-md border border-indigo-300/60 bg-gradient-to-b from-white to-indigo-50 px-1.5 py-px align-baseline font-sans text-[0.86em] font-semibold leading-snug text-indigo-800 shadow-[0_1px_0_rgba(99,102,241,0.12)] dark:border-indigo-400/30 dark:from-indigo-400/15 dark:to-indigo-400/5 dark:text-indigo-200";
const LONG_RUN_CLASS = "font-sans";

function isSkippable(node: Element): boolean {
  return node.tagName === "code" || node.tagName === "pre" || node.tagName === "bdi";
}

function hasArabic(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}

function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

function splitText(node: Text): ElementContent[] {
  const value = node.value;
  const out: ElementContent[] = [];
  let last = 0;
  for (const match of value.matchAll(LATIN_RUN)) {
    let run = match[0].replace(/\s+$/, "");
    // Keep a closing ")" only when the run opened it ("(PBR)" stays whole);
    // in "(Carotte)" the "(" sits outside the run, so ")" must stay outside too.
    while (run.endsWith(")") && (run.match(/\(/g) ?? []).length < (run.match(/\)/g) ?? []).length) {
      run = run.slice(0, -1).replace(/\s+$/, "");
    }
    const start = match.index ?? 0;
    if (start > last) out.push({ type: "text", value: value.slice(last, start) });
    const words = run.trim().split(/\s+/).length;
    const chip = run.length <= CHIP_MAX_CHARS && words <= CHIP_MAX_WORDS;
    out.push({
      type: "element",
      tagName: "bdi",
      properties: { dir: "ltr", className: chip ? TERM_CHIP_CLASS.split(" ") : [LONG_RUN_CLASS] },
      children: [{ type: "text", value: run }],
    });
    last = start + run.length;
  }
  if (last === 0) return [node];
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function transform(parent: Root | Element): void {
  const next: ElementContent[] = [];
  for (const child of parent.children as ElementContent[]) {
    if (child.type === "text") {
      next.push(...splitText(child));
    } else if (child.type === "element") {
      if (isSkippable(child)) {
        next.push(child);
      } else if ((child.tagName === "strong" || child.tagName === "b") && !hasArabic(textOf(child))) {
        // A fully-French bold term: isolate the WHOLE <strong> as one
        // left-to-right chip instead of nesting a chip inside bold text.
        child.properties = { ...child.properties, dir: "ltr", dataTerm: "true" };
        next.push(child);
      } else {
        transform(child);
        next.push(child);
      }
    } else {
      next.push(child);
    }
  }
  (parent as Element).children = next;
}

export function rehypeBidiTerms(options: { enabled: boolean }) {
  return (tree: Root) => {
    if (options.enabled) transform(tree);
  };
}
