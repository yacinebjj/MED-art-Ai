import { keyWords, searchWords } from "@/lib/medical-image-relevance";

/**
 * The forms of a FreeMedImage term to look for (app/api/studio/free-med-image),
 * most specific first: as written; its key words alone (no "anatomy",
 * "diagram", "of the"…); then its last two key words (English puts the head
 * noun last: "left ventricle", "mitral valve"); then its first two. Never a
 * single word when the term had more — "ulcer" alone could be any ulcer.
 * Forms that would run the same search are kept once.
 */
export function freeMedImageSearchForms(term: string): string[] {
  const words = keyWords(term);
  const forms = [term, words.join(" ")];
  if (words.length >= 3) forms.push(words.slice(-2).join(" "), words.slice(0, 2).join(" "));
  const seen = new Set<string>();
  return forms.filter((form) => {
    const key = searchWords(form);
    if (!form.trim() || !key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
