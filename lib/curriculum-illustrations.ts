/**
 * Temporary "cartoon" illustration for a curriculum card, until the client
 * supplies real drawn assets (see the TODO comment in CurriculumView.tsx for
 * exactly where those images plug in). A native emoji, rendered large, is an
 * honest stand-in — not a claim of a finished illustration.
 *
 * Ordered keyword -> emoji table, most specific first (e.g. dental keywords
 * before the generic "anatomie"/"ortho" rules, so "Orthopédie Dento-Faciale"
 * resolves to a tooth, not a bone). Matched against the module title
 * lowercased with accents stripped. First match wins; falls back to 🩺.
 */
const ILLUSTRATION_RULES: { keywords: string[]; emoji: string }[] = [
  { keywords: ["internat"], emoji: "🎓" },
  { keywords: ["cardio"], emoji: "🫀" },
  { keywords: ["neuro"], emoji: "🧠" },
  { keywords: ["dentaire", "odonto", "dento", "parodont", "prothese", "buccal", "implantolog"], emoji: "🦷" },
  { keywords: ["cytologie", "biologie cellulaire", "cellulaire"], emoji: "🦠" },
  { keywords: ["parasitolog", "infectiolog"], emoji: "🦠" },
  { keywords: ["immunolog"], emoji: "🛡️" },
  { keywords: ["histolog", "microbiolog", "anatomie pathologique", "patholog"], emoji: "🔬" },
  { keywords: ["genetique"], emoji: "🧬" },
  { keywords: ["embryolog"], emoji: "🐣" },
  { keywords: ["endocrino"], emoji: "🦋" },
  { keywords: ["respiratoire", "pneumo"], emoji: "🫁" },
  { keywords: ["gastro", "digestif"], emoji: "🍎" },
  { keywords: ["hemato", "hemobiologie", "sang"], emoji: "🩸" },
  { keywords: ["nephro"], emoji: "💧" },
  { keywords: ["gyneco"], emoji: "🤰" },
  { keywords: ["rhumatolog", "orthoped"], emoji: "🦴" },
  { keywords: ["anatomie"], emoji: "🦴" },
  { keywords: ["pediatr"], emoji: "👶" },
  { keywords: ["ophtalmolog"], emoji: "👁️" },
  { keywords: ["orl"], emoji: "👂" },
  { keywords: ["dermatolog"], emoji: "🧴" },
  { keywords: ["radiolog"], emoji: "🩻" },
  { keywords: ["toxicolog"], emoji: "☠️" },
  { keywords: ["epidemiolog", "hydro-bromatologie", "hydro bromatologie"], emoji: "🌍" },
  { keywords: ["galenique", "pharmacognosie", "botanique", "biologie vegetale"], emoji: "🌿" },
  { keywords: ["medecine legale", "droit"], emoji: "⚖️" },
  { keywords: ["pharmacolog", "therapeutique"], emoji: "💊" },
  { keywords: ["biochimie", "chimie"], emoji: "🧪" },
  { keywords: ["biophysique", "physique"], emoji: "⚡" },
  { keywords: ["physiolog"], emoji: "⚙️" },
  { keywords: ["psy"], emoji: "🧩" },
  { keywords: ["uro"], emoji: "💧" },
  { keywords: ["urgence", "secourisme"], emoji: "🚑" },
  { keywords: ["medecine de travail"], emoji: "👷" },
  { keywords: ["gestion", "economie"], emoji: "💰" },
  { keywords: ["chirurgie"], emoji: "🔪" },
  { keywords: ["hospitaliere"], emoji: "🏥" },
  { keywords: ["industrielle"], emoji: "🏭" },
  { keywords: ["clinique"], emoji: "🩺" },
  { keywords: ["biomathematiques", "biostatistiques", "statistiques"], emoji: "📊" },
  { keywords: ["histoire"], emoji: "📜" },
  { keywords: ["culture generale"], emoji: "🎓" },
  { keywords: ["anglais", "francais", "terminologie"], emoji: "🗣️" },
  { keywords: ["sante sociale", "sciences humaines", "s.s.h"], emoji: "🤝" },
  { keywords: ["informatique"], emoji: "💻" },
  { keywords: ["semiologie"], emoji: "📋" },
];

// eslint-disable-next-line no-misleading-character-class -- deliberately matches the Unicode combining-diacritical-marks block (U+0300-U+036F) left behind by String.normalize("NFD"), e.g. turning "é" into "e" + a combining accent this regex then strips.
const COMBINING_DIACRITICS = /[̀-ͯ]/g;

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(COMBINING_DIACRITICS, "");
}

/** Picks a placeholder "cartoon" emoji for a module/unit title by keyword match — never throws, always returns a renderable character. */
export function getCartoonIllustration(title: string): string {
  const normalized = normalize(title);
  for (const rule of ILLUSTRATION_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.emoji;
    }
  }
  return "🩺";
}
