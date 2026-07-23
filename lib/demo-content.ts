import {
  BookOpenText,
  ScrollText,
  AlertTriangle,
  Lightbulb,
  Stethoscope,
  ListChecks,
  type LucideIcon,
} from "lucide-react";

export type DemoSectionId =
  | "explication"
  | "resume"
  | "pieges"
  | "astuces"
  | "cas_clinique"
  | "qcm";

export interface DemoSection {
  id: DemoSectionId;
  label: string;
  icon: LucideIcon;
  content: string;
}

export const DEMO_SECTIONS: DemoSection[] = [
  {
    id: "explication",
    label: "Explication Ultra-Détaillée",
    icon: BookOpenText,
    content: `# L'Appendicite Aiguë : La bombe à retardement de l'abdomen 💣

Bonjour Yacine ! Prêt à décortiquer l'appendicite ? Oublie les résumés ennuyeux, on va voir ça comme de vrais cliniciens.

## 1. Anatomie : Le "tube inutile" qui fait des siennes
Imagine l'appendice comme un petit doigt de gant accroché à ton cæcum (le début du gros intestin). Normalement, il ne sert pas à grand-chose. Mais voilà le problème : c'est un cul-de-sac.

> 💡 **L'Astuce du Prof :**
> Tout ce qui est un cul-de-sac dans le corps humain a tendance à s'infecter si ça se bouche. C'est la règle d'or en chirurgie !

## 2. La Physiopathologie : L'histoire d'un embouteillage
Pourquoi ça s'enflamme ? C'est simple :
*   **Chez l'enfant/jeune :** Une hyperplasie lymphoïde (les ganglions gonflent à cause d'un rhume et bouchent l'entrée).
*   **Chez l'adulte :** Un stercolithe (un petit caillou de caca... oui, littéralement) vient bloquer le passage.

Une fois bouché, les bactéries à l'intérieur font la fête, la pression monte, le mur s'étire... et bam, douleur !

## 3. La Clinique : L'enquête de Sherlock Holmes
La douleur classique ne commence JAMAIS en bas à droite.
1. Elle débute autour du nombril (douleur péri-ombilicale, vague, type crampe).
2. Quelques heures plus tard, elle "migre" et se localise précisément dans la Fosse Iliaque Droite (au fameux point de McBurney).`,
  },
  {
    id: "resume",
    label: "Résumé",
    icon: ScrollText,
    content: `## Résumé Express : Appendicite Aiguë

*   **Définition :** Inflammation de l'appendice, cul-de-sac accroché au cæcum.
*   **Cause :** Obstruction de la lumière appendiculaire (hyperplasie lymphoïde chez le jeune, stercolithe chez l'adulte).
*   **Clinique :** Douleur péri-ombilicale migrant vers la Fosse Iliaque Droite (point de McBurney), fièvre modérée, nausées.
*   **Signes associés :** Défense abdominale en FID, signe de Blumberg (douleur à la décompression).
*   **Diagnostic :** Clinique + biologie (hyperleucocytose) + échographie/scanner si doute.
*   **Traitement :** Appendicectomie, en urgence.

> 💡 **Note du prof :** Si tu ne dois retenir qu'une phrase : douleur qui migre du nombril vers la FID = appendicite jusqu'à preuve du contraire.`,
  },
  {
    id: "pieges",
    label: "Les Pièges",
    icon: AlertTriangle,
    content: `## Les Pièges Classiques à l'examen ⚠️

> 💡 **Piège n°1 :** Ne confonds pas la douleur péri-ombilicale initiale avec une gastro-entérite — l'examinateur adore ce piège chez les étudiants pressés.

*   **Chez la femme jeune :** Élimine toujours une grossesse extra-utérine ou une torsion d'annexe avant de conclure trop vite à une appendicite.
*   **Chez la personne âgée :** La présentation est souvent atypique (peu de fièvre, douleur diffuse) — le risque de perforation est plus élevé car le diagnostic est retardé.
*   **Chez l'enfant :** Ne néglige jamais une douleur abdominale fébrile — l'évolution vers la perforation est plus rapide.
*   **Erreur fréquente :** Attendre une hyperleucocytose franche avant d'opérer — une NFS normale n'élimine PAS le diagnostic.`,
  },
  {
    id: "astuces",
    label: "Astuces Mnémotechniques",
    icon: Lightbulb,
    content: `## Astuces Mnémotechniques 🧠

> 💡 **Pour la migration de la douleur :** "Du nombril au point Mc, en passant par la crampe" — retiens le trajet en trois temps : ombilic → diffuse → Fosse Iliaque Droite.

*   **Point de McBurney :** situé au tiers externe de la ligne reliant l'ombilic à l'épine iliaque antéro-supérieure droite — pense à "2/3 - 1/3".
*   **Signe de Blumberg :** la décompression fait plus mal que la compression — "ça fait mal quand on relâche, pas quand on appuie".
*   **Triade clinique :** Douleur FID + Défense + Fièvre = pense appendicite avant tout.`,
  },
  {
    id: "cas_clinique",
    label: "Cas Clinique",
    icon: Stethoscope,
    content: `## Cas Clinique : À toi de jouer, Yacine 🩺

Amine, 19 ans, se présente aux urgences pour une douleur abdominale débutée la veille au soir autour du nombril, de type crampe, puis migrant ce matin vers la fosse iliaque droite. Il présente une fièvre à 38.2°C, des nausées sans vomissement, et une défense à la palpation de la FID.

**Questions :**
1. Quel est ton diagnostic le plus probable, et pourquoi ?
2. Quel signe clinique iras-tu rechercher pour le confirmer ?
3. Quel examen complémentaire demanderais-tu en première intention ?

> 💡 **Indice du prof :** Relis bien la section "Clinique" de l'explication détaillée — la chronologie de la douleur est la clé de ce cas.`,
  },
  {
    id: "qcm",
    label: "Examen QCMs",
    icon: ListChecks,
    content: `## QCM : Teste-toi sur l'Appendicite

**1. Quelle est la cause la plus fréquente d'obstruction appendiculaire chez l'adulte ?**
A. Hyperplasie lymphoïde
B. Stercolithe
C. Tumeur carcinoïde
D. Corps étranger

**2. Le point de McBurney se situe :**
A. Au tiers interne de la ligne ombilic - épine iliaque antéro-supérieure
B. Au tiers externe de cette même ligne
C. Sur la ligne médiane sous-ombilicale
D. Au niveau du flanc gauche

**3. Le signe de Blumberg correspond à :**
A. Une douleur à la palpation profonde
B. Une douleur à la décompression brutale
C. Une douleur uniquement nocturne
D. Une contracture généralisée

> 💡 **Réponses :** 1-B, 2-B, 3-B. Si tu as tout bon, tu es prêt(e) pour la garde de chirurgie !`,
  },
];
