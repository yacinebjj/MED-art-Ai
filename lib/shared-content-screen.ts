/**
 * Screening of AI-generated content shared between students
 * (lib/studio-content-cache.ts).
 *
 * A Studio section generated for one student is served to the next student
 * whose course is the same (exact match) or nearly the same (fuzzy match,
 * then adapted by the model, which is told to keep the common content as
 * is). A course crafted to plant something — a link, an e-mail address, a
 * phone number, or instructions aimed at the model — could otherwise ride
 * along into other students' material. So:
 *  - shareableContent(): nothing carrying contact details, or produced from
 *    a course text carrying model-directed instructions, enters the cache;
 *  - servableContent(): a cached section is served — or used as the base of
 *    an adaptation — only if it carries no model-directed instructions and
 *    every contact detail in it also appears in THIS student's own course
 *    text.
 * Both err on the side of "not shared": a false alarm only costs one real
 * generation, never a wrong answer.
 */

/** Links, domains, e-mail addresses and phone numbers (international, and Algerian mobiles). */
const CONTACT_PATTERNS: readonly RegExp[] = [
  /\bhttps?:\/\/[^\s"'<>\])}]+/gi,
  /\bwww\.[^\s"'<>\])}]+/gi,
  /\b[a-z0-9][a-z0-9-]{0,62}\.(?:com|net|org|info|io|me|xyz|link|site|online|shop|store|app|dz|fr|top|club|live|ly|gl|gg|tk)\b(?:\/[^\s"'<>\])}]*)?/gi,
  /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi,
  /(?:\+|\b00)[1-9]\d{0,2}(?:[\s.-]?\d){6,12}\b/g,
  /\b0[5-7](?:[\s.-]?\d){8}\b/g,
];

/** Text addressed to the model rather than to a student. */
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\b(?:ignore[rsz]?|oublie[rsz]?|disregard|forget|override)\b[^.\n]{0,60}?\b(?:instructions?|consignes?|prompts?|previous|above|ci-dessus|pr[ée]c[ée]dente?s?)\b/i,
  /\b(?:system prompt|prompt syst[èe]me|developer message|jailbreak)\b/i,
  /<\|?\s*(?:system|assistant|im_start|im_end)\s*\|?>/i,
  /\[\/?INST\]/,
  /\byou are (?:now )?(?:chatgpt|an? (?:ai|assistant|language model))\b/i,
  /\btu es (?:maintenant |désormais )?(?:une? )?(?:ia|intelligence artificielle|assistant|chatgpt)\b/i,
  /\b(?:nouvelles? instructions?|new instructions?)\s*:/i,
];

/** Every contact detail found in `text`. */
function contactsIn(text: string): string[] {
  const found: string[] = [];
  for (const pattern of CONTACT_PATTERNS) {
    for (const match of text.match(pattern) ?? []) found.push(match);
  }
  return found;
}

/** Whether `text` carries text addressed to the model. */
export function hasModelInstructions(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));
}

/** How a contact is compared: phone numbers by their digits, the rest without scheme, "www." or trailing punctuation. */
function contactKey(contact: string): { digits: boolean; key: string } {
  if (/^[+\d\s.-]+$/.test(contact)) return { digits: true, key: contact.replace(/\D/g, "") };
  const key = contact
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[.,;:!?/]+$/, "");
  return { digits: false, key };
}

/**
 * Whether a freshly generated section may enter the shared cache.
 *
 * @param sourceText - The course text it was generated from.
 * @param data - The validated section.
 * @returns false when the output carries any contact detail or text aimed at
 *          the model, or the source carries model-directed instructions.
 */
export function shareableContent(sourceText: string, data: unknown): boolean {
  const output = JSON.stringify(data) ?? "";
  return !hasModelInstructions(sourceText) && !hasModelInstructions(output) && contactsIn(output).length === 0;
}

/**
 * Whether a cached section may be served to — or adapted for — a student.
 *
 * @param data - The cached section.
 * @param sourceText - That student's own course text.
 * @returns false when the section carries text aimed at the model, or a
 *          contact detail that does not appear in `sourceText`.
 */
export function servableContent(data: unknown, sourceText: string): boolean {
  const content = JSON.stringify(data) ?? "";
  if (hasModelInstructions(content)) return false;
  const contacts = contactsIn(content);
  if (contacts.length === 0) return true;
  const sourceLower = sourceText.toLowerCase();
  const sourceDigits = sourceText.replace(/\D/g, "");
  return contacts.every((contact) => {
    const { digits, key } = contactKey(contact);
    if (!key) return true;
    return digits ? sourceDigits.includes(key) : sourceLower.includes(key);
  });
}
