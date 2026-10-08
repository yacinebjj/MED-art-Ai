/**
 * Small-talk detector for the chat routes (course Copilot and MedArt
 * Assistant): a greeting, a thank-you or a goodbye doesn't need the paid
 * medical model, and must not use one of the student's premium messages.
 *
 * Deliberately conservative: a message is small talk only when EVERY word in
 * it belongs to the vocabulary below (plus emoji and punctuation), so
 * "bonjour, c'est quoi l'HTA ?" or "merci, et le traitement ?" keep the
 * medical model. Words that usually continue a medical exchange ("oui",
 * "ok", "vas-y", "continue") are left out on purpose: after an answer they
 * mean "go on", which needs the full model. A miss only costs one premium
 * message; a false positive would degrade a real answer.
 */

const MAX_SMALL_TALK_CHARS = 60;
const MAX_SMALL_TALK_WORDS = 8;

const SMALL_TALK_WORDS = new Set([
  // Greetings (French, English, Darija in Latin script)
  "salut", "slt", "bonjour", "bjr", "bonsoir", "bsr", "hello", "hi", "hey", "coucou", "cc", "yo", "wesh", "salam", "slm",
  "salamou", "salamu", "assalam", "assalamu", "alaykoum", "alikoum", "alaikoum", "alaikum", "aleykoum", "marhba", "ahlan", "sbah", "lkhir", "lkher", "msa",
  // How are you
  "ca", "cava", "va", "vas", "comment", "allez", "how", "are", "you", "u", "doing", "labas", "lbas", "wach", "wech", "rak", "raki", "rakom", "bien", "bkhir", "hamdoullah", "hamdoulah", "lhamdoulah",
  // Thanks
  "merci", "mercii", "merciii", "beaucoup", "thanks", "thank", "thx", "saha", "sahit", "sahitou", "yaatik", "choukran", "chokran", "shukran",
  // Goodbye
  "bye", "byebye", "revoir", "au", "a", "plus", "bientot", "ciao", "beslama", "bslama", "bonne", "nuit", "soiree", "journee",
  // Fillers that only ever decorate the above
  "et", "toi", "vous", "tu", "medart", "docteur", "doc", "lol", "mdr", "haha", "hihi", "😊", "🙂", "👋", "🙏", "❤️", "👍",
]);

/** Same set in Arabic script, compared word by word after normalisation. */
const SMALL_TALK_ARABIC_WORDS = new Set([
  "سلام", "السلام", "عليكم", "مرحبا", "اهلا", "أهلا", "صباح", "مساء", "الخير", "النور", "واش", "راك", "راكي", "لاباس", "بخير", "الحمد", "لله", "شكرا", "صحة", "صحيت", "يعطيك", "بسلامة", "مع", "السلامة", "كيفاش", "كيف", "حالك",
]);

/** Lowercase, Latin accents and Arabic diacritics/hamza marks removed ("ça" → "ca", "أهلا" → "اهلا"), punctuation turned into spaces. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ًͯ-ٰٟ]/g, "")
    .replace(/[’'`]/g, " ")
    .replace(/[!?.,;:()"«»…\-_*~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True for a message that is only a greeting, a thank-you, a goodbye or "how are you" — never for anything with a real question in it. */
export function isSmallTalk(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_SMALL_TALK_CHARS) return false;
  const words = normalise(trimmed).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_SMALL_TALK_WORDS) return false;
  return words.every((word) => VOCABULARY.has(word) || /^[\p{Extended_Pictographic}️‍]+$/u.test(word));
}

/** Both word lists, normalised exactly like the incoming message. */
const VOCABULARY = new Set([...SMALL_TALK_WORDS, ...SMALL_TALK_ARABIC_WORDS].map(normalise));
