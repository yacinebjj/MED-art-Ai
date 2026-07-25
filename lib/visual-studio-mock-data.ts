/**
 * Concrete, testable example for the "Visual Studio" feature, built from the
 * same course used everywhere else in the demo (Appendicite Aiguë) — so a
 * viewer can compare this mode directly against Explication/Résumé/QCM on
 * identical content. Shaped exactly like the output of
 * lib/ai/generate-visual-studio.ts, so swapping in real AI output later is a
 * drop-in replacement.
 */
import type { DecisionTreeData, DiseaseJourneyData } from "@/lib/visual-studio-types";

export const MOCK_APPENDICITIS_JOURNEY: DiseaseJourneyData = {
  title: "Appendicite aiguë",
  steps: [
    {
      stage: "normal_organ",
      title: "L'appendice sain",
      summary: "Un petit diverticule creux au fond du cæcum, sans rôle digestif majeur connu.",
      details:
        "L'appendice vermiforme est un tube borgne de 6 à 10 cm implanté à la face postéro-interne du cæcum, au niveau de la jonction des trois bandelettes coliques. Sa paroi contient un tissu lymphoïde abondant, surtout chez l'enfant et l'adolescent, ce qui en fait un organe immunitaire actif plutôt qu'un vestige inutile. Sa lumière est étroite et se draine normalement dans le cæcum. Sa position anatomique est variable d'un individu à l'autre (rétro-cæcale, pelvienne, sous-hépatique...), ce qui explique la grande variabilité des tableaux cliniques de l'appendicite.",
      keyPoints: [
        "Tube borgne de 6-10 cm au fond du cæcum",
        "Riche en tissu lymphoïde, surtout chez le sujet jeune",
        "Position anatomique très variable (rétro-cæcale la plus fréquente)",
      ],
    },
    {
      stage: "risk_factors",
      title: "Terrain à risque",
      summary: "Pic de fréquence entre 10 et 30 ans, sans cause unique clairement identifiée.",
      details:
        "L'appendicite aiguë est la première cause de chirurgie abdominale en urgence, avec un pic d'incidence entre 10 et 30 ans et une légère prédominance masculine. Les antécédents familiaux augmentent modestement le risque. Une alimentation pauvre en fibres est classiquement évoquée comme favorisant la stase fécale et donc l'obstruction, mais son rôle causal reste débattu. Dans les régions tropicales, les parasitoses intestinales (ascaris) sont une cause d'obstruction additionnelle à connaître.",
      keyPoints: [
        "Pic entre 10 et 30 ans",
        "Légère prédominance masculine",
        "Ascaris : cause d'obstruction fréquente en zone tropicale",
      ],
    },
    {
      stage: "pathophysiology",
      title: "De l'obstruction à l'ischémie",
      summary: "Une obstruction de la lumière déclenche une cascade inflammatoire puis ischémique.",
      details:
        "Tout commence par une obstruction de la lumière appendiculaire, le plus souvent par un stercolithe chez l'adulte, ou par une hyperplasie lymphoïde réactionnelle chez le jeune. En amont de l'obstacle, la sécrétion muqueuse persiste alors que le drainage est bloqué : la pression intraluminale augmente. Cette hyperpression comprime d'abord le drainage veineux et lymphatique, provoquant œdème et prolifération bactérienne, puis, si elle persiste, comprime la vascularisation artérielle : c'est l'ischémie pariétale, qui aboutit à la nécrose puis à la perforation si rien n'est fait.",
      keyPoints: [
        "Obstruction initiale le plus souvent par un stercolithe",
        "Hyperpression intraluminale progressive",
        "Séquence œdème → ischémie → nécrose → perforation",
      ],
    },
    {
      stage: "symptoms",
      title: "Douleur migratrice et signes péritonéaux",
      summary: "Douleur périombilicale migrant en fosse iliaque droite, fièvre modérée, nausées.",
      details:
        "Le tableau classique associe une douleur initialement périombilicale, sourde et mal systématisée, qui migre en quelques heures vers la fosse iliaque droite où elle devient plus vive et localisée. S'y ajoutent typiquement une anorexie, des nausées ou vomissements, et une fièvre modérée (38-38,5°C). L'examen retrouve une défense en regard du point de Mac Burney et un signe de Blumberg (douleur à la décompression). Chez l'enfant, la personne âgée et la femme enceinte, le tableau est souvent atypique, ce qui retarde fréquemment le diagnostic.",
      keyPoints: [
        "Douleur périombilicale migrant vers la fosse iliaque droite",
        "Fièvre modérée, anorexie, nausées",
        "Défense + signe de Blumberg au point de Mac Burney",
        "Présentations atypiques fréquentes chez l'enfant et la personne âgée",
      ],
    },
    {
      stage: "diagnosis",
      title: "Un diagnostic avant tout clinique",
      summary: "Score clinique, biologie inflammatoire, puis imagerie en cas de doute.",
      details:
        "Le diagnostic reste avant tout clinique, aidé par des scores comme le score d'Alvarado. La biologie retrouve typiquement une hyperleucocytose à polynucléaires neutrophiles et une CRP élevée, mais leur normalité n'élimine pas le diagnostic. L'échographie abdominale est l'examen de première intention, surtout chez l'enfant et la femme enceinte, recherchant un appendice épaissi et non compressible. Le scanner abdomino-pelvien injecté est l'examen de référence chez l'adulte en cas de doute, mais reste souvent indisponible en zone rurale, où la décision doit alors s'appuyer sur la seule clinique.",
      keyPoints: [
        "Score d'Alvarado pour structurer la probabilité clinique",
        "Hyperleucocytose à PNN et CRP élevée, non spécifiques",
        "Échographie en première intention chez l'enfant et la femme enceinte",
        "En l'absence d'imagerie : la clinique a le dernier mot",
      ],
    },
    {
      stage: "treatment",
      title: "Appendicectomie, le plus souvent cœlioscopique",
      summary: "Chirurgie en urgence, idéalement par cœlioscopie, sous couverture antibiotique.",
      details:
        "Le traitement de référence est l'appendicectomie chirurgicale en urgence, réalisée préférentiellement par voie cœlioscopique qui réduit la durée d'hospitalisation et les complications pariétales par rapport à la laparotomie. Une antibiothérapie péri-opératoire est systématique, prolongée en cas de perforation ou d'abcès constitué. En zone isolée, l'antibiothérapie seule peut être une option d'attente avant un transfert, mais ne remplace pas la chirurgie en cas de signe de gravité.",
      keyPoints: [
        "Appendicectomie en urgence, voie cœlioscopique privilégiée",
        "Antibioprophylaxie péri-opératoire systématique",
        "Antibiothérapie d'attente possible en zone isolée, jamais un traitement définitif seul",
      ],
    },
    {
      stage: "complications",
      title: "Perforation, péritonite, abcès",
      summary: "Sans traitement, l'évolution se fait vers la perforation et la péritonite généralisée.",
      details:
        "En l'absence de prise en charge, la nécrose pariétale progresse jusqu'à la perforation, responsable soit d'un abcès appendiculaire circonscrit par l'épiploon et les anses voisines, soit d'une péritonite généralisée si la contamination diffuse dans toute la cavité péritonéale. La péritonite généralisée est une urgence chirurgicale vitale, avec un risque de choc septique. Chaque heure de retard, notamment loin d'un hôpital, augmente ce risque : c'est le fil rouge de toute la prise en charge en zone isolée.",
      keyPoints: [
        "Perforation appendiculaire en l'absence de traitement",
        "Abcès circonscrit vs péritonite généralisée",
        "Risque de choc septique en cas de péritonite",
        "Loin de l'hôpital, chaque heure de retard aggrave le pronostic",
      ],
    },
  ],
};

export const MOCK_APPENDICITIS_DECISION_TREE: DecisionTreeData = {
  title: "Démarche diagnostique devant une suspicion d'appendicite aiguë",
  root: {
    id: "fid-pain",
    type: "question",
    label: "Douleur suspecte de fosse iliaque droite ?",
    detail:
      "Douleur périombilicale ayant migré vers la fosse iliaque droite (point de Mac Burney), avec ou sans fièvre, nausées ou défense associées.",
    children: [
      {
        id: "initial-workup",
        type: "test",
        label: "Bilan initial : NFS-CRP, bandelette urinaire, β-hCG si femme en âge de procréer",
        detail:
          "Élimine systématiquement une infection urinaire et une grossesse extra-utérine avant de retenir le diagnostic d'appendicite — c'est un réflexe automatique, jamais une option.",
        children: [
          {
            id: "pregnancy-positive",
            type: "decision",
            label: "β-hCG positif chez une femme en âge de procréer",
            children: [
              {
                id: "outcome-ectopic",
                type: "outcome",
                label: "Grossesse extra-utérine à éliminer en urgence",
                outcomeSeverity: "urgent",
                detail:
                  "Échographie pelvienne et avis gynécologique en urgence avant toute autre démarche diagnostique — une grossesse extra-utérine rompue engage le pronostic vital.",
              },
            ],
          },
          {
            id: "severity-check",
            type: "decision",
            label: "β-hCG négatif ou non applicable — signes de gravité présents ?",
            detail:
              "Défense abdominale généralisée, ventre de bois, fièvre supérieure à 39°C avec frissons, ou altération marquée de l'état général.",
            children: [
              {
                id: "outcome-peritonitis",
                type: "outcome",
                label: "Péritonite / appendicite compliquée probable",
                outcomeSeverity: "urgent",
                detail:
                  "Transfert chirurgical immédiat sans attendre l'imagerie : le tableau clinique suffit à poser l'indication opératoire en urgence.",
              },
              {
                id: "imaging-availability",
                type: "decision",
                label: "Pas de signe de gravité — imagerie disponible sur place ?",
                children: [
                  {
                    id: "ultrasound",
                    type: "test",
                    label: "Échographie abdominale (1re intention, surtout enfant et femme enceinte)",
                    detail:
                      "Recherche un appendice épaissi (diamètre > 6-8 mm), non compressible, parfois avec un stercolithe visible.",
                    children: [
                      {
                        id: "ultrasound-positive",
                        type: "decision",
                        label: "Appendice épaissi et non compressible visualisé",
                        children: [
                          {
                            id: "outcome-confirmed",
                            type: "outcome",
                            label: "Appendicite confirmée : appendicectomie",
                            outcomeSeverity: "urgent",
                            detail:
                              "Appendicectomie en urgence, voie cœlioscopique privilégiée, sous couverture antibiotique péri-opératoire.",
                          },
                        ],
                      },
                      {
                        id: "ultrasound-inconclusive",
                        type: "decision",
                        label: "Échographie normale ou non concluante",
                        children: [
                          {
                            id: "outcome-alternative",
                            type: "outcome",
                            label: "Diagnostic alternatif à rechercher / surveillance",
                            outcomeSeverity: "favorable",
                            detail:
                              "Réexaminer à 6-12h : une échographie normale n'élimine pas totalement le diagnostic si la clinique reste évocatrice. Envisager un scanner si disponible et le doute persiste.",
                          },
                        ],
                      },
                    ],
                  },
                  {
                    id: "no-imaging",
                    type: "test",
                    label: "Imagerie indisponible (zone rurale, hôpital éloigné)",
                    detail:
                      "Situation fréquente en pratique isolée : la décision repose alors sur la seule clinique et le contexte logistique.",
                    children: [
                      {
                        id: "clinical-score-check",
                        type: "decision",
                        label: "Score clinique (Alvarado) élevé ou trajet vers l'hôpital long ?",
                        children: [
                          {
                            id: "outcome-transfer-on-doubt",
                            type: "outcome",
                            label: "Transfert chirurgical sur le seul doute clinique",
                            outcomeSeverity: "urgent",
                            detail:
                              "Mieux vaut un transfert qui se révèle inutile qu'un retard fatal : loin de l'hôpital, on ne peut pas se permettre d'attendre une certitude à 100%.",
                          },
                          {
                            id: "outcome-observation",
                            type: "outcome",
                            label: "Score faible et hôpital proche : surveillance rapprochée",
                            outcomeSeverity: "favorable",
                            detail:
                              "Réexamen systématique à 6-12h, avec consigne stricte de reconsulter immédiatement en cas d'aggravation.",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};
