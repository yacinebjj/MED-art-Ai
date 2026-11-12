/**
 * The first name a greeting shows ("Bonjour Yacine"), taken from the
 * profile's full name exactly as the student typed it at sign-up.
 *
 * - A name typed all in lower case ("yacine") or all in capitals ("YACINE",
 *   the habit of Algerian administrative forms) is set in title case.
 * - A name that already carries its own mixed casing ("McKenzie") is left
 *   exactly as written: that casing is deliberate.
 * - Each part of a compound first name is capitalised ("jean-marc" →
 *   "Jean-Marc", "n'dri" → "N'Dri").
 * - Scripts without letter case (Arabic, Tifinagh) come back unchanged.
 *
 * Null for a missing or blank name, so each caller keeps its own fallback.
 */
export function displayFirstName(fullName: string | null | undefined): string | null {
  if (typeof fullName !== "string") return null;
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  if (!first) return null;

  const lower = first.toLocaleLowerCase("fr");
  const isUniformCase = first === lower || first === first.toLocaleUpperCase("fr");
  if (!isUniformCase) return first;

  // The character opening each part takes a capital; caseless characters ignore it.
  return lower.replace(/(^|[-'’])([^-'’])/g, (_match, separator: string, letter: string) => separator + letter.toLocaleUpperCase("fr"));
}
