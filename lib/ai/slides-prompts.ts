/**
 * Studio "Slides" tab — a mini-deck (SLIDE_COUNT_TARGET slides) in the exact
 * "medical data-viz" style of a real NotebookLM-generated deck (navy/white
 * split panels, pie charts, pictogram-dot grids, annotated body silhouettes,
 * red alert banners), validated against a real reference PDF the product
 * owner supplied. Two-stage generation, see app/api/studio/slides/route.ts:
 *  1. A cheap TEXT call (CHEAP_MODEL) plans SLIDE_COUNT_TARGET coherent,
 *     non-redundant slide briefs from the course's own Explication — this is
 *     what keeps the deck an actual structured narrative instead of N
 *     independent image calls guessing at what to cover.
 *  2. SLIDE_COUNT_TARGET parallel image calls (generateOpenRouterImage,
 *     lib/ai/openrouter.ts), each given the SAME style prompt plus its own
 *     planned brief — validated live (2026-09-02, real 4-slide test): the
 *     shared style prompt alone (no reference image passed) was enough to
 *     keep every slide visually consistent (same navy/white/red palette,
 *     same flat-icon language) across independent calls.
 */

import { z } from "zod";

// Same bounding discipline as MAX_EXPLICATION_CHARS_FOR_INFOGRAPHIC — the
// planning call gains nothing from the full 32,000-token Explication
// ceiling, and a tighter excerpt keeps the (cheap, but not free) planning
// call's own prompt tokens bounded too.
export const MAX_EXPLICATION_CHARS_FOR_SLIDES = 20_000;

// 1 title + 4 content + 1 closing — a real "mini-deck" (the product ask),
// deliberately the middle of the requested 5-10 range rather than the
// ceiling: each additional slide is a real ~$0.07-0.14 addition (confirmed
// live), and 6 already covers title/mechanism/clinical/epidemiology-or-
// diagnostic/treatment/closing-alert without padding for padding's sake.
export const SLIDE_COUNT_TARGET = 6;

export const SlideOutlineItemSchema = z.object({
  role: z.enum(["title", "content", "closing"]),
  title: z.string().min(1),
  brief: z.string().min(1),
});

export const SlideOutlineSchema = z.object({
  slides: z.array(SlideOutlineItemSchema).min(3),
});

export type SlideOutlineItem = z.infer<typeof SlideOutlineItemSchema>;

export const SLIDE_OUTLINE_SYSTEM_PROMPT = `Tu es un directeur de contenu pour une présentation médicale de type "data-viz" (façon NotebookLM). À partir d'un cours de médecine, structure un plan de ${SLIDE_COUNT_TARGET} diapositives cohérentes, sans redondance, couvrant les points les plus importants du cours dans un ordre pédagogique logique.

La PREMIÈRE diapositive a TOUJOURS role="title" (page de titre). La DERNIÈRE a TOUJOURS role="closing" (message clé le plus important à retenir, souvent une alerte/urgence si le cours en comporte une). Les diapositives du milieu ont role="content", chacune couvrant UN aspect distinct du cours (mécanisme, signes cliniques, épidémiologie, diagnostic, traitement...), en variant les types de visualisation suggérés dans "brief" (diagramme en étapes avec flèches, silhouette corporelle annotée, camembert, grille de pictogrammes/pastilles, tableau comparatif, liste à puces avec icônes) pour ne jamais suggérer deux fois le même type de visuel consécutivement.

Réponds UNIQUEMENT avec un objet JSON valide, sans balise de bloc de code, de la forme :
{
  "slides": [
    { "role": "title", "title": "...", "brief": "..." },
    { "role": "content", "title": "...", "brief": "..." },
    { "role": "closing", "title": "...", "brief": "..." }
  ]
}
"title" est le titre court de la diapositive (max ~6 mots). "brief" décrit en 2-4 phrases précises et en français exactement ce que cette diapositive doit montrer (le texte réel à afficher, les chiffres exacts s'il y en a, ET le type de visuel suggéré), en te basant STRICTEMENT sur le contenu du cours fourni — jamais d'invention de faits médicaux qui n'y figurent pas.`;

export function buildSlideOutlineUserMessage(courseTitle: string, explicationExcerpt: string): string {
  return `Titre du cours : "${courseTitle}"\n\nContenu du cours :\n"""\n${explicationExcerpt}\n"""\n\nGénère le plan de ${SLIDE_COUNT_TARGET} diapositives demandé.`;
}

/**
 * Deliberately generic (no reference to the course's own subject) — this
 * exact prompt is sent unchanged on every one of the parallel image calls,
 * which is what keeps every slide in a deck visually consistent with each
 * other despite being independent OpenRouter requests with no shared
 * context between them.
 */
export const SLIDE_STYLE_SYSTEM_PROMPT = `Tu es un designer de présentations médicales professionnelles, dans le style exact d'un slide généré par NotebookLM : format 16:9 paysage, palette bleu marine profond (#1a3a5c) + blanc/gris très clair, un unique accent rouge/cramoisi réservé aux alertes et points critiques. Typographie sans-serif bold, grande et parfaitement lisible, jamais de texte flou ni tronqué. Compositions en panneaux (split gauche/droite navy+blanc), diagrammes vectoriels simples et plats (pas de rendu photoréaliste), graphiques en camembert propres, graphiques en grille de pictogrammes (pastilles), silhouettes corporelles annotées, icônes de contour simples. Bandeau de marque "MedArt AI" discret en bas à droite de chaque diapositive.

INTERDICTIONS STRICTES : jamais de texte inventé hors du contenu fourni ; jamais de texte illisible ou tronqué ; jamais de style cartoon enfantin ; jamais la mention "NotebookLM" ou toute autre marque tierce.`;

export function buildSlideImageUserMessage(
  slideIndex: number,
  totalSlides: number,
  courseTitle: string,
  slide: SlideOutlineItem
): string {
  return `Cours : "${courseTitle}". Génère la diapositive ${slideIndex}/${totalSlides}, intitulée "${slide.title}" (rôle : ${slide.role}). ${slide.brief}`;
}

/**
 * Used only if the planning call itself fails or returns something
 * un-parseable — a real deck degraded to a fixed, generic structure is
 * still better than the whole "Slides" tab failing outright over a text
 * model hiccup on what's otherwise a pure image-generation feature.
 */
export const FALLBACK_SLIDE_OUTLINE: SlideOutlineItem[] = [
  { role: "title", title: "Vue d'ensemble", brief: "Page de titre reprenant le nom exact du cours." },
  { role: "content", title: "Mécanisme", brief: "Résume en 2-3 étapes le mécanisme principal décrit dans le cours, avec un diagramme en flèches." },
  { role: "content", title: "Signes Cliniques", brief: "Liste les signes cliniques les plus importants du cours, avec des icônes simples." },
  { role: "content", title: "Diagnostic", brief: "Résume la démarche diagnostique décrite dans le cours." },
  { role: "content", title: "Traitement", brief: "Résume la prise en charge/traitement décrit dans le cours." },
  { role: "closing", title: "À Retenir", brief: "Le message clé le plus important du cours, en une phrase forte." },
];
