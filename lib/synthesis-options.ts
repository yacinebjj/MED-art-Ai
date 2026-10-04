/**
 * "Résumé Global" customization — shared by the Synthèse page (controls)
 * and app/api/workspace/module-synthesis (server transform).
 *
 * The full per-course summary keeps coming from the cross-student cache
 * (free for everyone); a non-default format, a focus or mnemonics are
 * applied as ONE extra rewriting pass over that summary — so the expensive
 * part stays shared and only the personalization is generated.
 */
import { z } from "zod";

export const SUMMARY_DEPTHS = ["fiche_complete", "synthese_rapide", "tableau_comparatif", "carte_concepts"] as const;
export type SummaryDepth = (typeof SUMMARY_DEPTHS)[number];

export const SynthesisOptionsSchema = z.object({
  depth: z.enum(SUMMARY_DEPTHS),
  /** Free-text focus ("traitement", "sémiologie"…), optional. */
  focus: z.string().trim().max(160).optional(),
  mnemonics: z.boolean(),
});
export type SynthesisOptions = z.infer<typeof SynthesisOptionsSchema>;

export const DEFAULT_SYNTHESIS_OPTIONS: SynthesisOptions = { depth: "fiche_complete", focus: "", mnemonics: false };

export function needsSynthesisTransform(options: SynthesisOptions): boolean {
  return options.depth !== "fiche_complete" || Boolean(options.focus?.trim()) || options.mnemonics;
}

export const SUMMARY_DEPTH_LABELS: Record<SummaryDepth, { label: string; hint: string }> = {
  fiche_complete: { label: "Fiche complète", hint: "Le résumé intégral, cours par cours" },
  synthese_rapide: { label: "Synthèse rapide", hint: "L'essentiel à relire la veille" },
  tableau_comparatif: { label: "Tableau comparatif", hint: "Les cours mis en regard" },
  carte_concepts: { label: "Carte de concepts", hint: "Arborescence des notions" },
};

const DEPTH_INSTRUCTIONS: Record<SummaryDepth, string> = {
  fiche_complete: "Conserve la structure et le niveau de détail du résumé fourni (un chapitre « ## » par cours).",
  synthese_rapide:
    "Condense le résumé en une SYNTHÈSE RAPIDE à relire en 5 minutes : un chapitre « ## » par cours, 4 à 7 puces maximum par cours, uniquement les notions à haut rendement (définitions clés, chiffres, conduites à tenir).",
  tableau_comparatif:
    "Transforme le résumé en TABLEAU COMPARATIF Markdown : une colonne par cours (ou par entité si un seul cours), une ligne par axe pertinent (définition, physiopathologie, clinique, diagnostic, traitement, complications…). Ajoute sous le tableau 3 à 5 puces « À retenir » sur les différences qui piègent.",
  carte_concepts:
    "Transforme le résumé en CARTE DE CONCEPTS sous forme d'arborescence Markdown : un « ## » par cours, puis des listes imbriquées (3 niveaux maximum) qui partent du concept central vers les notions dérivées, chaque nœud en quelques mots.",
};

export function buildSynthesisTransformPrompt(options: SynthesisOptions): string {
  const focus = options.focus?.trim();
  return `Tu es un professeur de médecine qui prépare des fiches de révision pour des étudiants algériens.
On te donne un RÉSUMÉ DE MODULE déjà rédigé (Markdown). Réécris-le selon les consignes ci-dessous.

CONSIGNES :
- ${DEPTH_INSTRUCTIONS[options.depth]}
${focus ? `- PRIORITÉ À : « ${focus} » — développe davantage ce qui s'y rapporte et allège le reste.\n` : ""}${options.mnemonics ? "- Termine par une section « ## 🧠 Moyens mnémotechniques » : 3 à 6 moyens mnémotechniques ORIGINAUX et faciles à retenir, chacun suivi d'une ligne qui explique ce qu'il encode.\n" : ""}- Reste STRICTEMENT fidèle au résumé fourni : n'ajoute aucun fait médical qui n'y figure pas.
- Réponds UNIQUEMENT avec le Markdown final, sans balise de code ni commentaire.`;
}
