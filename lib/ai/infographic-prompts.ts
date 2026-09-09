/**
 * "Infographie / Mindmap" — google/gemini-3.1-flash-image-preview (Nano
 * Banana 2) via OpenRouter (lib/ai/openrouter.ts's generateOpenRouterImage),
 * generating a single reference-style medical mindmap image from a course's
 * own Explication text. See app/api/studio/infographic/route.ts for the
 * cache-then-generate pipeline this feeds, and lib/studio-infographic-cache.ts
 * for the cross-student cache that makes this a one-time cost per course.
 *
 * This exact prompt was validated against a real test generation (2026-09-02,
 * appendicitis course explication) before being wired into production — the
 * output matched the requested reference style closely: parchment
 * background, gold ornamental corners, central anatomical illustration,
 * color-coded radiating section cartouches with icons, fully legible French
 * text drawn from the source content (no gibberish), bottom banner with app
 * + course name.
 */

// Same bounding discipline as MAX_EXPLICATION_CHARS_FOR_FLASHCARDS
// (app/api/flashcards/generate/route.ts) — an image-generation prompt gains
// nothing from the full 32,000-token Explication ceiling; a well-organized
// excerpt produces a cleaner, more legible mindmap than an overlong one, and
// costs a little less in prompt tokens (though the IMAGE output itself, not
// the text prompt, dominates this call's real cost).
export const MAX_EXPLICATION_CHARS_FOR_INFOGRAPHIC = 20_000;

/**
 * Model choice for the Studio "Infographie" tile's pre-generation menu.
 * "nano-banana-2" is the ORIGINAL, sole hardcoded model this feature shipped
 * with (google/gemini-3.1-flash-image-preview) — kept as the default so an
 * omitted `model` behaves identically to before. "nano-banana" (its
 * predecessor, google/gemini-2.5-flash-image-preview) is offered as the
 * second, distinct visual style.
 *
 * HONESTY NOTE: unlike nano-banana-2 (validated by a real test generation —
 * see this file's header comment), "nano-banana" has NOT been verified with
 * a real OpenRouter call in this session — no financial authorization was
 * given for a live test of this specific id. It is a well-known, widely
 * publicized model (Gemini 2.5 Flash Image, viral under the "Nano Banana"
 * name), so the id is offered with reasonable confidence, but if it turns
 * out wrong the failure is loud and explicit (OpenRouterError surfaced to
 * the student, see app/api/studio/infographic/route.ts), never silent.
 */
export const INFOGRAPHIC_MODEL_OPTIONS = {
  "nano-banana-2": { id: "google/gemini-3.1-flash-image-preview", labelFr: "Style Nouvelle Génération", labelEn: "New Generation Style" },
  "nano-banana": { id: "google/gemini-2.5-flash-image-preview", labelFr: "Style Classique", labelEn: "Classic Style" },
} as const;
export type InfographicModelKey = keyof typeof INFOGRAPHIC_MODEL_OPTIONS;
export const DEFAULT_INFOGRAPHIC_MODEL_KEY: InfographicModelKey = "nano-banana-2";

function isInfographicModelKey(value: unknown): value is InfographicModelKey {
  return typeof value === "string" && value in INFOGRAPHIC_MODEL_OPTIONS;
}

export function resolveInfographicModelKey(value: unknown): InfographicModelKey {
  return isInfographicModelKey(value) ? value : DEFAULT_INFOGRAPHIC_MODEL_KEY;
}

export type InfographicLanguage = "fr" | "en";
export const DEFAULT_INFOGRAPHIC_LANGUAGE: InfographicLanguage = "fr";

export function resolveInfographicLanguage(value: unknown): InfographicLanguage {
  return value === "en" ? "en" : DEFAULT_INFOGRAPHIC_LANGUAGE;
}

export function buildInfographicSystemPrompt(language: InfographicLanguage): string {
  const base = `Tu es un designer médical spécialisé dans la création d'infographies de type "mindmap" pour des étudiants en médecine.

Génère une infographie horizontale (paysage, format large) de type mindmap médical professionnel, avec EXACTEMENT ce style visuel :
- Un fond parchemin/ivoire avec un cadre décoratif ornemental doré aux quatre coins.
- Un titre principal en haut, dans un cartouche/bannière dorée élégante, reprenant le titre exact du cours.
- Une icône centrale illustrant le sujet médical (dessin réaliste mais stylisé, pas cartoonesque).
- 4 à 6 branches radiant depuis le centre, chacune vers un cartouche coloré distinct représentant une section thématique du cours (par exemple : Origines & Mécanisme, Manifestations Cliniques, Diagnostic & Examens, Traitement, Impact Global — adapte les intitulés exacts au contenu réellement fourni, ne les invente pas si le cours suggère un autre découpage).
- Chaque section a sa propre couleur d'accent cohérente, une petite icône médicale représentative, et un texte court et PARFAITEMENT LISIBLE (jamais flou, jamais tronqué, jamais de charabia) reprenant les points clés exacts du cours fourni.
- Des petites icônes/illustrations médicales annexes réparties harmonieusement (microscope, cellules, ADN, silhouettes anatomiques, carte du monde si le sujet a une dimension épidémiologique/géographique).
- Une bannière en bas avec le nom "MedArt AI" et le titre du cours.

INTERDICTIONS STRICTES : jamais de texte approximatif, tronqué ou illisible ; jamais de contenu médical inventé qui ne provient pas du texte source fourni ; jamais de style cartoon enfantin — le rendu doit être professionnel, digne d'un manuel de référence.`;

  if (language === "fr") return base;
  return `${base}

INSTRUCTION DE LANGUE OBLIGATOIRE : tout le texte visible dans l'infographie (titres, cartouches, légendes) doit être rédigé en ANGLAIS, jamais en français, tout en conservant strictement le même style visuel et la même rigueur ci-dessus.`;
}

export function buildInfographicUserMessage(courseTitle: string, explicationExcerpt: string): string {
  return `Titre du cours : "${courseTitle}"\n\nVoici le contenu du cours à transformer en infographie mindmap :\n"""\n${explicationExcerpt}\n"""\n\nGénère l'infographie mindmap complète en respectant strictement le style demandé.`;
}
