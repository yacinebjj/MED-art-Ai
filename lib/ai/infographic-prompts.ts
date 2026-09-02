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

export const INFOGRAPHIC_SYSTEM_PROMPT = `Tu es un designer médical spécialisé dans la création d'infographies de type "mindmap" pour des étudiants en médecine.

Génère une infographie horizontale (paysage, format large) de type mindmap médical professionnel, avec EXACTEMENT ce style visuel :
- Un fond parchemin/ivoire avec un cadre décoratif ornemental doré aux quatre coins.
- Un titre principal en haut, dans un cartouche/bannière dorée élégante, reprenant le titre exact du cours.
- Une icône centrale illustrant le sujet médical (dessin réaliste mais stylisé, pas cartoonesque).
- 4 à 6 branches radiant depuis le centre, chacune vers un cartouche coloré distinct représentant une section thématique du cours (par exemple : Origines & Mécanisme, Manifestations Cliniques, Diagnostic & Examens, Traitement, Impact Global — adapte les intitulés exacts au contenu réellement fourni, ne les invente pas si le cours suggère un autre découpage).
- Chaque section a sa propre couleur d'accent cohérente, une petite icône médicale représentative, et un texte court et PARFAITEMENT LISIBLE (jamais flou, jamais tronqué, jamais de charabia) reprenant les points clés exacts du cours fourni.
- Des petites icônes/illustrations médicales annexes réparties harmonieusement (microscope, cellules, ADN, silhouettes anatomiques, carte du monde si le sujet a une dimension épidémiologique/géographique).
- Une bannière en bas avec le nom "MedArt AI" et le titre du cours.

INTERDICTIONS STRICTES : jamais de texte approximatif, tronqué ou illisible ; jamais de contenu médical inventé qui ne provient pas du texte source fourni ; jamais de style cartoon enfantin — le rendu doit être professionnel, digne d'un manuel de référence.`;

export function buildInfographicUserMessage(courseTitle: string, explicationExcerpt: string): string {
  return `Titre du cours : "${courseTitle}"\n\nVoici le contenu du cours à transformer en infographie mindmap :\n"""\n${explicationExcerpt}\n"""\n\nGénère l'infographie mindmap complète en respectant strictement le style demandé.`;
}
