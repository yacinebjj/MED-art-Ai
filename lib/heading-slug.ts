/**
 * Deterministic text -> id slug, shared by lib/markdown.tsx (assigns the id
 * to every rendered `##` heading) and lib/weakness-matching.ts (computes the
 * target id to scroll to) - both MUST slugify identically or a "Revoir la
 * notion ciblee" click would resolve to an id that doesn't exist in the DOM.
 */
const ACCENTED_CHARS: Record<string, string> = {
  à: "a", â: "a", ä: "a", á: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  î: "i", ï: "i", í: "i", ì: "i",
  ô: "o", ö: "o", ó: "o", ò: "o",
  ù: "u", û: "u", ü: "u", ú: "u",
  ç: "c", ñ: "n", œ: "oe", æ: "ae",
};

function stripAccents(text: string): string {
  return text.replace(/[àâäáéèêëîïíìôöóòùûüúçñœæ]/gi, (char) => ACCENTED_CHARS[char.toLowerCase()] ?? char);
}

export function slugifyHeading(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
