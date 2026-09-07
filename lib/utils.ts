import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Strips accents so "cœur"/"coeur", "génétique"/"genetique", etc. all match the same keyword. */
function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/g, "oe")
    .toLowerCase();
}

/**
 * Ordered keyword -> emoji map for course titles, checked top to bottom
 * (first match wins) so a more specific category can be listed before a
 * broader one if they'd otherwise collide. Deliberately keyword-based
 * rather than a single regex — easier to extend with one more specialty
 * later without fighting a single giant pattern.
 */
const COURSE_EMOJI_RULES: { keywords: string[]; emoji: string }[] = [
  { keywords: ["tuberculose", "pneumo", "poumon", "respiratoire", "asthme", "bronch"], emoji: "🫁" },
  { keywords: ["cardio", "coeur", "vasculaire", "hypertension"], emoji: "❤️" },
  { keywords: ["neuro", "cerveau", "cervical", "encephal"], emoji: "🧠" },
  { keywords: ["gastro", "digestif", "intestin", "foie", "hepat", "estomac"], emoji: "🍽️" },
  { keywords: ["infectieux", "infection", "microbio", "virus", "bacterie", "parasit"], emoji: "🦠" },
  { keywords: ["endocrino", "diabete", "thyroide", "hormone"], emoji: "🧪" },
  { keywords: ["nephro", "rein", "urinaire", "urolog"], emoji: "🫘" },
  { keywords: ["gyneco", "obstetri", "grossesse", "maternite"], emoji: "🤰" },
  { keywords: ["pediatri", "enfant", "nourrisson"], emoji: "🧒" },
  { keywords: ["dermato", "peau"], emoji: "🩹" },
  { keywords: ["ophtalmo", "oeil", "vision"], emoji: "👁️" },
  { keywords: ["orl", "oreille", "audition"], emoji: "👂" },
  { keywords: ["rhumato", "articulation", "os", "orthopedi", "fracture"], emoji: "🦴" },
  { keywords: ["hemato", "sang", "anemie"], emoji: "🩸" },
  { keywords: ["oncolog", "cancer", "tumeur"], emoji: "🎗️" },
  { keywords: ["psychiatri", "psycho", "sante mentale"], emoji: "🧩" },
  { keywords: ["chirurgi", "operatoire"], emoji: "🔪" },
  { keywords: ["anatomie"], emoji: "🦴" },
  { keywords: ["pharmaco", "medicament"], emoji: "💊" },
  { keywords: ["immuno", "vaccin"], emoji: "🛡️" },
  { keywords: ["dentaire", "dent"], emoji: "🦷" },
];

/** Default when no keyword matches — matches the app's own stethoscope branding (see AnimatedBrandMark). */
const DEFAULT_COURSE_EMOJI = "🩺";

/** Picks a contextual emoji for a course card from its title — see COURSE_EMOJI_RULES. */
export function getCourseEmoji(title: string): string {
  const normalized = normalizeForMatch(title);
  const match = COURSE_EMOJI_RULES.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)));
  return match?.emoji ?? DEFAULT_COURSE_EMOJI;
}
