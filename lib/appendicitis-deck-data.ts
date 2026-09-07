/**
 * The mandatory, exhaustive 8-slide "L'Appendicite Aiguë" deck for the Visual
 * Presentation Engine — every slide is fully authored, structured data (no
 * markdown walls of text), matching the exact visual type each slide needs.
 */
import type { PresentationDeck } from "@/lib/presentation-types";

export const APPENDICITIS_DECK: PresentationDeck = {
  id: "appendicitis-acute",
  title: "L'Appendicite Aiguë",
  slides: [
    // ─────────────────────────────────────────────────────────────────
    // Slide 1 — Anatomy, Embryology & Physiology (Blue)
    // ─────────────────────────────────────────────────────────────────
    {
      id: "slide-1-anatomy",
      title: "Anatomie, Embryologie & Physiologie",
      subtitle: "L'appendice vermiforme, de l'embryon à l'organe immunitaire",
      theme: "blue",
      domain: "anatomy",
      visualType: "anatomy",
      anatomy: {
        diagramLabel: "Cæcum et appendice vermiforme",
        structures: [
          {
            id: "cecum",
            label: "Cæcum",
            description:
              "Premier segment du côlon droit, en forme de poche borgne, recevant l'iléon terminal via la valvule iléo-cæcale (valvule de Bauhin).",
            x: 28,
            y: 32,
          },
          {
            id: "ileocecal-valve",
            label: "Valvule iléo-cæcale",
            description:
              "Jonction iléo-cæcale, située environ 2 à 3 cm au-dessus de la base de l'appendice — repère de proximité utile en imagerie.",
            x: 20,
            y: 55,
          },
          {
            id: "teniae-coli",
            label: "Convergence des bandelettes coliques (ténias)",
            description:
              "Les trois bandelettes musculaires longitudinales du côlon convergent exactement à la base de l'appendice : c'est le repère chirurgical le plus fiable pour le retrouver, quelle que soit sa position.",
            x: 45,
            y: 48,
          },
          {
            id: "appendix-base",
            label: "Base appendiculaire",
            description:
              "Point fixe et constant chez tout individu, contrairement à la pointe. C'est là que naît l'appendice, sur la face postéro-médiale du cæcum.",
            x: 52,
            y: 58,
          },
          {
            id: "appendix-body",
            label: "Corps de l'appendice",
            description:
              "Tube borgne de 6 à 10 cm (jusqu'à 20 cm dans de rares cas), diamètre 5 à 8 mm, à lumière étroite.",
            x: 68,
            y: 68,
          },
          {
            id: "appendix-tip",
            label: "Pointe — position variable",
            description:
              "Rétrocæcale (~65% des cas), pelvienne (~30%), sous-cæcale, pré-iléale, rétro-iléale, ou exceptionnellement sous-hépatique. Cette variabilité explique la diversité des tableaux cliniques.",
            x: 82,
            y: 78,
          },
          {
            id: "mesoappendix",
            label: "Méso-appendice & artère appendiculaire",
            description:
              "Repli péritonéal suspendant l'appendice, contenant l'artère appendiculaire — branche terminale de l'artère iléo-colique, sans collatérale : une véritable artère terminale de type « end artery ».",
            x: 60,
            y: 42,
          },
          {
            id: "lymphoid-tissue",
            label: "Tissu lymphoïde sous-muqueux (GALT)",
            description:
              "Follicules lymphoïdes denses dans la sous-muqueuse, maximaux entre 10 et 20 ans — composante immunitaire active, pas un simple vestige.",
            x: 72,
            y: 55,
          },
        ],
        embryology:
          "L'appendice dérive de l'intestin moyen (midgut) et apparaît vers la 8e semaine de vie embryonnaire comme un diverticule à l'extrémité du cæcum en formation. Entre les semaines 6 et 10, l'intestin moyen hernie physiologiquement dans le cordon ombilical du fait de sa croissance trop rapide pour la cavité abdominale, puis réintègre l'abdomen en effectuant une rotation antihoraire de 270° autour de l'axe de l'artère mésentérique supérieure. Le cæcum, initialement en position sous-hépatique, descend ensuite progressivement vers la fosse iliaque droite — c'est la « descente cæcale ». L'appendice, fixé à son extrémité, suit ce mouvement. L'arrêt de cette migration à des stades différents selon les individus explique la grande variabilité des positions finales (rétrocæcale, sous-hépatique, pelvienne...) et les rares tableaux atypiques liés à une malrotation ou un situs inversus. Le tissu lymphoïde sous-muqueux, lui, n'apparaît qu'après la naissance, une fois le tube digestif colonisé par la flore bactérienne.",
        physiology:
          "Longtemps considéré comme un vestige inutile, l'appendice est aujourd'hui reconnu comme un organe à part entière. Sur le plan immunitaire, il concentre un tissu lymphoïde associé à l'intestin (GALT) particulièrement dense, maximal entre 10 et 20 ans — ce qui explique directement le pic d'incidence de l'appendicite à cet âge : plus de tissu lymphoïde signifie un risque accru d'hyperplasie réactionnelle obstruant la lumière. Ce tissu involue ensuite progressivement, expliquant la rareté et l'atypie de la maladie chez le sujet âgé. Une théorie plus récente (« safe house hypothesis », Bollinger 2007) propose que l'appendice agisse comme un réservoir protégé de flore commensale bénéfique organisée en biofilm, permettant de réensemencer le côlon après un épisode de diarrhée sévère ayant vidé le microbiote colique. Enfin, sa muqueuse sécrète un mucus protecteur assurant un flux unidirectionnel normal vers le cæcum, comme un tapis roulant.",
      },
      learningMode: {
        summary:
          "L'appendice vermiforme naît de la convergence des trois bandelettes coliques sur le cæcum, vascularisé par une artère terminale sans collatérale, ce qui explique sa fragilité ischémique rapide en cas d'obstruction.",
        keyPoints: [
          "Base fixe = convergence des ténias coli, repère chirurgical constant",
          "Position de la pointe très variable (rétrocæcale la plus fréquente, ~65%)",
          "Dérive de l'intestin moyen, migre avec le cæcum lors de la rotation intestinale de 270°",
          "Riche tissu lymphoïde sous-muqueux, maximal entre 10 et 20 ans",
          "Vascularisation par l'artère appendiculaire, branche terminale de l'iléo-colique, sans collatérale",
        ],
        pearl:
          "Au bloc opératoire, si l'appendice n'est pas immédiatement visible, suivez les trois bandelettes coliques (ténias) avec le doigt : elles convergent toujours exactement à sa base, quelle que soit la position de sa pointe.",
        commonMistakes: [
          "Chercher l'appendice au hasard dans la fosse iliaque droite sans repérer d'abord les bandelettes coliques.",
          "Oublier que la position rétrocæcale peut rendre l'examen clinique faussement rassurant.",
        ],
        quiz: [
          {
            id: "s1-q1",
            question: "À quel niveau les trois bandelettes coliques (ténias) convergent-elles ?",
            options: [
              "À la base de l'appendice",
              "Au niveau de la valvule iléo-cæcale",
              "Au niveau de l'angle colique droit",
              "Au niveau du sigmoïde",
            ],
            correctIndex: 0,
            explanation:
              "Les trois ténias coli convergent exactement à la base appendiculaire — c'est le repère chirurgical le plus fiable pour retrouver l'appendice, y compris quand sa pointe est difficile à localiser.",
          },
        ],
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Slide 2 — Pathophysiology cascade (Red)
    // ─────────────────────────────────────────────────────────────────
    {
      id: "slide-2-pathophysiology",
      title: "Physiopathologie",
      subtitle: "La cascade en sept étapes, de l'obstruction à la péritonite",
      theme: "red",
      domain: "pathology",
      visualType: "pathophysiology_cascade",
      cascade: {
        title: "De l'obstruction à la péritonite",
        steps: [
          {
            id: "obstruction",
            order: 1,
            title: "Obstruction",
            summary: "Un obstacle bouche brutalement la lumière appendiculaire.",
            details:
              "Le processus s'amorce par une obstruction de la lumière appendiculaire, le plus souvent par un stercolithe (concrétion fécale durcie) chez l'adulte, ou par une hyperplasie lymphoïde réactionnelle chez le sujet jeune (souvent déclenchée par une infection virale banale ailleurs dans le corps). Plus rarement, l'obstacle est un corps étranger, une tumeur carcinoïde, ou un parasite intestinal (ascaris) en zone tropicale.",
            keyPoints: [
              "Stercolithe : cause la plus fréquente chez l'adulte",
              "Hyperplasie lymphoïde : cause la plus fréquente chez le sujet jeune",
              "Ascaris : cause fréquente en zone tropicale",
            ],
          },
          {
            id: "luminal-distension",
            order: 2,
            title: "Distension Luminale",
            summary: "La sécrétion muqueuse continue en amont de l'obstacle, la pression grimpe.",
            details:
              "En amont de l'obstruction, la muqueuse continue de sécréter du mucus alors que le drainage est totalement bloqué : c'est un cul-de-sac fermé. La pression intraluminale augmente progressivement, distendant la paroi appendiculaire. Cette distension stimule les fibres afférentes viscérales sympathiques, qui remontent vers la métamère T10 — d'où la douleur périombilicale vague et mal systématisée du tout début.",
            keyPoints: [
              "Sécrétion muqueuse persistante malgré l'obstruction",
              "Hyperpression intraluminale progressive",
              "Douleur référée périombilicale via les afférences viscérales T10",
            ],
          },
          {
            id: "mucosal-ischemia",
            order: 3,
            title: "Ischémie Muqueuse",
            summary: "La pression comprime d'abord les veines, puis les artères.",
            details:
              "La paroi appendiculaire contient deux réseaux vasculaires : les veines, à basse pression, et les artères, à haute pression. La distension croissante comprime d'abord le drainage veineux et lymphatique — le plus fragile — provoquant un œdème pariétal. Si la pression continue de monter, elle finit par comprimer aussi l'artère appendiculaire, qui est une artère terminale sans collatérale de suppléance. La muqueuse, couche la plus sensible à l'hypoxie, est la première à souffrir de cette ischémie.",
            keyPoints: [
              "Les veines (basse pression) sont comprimées avant les artères",
              "L'artère appendiculaire est une artère terminale, sans collatérale",
              "La muqueuse est la couche la plus vulnérable à l'ischémie",
            ],
          },
          {
            id: "bacterial-translocation",
            order: 4,
            title: "Translocation Bactérienne",
            summary: "La barrière muqueuse ischémique cède, les bactéries envahissent la paroi.",
            details:
              "L'ischémie fragilise puis rompt la barrière muqueuse protectrice. La flore colique commensale (Escherichia coli, Bacteroides fragilis, Streptococcus spp., entre autres) envahit alors la paroi de proche en proche, provoquant une inflammation transmurale. Lorsque cette inflammation atteint la séreuse et irrite le péritoine pariétal adjacent, la douleur change de caractère : elle devient précise, intense, et se fixe en fosse iliaque droite, au point de Mac Burney.",
            keyPoints: [
              "Rupture de la barrière muqueuse ischémiée",
              "Invasion transmurale par la flore colique commensale",
              "La douleur migre et se localise en FID quand le péritoine est atteint",
            ],
          },
          {
            id: "gangrene",
            order: 5,
            title: "Gangrène",
            summary: "L'ischémie devient transmurale, la paroi meurt.",
            details:
              "Sans levée de l'obstacle, l'ischémie progresse jusqu'à devenir transmurale : toute l'épaisseur de la paroi est privée d'oxygène. Les cellules meurent, la paroi devient grise puis noire par endroits, friable, incapable d'assurer sa fonction de barrière. C'est la gangrène appendiculaire — un point de non-retour anatomique.",
            keyPoints: [
              "Ischémie transmurale complète",
              "Nécrose pariétale, paroi grise puis noire",
              "Perte totale de l'intégrité structurelle de la paroi",
            ],
          },
          {
            id: "perforation",
            order: 6,
            title: "Perforation",
            summary: "La paroi nécrosée se rompt, typiquement 24 à 72h après le début.",
            details:
              "Une paroi gangrenée finit toujours par se rompre. Cette perforation survient typiquement entre 24 et 72 heures après le début des symptômes, mais peut être plus précoce chez l'enfant en bas âge ou le sujet âgé, dont la présentation clinique retarde souvent le diagnostic. La perforation libère le contenu septique de l'appendice dans la cavité péritonéale.",
            keyPoints: [
              "Délai typique de 24 à 72h après le début des symptômes",
              "Peut être plus précoce chez l'enfant et le sujet âgé",
              "Libération de contenu septique dans le péritoine",
            ],
          },
          {
            id: "peritonitis",
            order: 7,
            title: "Péritonite",
            summary: "Le contenu septique se propage : abcès contenu ou péritonite généralisée.",
            details:
              "Deux évolutions sont possibles après la perforation. Si le processus est lent, l'épiploon et les anses grêles voisines ont le temps de venir cloisonner le foyer infectieux, formant un abcès périappendiculaire circonscrit ou un plastron. Si le processus est rapide, la contamination diffuse dans toute la cavité péritonéale : c'est la péritonite généralisée, une urgence chirurgicale vitale avec risque de choc septique. Chaque heure de retard entre la perforation et la prise en charge aggrave directement le pronostic.",
            keyPoints: [
              "Abcès/plastron circonscrit si évolution lente",
              "Péritonite généralisée si diffusion rapide",
              "Risque de choc septique en cas de péritonite généralisée",
            ],
          },
        ],
      },
      learningMode: {
        summary:
          "L'obstruction de la lumière appendiculaire déclenche une cascade inéluctable en sept étapes, de la distension à la péritonite, si aucune prise en charge n'intervient.",
        keyPoints: [
          "Obstruction initiale : stercolithe (adulte) ou hyperplasie lymphoïde (jeune)",
          "Les veines, à basse pression, sont comprimées avant les artères",
          "L'ischémie muqueuse précède la translocation bactérienne transmurale",
          "La perforation survient typiquement 24 à 72h après le début des symptômes",
          "Une péritonite peut être contenue (abcès/plastron) ou généralisée",
        ],
        pearl:
          "Retenez la phrase clé : « la veine se bouche avant l'artère » — c'est exactement le moment où la douleur bascule du nombril vers la fosse iliaque droite.",
        commonMistakes: [
          "Penser que l'évolution peut s'arrêter spontanément une fois l'obstruction installée.",
          "Sous-estimer la rapidité de la progression chez l'enfant et le sujet âgé.",
        ],
        quiz: [
          {
            id: "s2-q1",
            question: "Quelle structure vasculaire est comprimée en premier lors de la distension appendiculaire ?",
            options: [
              "Les veines (basse pression)",
              "Les artères (haute pression)",
              "Les lymphatiques efférents uniquement",
              "Aucune, la distension ne comprime rien",
            ],
            correctIndex: 0,
            explanation:
              "Les veines, à basse pression, sont mécaniquement comprimées bien avant les artères, plus résistantes — exactement comme un tuyau mou s'écrase plus vite qu'un tuyau dur sous la même pression.",
          },
        ],
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Slide 3 — Clinical signs (Amber)
    // ─────────────────────────────────────────────────────────────────
    {
      id: "slide-3-clinical-signs",
      title: "Présentation Clinique & Signes de l'Examen",
      subtitle: "McBurney, Blumberg, Rovsing, Psoas, Obturateur",
      theme: "amber",
      domain: "clinical",
      visualType: "clinical_signs",
      signs: [
        {
          name: "Point de McBurney",
          description:
            "Point douloureux situé au tiers externe de la ligne reliant l'épine iliaque antéro-supérieure droite à l'ombilic.",
          howToElicit:
            "Palpation profonde et progressive de ce point précis, patient en décubitus dorsal, genoux légèrement fléchis pour relâcher la paroi abdominale.",
          significance:
            "Une douleur vive et reproductible à ce point précis traduit une irritation péritonéale localisée en regard de la base appendiculaire — le signe le plus classique, mais absent dans les positions ectopiques.",
        },
        {
          name: "Signe de Blumberg (décompression)",
          description: "Douleur au relâchement brusque de la main après palpation profonde de la fosse iliaque droite.",
          howToElicit:
            "Appuyer progressivement et profondément en FID, puis retirer la main brusquement et observer la réaction du patient.",
          significance:
            "Une douleur plus intense au relâchement qu'à la pression elle-même traduit un péritonisme localisé — signe de gravité à rechercher systématiquement.",
        },
        {
          name: "Signe de Rovsing",
          description:
            "Douleur ressentie en fosse iliaque droite lors de la palpation ou pression de la fosse iliaque gauche.",
          howToElicit: "Palpation profonde et progressive de la fosse iliaque gauche, en observant la réaction controlatérale.",
          significance:
            "S'explique par le déplacement des gaz intestinaux le long du cadre colique, qui vient distendre et irriter à distance le cæcum et l'appendice enflammés — un signe indirect de péritonisme droit.",
        },
        {
          name: "Signe du Psoas",
          description: "Douleur en fosse iliaque droite à l'extension ou à la flexion contrariée de la cuisse droite.",
          howToElicit:
            "Patient en décubitus latéral gauche : extension passive de la cuisse droite en arrière, ou flexion de hanche contre résistance en décubitus dorsal.",
          significance:
            "Traduit un contact direct entre un appendice enflammé — typiquement en position rétrocæcale — et le muscle psoas-iliaque sous-jacent.",
        },
        {
          name: "Signe de l'Obturateur",
          description: "Douleur hypogastrique ou pelvienne provoquée par la rotation interne de la cuisse droite fléchie.",
          howToElicit: "Hanche et genou droits fléchis à 90°, rotation interne passive de la cuisse.",
          significance:
            "Traduit un contact avec le muscle obturateur interne, évocateur d'un appendice en position pelvienne basse — orientation utile quand McBurney est peu net.",
        },
      ],
      learningMode: {
        summary:
          "L'examen clinique combine plusieurs signes de provocation péritonéale — McBurney, Blumberg, Rovsing, Psoas, Obturateur — dont la positivité oriente vers une irritation péritonéale localisée ou à distance.",
        keyPoints: [
          "Le point de McBurney se situe au tiers externe de la ligne ombilic-EIAS droite",
          "Le signe de Blumberg traduit un péritonisme localisé (douleur au relâchement)",
          "Le signe de Rovsing est un signe indirect, déclenché à distance",
          "Le signe du Psoas oriente vers une localisation rétrocæcale",
          "Le signe de l'Obturateur oriente vers une localisation pelvienne",
        ],
        pearl:
          "Aucun signe pris isolément n'est sensible ou spécifique à 100% — c'est la combinaison des signes et la cohérence du tableau clinique global qui orientent réellement le diagnostic.",
        commonMistakes: [
          "Considérer un signe de McBurney négatif comme suffisant pour éliminer le diagnostic.",
          "Oublier de rechercher les signes du psoas et de l'obturateur devant un tableau atypique.",
        ],
        quiz: [
          {
            id: "s3-q1",
            question: "Le signe du psoas oriente vers quelle localisation anatomique de l'appendice ?",
            options: ["Rétrocæcale", "Pelvienne", "Sous-hépatique", "Pré-iléale"],
            correctIndex: 0,
            explanation:
              "Le signe du psoas traduit le contact entre un appendice enflammé en position rétrocæcale et le muscle psoas-iliaque, irrité par l'extension ou la flexion contrariée de la cuisse.",
          },
        ],
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Slide 4 — Diagnostic decision tree (Blue/Green -> emerald)
    // ─────────────────────────────────────────────────────────────────
    {
      id: "slide-4-decision-tree",
      title: "Arbre de Décision Diagnostique",
      subtitle: "Douleur → Score d'Alvarado → Échographie / Scanner → Conclusion",
      theme: "emerald",
      domain: "clinical",
      visualType: "decision_tree",
      tree: {
        title: "Démarche diagnostique structurée par le score d'Alvarado",
        root: {
          id: "pain-onset",
          type: "question",
          label: "Douleur en fosse iliaque droite évocatrice ?",
          detail:
            "Douleur périombilicale ayant migré vers la fosse iliaque droite, avec ou sans anorexie, nausées, fièvre ou défense associées.",
          children: [
            {
              id: "alvarado-score",
              type: "test",
              label: "Calcul du score d'Alvarado (MANTRELS, /10)",
              detail:
                "Migration de la douleur, Anorexie, Nausées/vomissements, sensibilité (Tenderness) en FID, douleur au Rebond (décompression), élévation Thermique, Leucocytose, déviation gauche (Shift) de la formule — chaque critère présent apporte 1 ou 2 points.",
              children: [
                {
                  id: "score-low",
                  type: "decision",
                  label: "Score ≤ 4 : probabilité faible",
                  children: [
                    {
                      id: "outcome-low-probability",
                      type: "outcome",
                      label: "Diagnostic alternatif probable",
                      outcomeSeverity: "favorable",
                      detail:
                        "Réévaluation clinique à distance recommandée ; pas d'imagerie systématique en urgence si le patient reste stable et l'examen se normalise.",
                    },
                  ],
                },
                {
                  id: "score-intermediate",
                  type: "decision",
                  label: "Score 5-6 : probabilité intermédiaire",
                  detail: "Zone grise clinique : l'imagerie devient nécessaire pour trancher.",
                  children: [
                    {
                      id: "ultrasound",
                      type: "test",
                      label: "Échographie abdominale (1re intention : enfant, femme enceinte)",
                      detail: "Recherche un appendice épaissi (>6 mm), non compressible, avec ou sans stercolithe visible.",
                      children: [
                        {
                          id: "us-positive",
                          type: "decision",
                          label: "Appendice épaissi et non compressible visualisé",
                          children: [
                            {
                              id: "outcome-us-confirmed",
                              type: "outcome",
                              label: "Appendicite confirmée",
                              outcomeSeverity: "urgent",
                              detail: "Indication chirurgicale retenue sur les critères échographiques.",
                            },
                          ],
                        },
                        {
                          id: "us-inconclusive",
                          type: "decision",
                          label: "Échographie non concluante",
                          children: [
                            {
                              id: "outcome-us-to-ct",
                              type: "outcome",
                              label: "Passage au scanner ou surveillance rapprochée",
                              outcomeSeverity: "favorable",
                              detail:
                                "Fréquent en cas d'obésité ou de position rétrocæcale ; une échographie non concluante n'élimine pas le diagnostic.",
                            },
                          ],
                        },
                      ],
                    },
                    {
                      id: "ct-scan",
                      type: "test",
                      label: "Scanner abdomino-pelvien injecté (référence chez l'adulte)",
                      detail: "Recherche un diamètre appendiculaire >6mm, une infiltration de la graisse péri-appendiculaire, un stercolithe.",
                      children: [
                        {
                          id: "ct-positive",
                          type: "decision",
                          label: "Signes tomodensitométriques d'appendicite",
                          children: [
                            {
                              id: "outcome-ct-confirmed",
                              type: "outcome",
                              label: "Appendicite confirmée",
                              outcomeSeverity: "urgent",
                              detail: "Indication chirurgicale retenue sur les critères scanographiques.",
                            },
                          ],
                        },
                        {
                          id: "ct-negative",
                          type: "decision",
                          label: "Scanner négatif",
                          children: [
                            {
                              id: "outcome-ct-alternative",
                              type: "outcome",
                              label: "Diagnostic alternatif à rechercher",
                              outcomeSeverity: "favorable",
                              detail: "Valeur prédictive négative élevée du scanner chez l'adulte : rechercher une autre cause.",
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  id: "score-high",
                  type: "decision",
                  label: "Score ≥ 7 : probabilité forte",
                  children: [
                    {
                      id: "outcome-high-probability",
                      type: "outcome",
                      label: "Indication chirurgicale directe",
                      outcomeSeverity: "urgent",
                      detail: "L'imagerie ne doit pas retarder la prise en charge chirurgicale quand le tableau clinique est déjà très évocateur.",
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      learningMode: {
        summary:
          "Le score d'Alvarado structure la probabilité clinique et guide le recours à l'imagerie (échographie ou scanner) avant la décision chirurgicale.",
        keyPoints: [
          "Score ≤4 : probabilité faible, réévaluation clinique",
          "Score 5-6 : probabilité intermédiaire, imagerie recommandée",
          "Score ≥7 : probabilité forte, indication chirurgicale directe",
          "Échographie privilégiée chez l'enfant et la femme enceinte",
          "Scanner : examen de référence chez l'adulte en cas de doute",
        ],
        pearl: "L'imagerie ne doit jamais retarder une prise en charge chirurgicale déjà cliniquement évidente.",
        commonMistakes: [
          "Demander systématiquement un scanner même quand le tableau clinique est déjà franc (score ≥7).",
          "Ignorer un score intermédiaire sans demander d'imagerie complémentaire.",
        ],
        quiz: [
          {
            id: "s4-q1",
            question: "Que recommande la démarche diagnostique pour un score d'Alvarado ≥ 7 ?",
            options: [
              "Indication chirurgicale directe",
              "Scanner systématique avant toute décision",
              "Traitement antibiotique ambulatoire",
              "Surveillance à domicile 48h",
            ],
            correctIndex: 0,
            explanation:
              "Un score ≥7 traduit une probabilité clinique forte : l'imagerie ne doit pas retarder l'indication chirurgicale déjà justifiée par la clinique.",
          },
        ],
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Slide 5 — Differential diagnosis matrix (Purple)
    // ─────────────────────────────────────────────────────────────────
    {
      id: "slide-5-differential",
      title: "Diagnostics Différentiels",
      subtitle: "Appendicite vs. Adénite mésentérique vs. Diverticulite vs. GEU",
      theme: "purple",
      domain: "pathology",
      visualType: "comparison_matrix",
      matrix: {
        criteria: ["Terrain typique", "Douleur", "Fièvre", "Biologie", "Imagerie clé", "Prise en charge"],
        entities: [
          {
            name: "Appendicite Aiguë",
            isPrimary: true,
            values: [
              "10-30 ans, les deux sexes",
              "Périombilicale migrant vers la FID, point de McBurney",
              "Modérée (38-38,5°C)",
              "Hyperleucocytose à PNN, CRP élevée",
              "Échographie/scanner : appendice épaissi >6mm",
              "Appendicectomie en urgence",
            ],
          },
          {
            name: "Adénite Mésentérique",
            values: [
              "Enfant/adolescent, contexte viral ORL récent",
              "Diffuse, mal localisée, migration moins franche",
              "Souvent élevée, contexte viral",
              "NFS souvent normale ou lymphocytose",
              "Échographie : ganglions mésentériques >8-10mm, appendice normal",
              "Traitement symptomatique, évolution spontanément favorable",
            ],
          },
          {
            name: "Diverticulite (cæcale / Meckel)",
            values: [
              "Adulte jeune (Meckel) ou plus âgé (cæcale)",
              "FID, peut mimer l'appendicite exactement",
              "Variable",
              "Syndrome inflammatoire similaire",
              "Scanner : diverticule enflammé, appendice normal visualisé séparément",
              "Antibiothérapie ± chirurgie selon la sévérité",
            ],
          },
          {
            name: "Grossesse Extra-Utérine",
            values: [
              "Femme en âge de procréer, retard de règles",
              "FID ou pelvienne, parfois scapulalgie si hémopéritoine",
              "Typiquement absente",
              "β-hCG positif, anémie possible si hémorragie",
              "Échographie pelvienne : absence de grossesse intra-utérine, masse annexielle",
              "Urgence gynécologique : méthotrexate ou chirurgie selon gravité",
            ],
          },
        ],
      },
      learningMode: {
        summary:
          "Plusieurs diagnostics différentiels miment l'appendicite aiguë — adénite mésentérique, diverticulite, grossesse extra-utérine — chacun avec un terrain et des examens clés distincts.",
        keyPoints: [
          "L'adénite mésentérique touche surtout l'enfant après un contexte viral",
          "La diverticulite peut donner un tableau scanographique proche mais un appendice normal",
          "La grossesse extra-utérine impose un β-hCG systématique chez la femme en âge de procréer",
          "Le scanner permet souvent de trancher entre ces diagnostics quand le doute persiste",
        ],
        pearl:
          "Devant une douleur de FID, élimine toujours activement la grossesse extra-utérine avant de conclure à une appendicite — ce réflexe ne se discute pas.",
        commonMistakes: [
          "Oublier le β-hCG chez une adolescente par gêne.",
          "Attribuer trop vite un contexte viral ORL à une simple adénite sans réexaminer si la douleur persiste.",
        ],
        quiz: [
          {
            id: "s5-q1",
            question: "Quel diagnostic différentiel impose un dosage systématique de β-hCG ?",
            options: ["Grossesse extra-utérine", "Adénite mésentérique", "Diverticulite", "Aucun de ces diagnostics"],
            correctIndex: 0,
            explanation:
              "Chez toute femme en âge de procréer avec douleur de FID, la grossesse extra-utérine doit être activement éliminée par un dosage de β-hCG avant toute autre conclusion.",
          },
        ],
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Slide 6 — Surgical management (Slate)
    // ─────────────────────────────────────────────────────────────────
    {
      id: "slide-6-management",
      title: "Prise en Charge Chirurgicale",
      subtitle: "Cœlioscopie vs. laparotomie, antibioprophylaxie, complications post-opératoires",
      theme: "slate",
      domain: "surgery",
      visualType: "management",
      management: {
        approaches: [
          {
            name: "Appendicectomie par Laparotomie",
            description:
              "Incision de McBurney ou médiane (si doute diagnostique ou complication suspectée), abord direct de l'appendice.",
            pros: [
              "Pas de matériel spécifique requis",
              "Efficace même en cas de péritonite généralisée nécessitant un lavage extensif",
              "Faisable dans tout contexte, y compris en ressources limitées",
            ],
            cons: [
              "Cicatrice plus visible",
              "Douleur post-opératoire plus marquée",
              "Récupération et hospitalisation plus longues",
              "Risque d'infection pariétale plus élevé",
            ],
          },
          {
            name: "Appendicectomie par Cœlioscopie",
            description:
              "Trois trocarts, exploration complète de la cavité péritonéale, section de l'appendice à l'agrafeuse ou par ligature.",
            pros: [
              "Cicatrices minimes, meilleur résultat esthétique",
              "Douleur post-opératoire réduite",
              "Sortie plus précoce, reprise d'activité plus rapide",
              "Exploration diagnostique utile en cas de doute, notamment chez la femme jeune",
            ],
            cons: [
              "Nécessite matériel et expertise cœlioscopique",
              "Contre-indication relative en cas d'instabilité hémodynamique sévère",
              "Coût du matériel plus élevé",
            ],
          },
        ],
        antibioticProphylaxis:
          "Antibioprophylaxie péri-opératoire à large spectre couvrant la flore digestive (entérobactéries et anaérobies — par exemple amoxicilline-acide clavulanique ou céphalosporine associée au métronidazole), en dose unique à l'induction pour une appendicite non compliquée. En cas de perforation, de gangrène ou de péritonite constatée en peropératoire, une antibiothérapie curative est poursuivie de 3 à 5 jours, voire davantage selon l'évolution clinique et biologique.",
        complications: [
          {
            name: "Infection du site opératoire",
            frequency: "5-10% des cas",
            management: "Soins locaux, antibiothérapie ciblée, drainage si collection pariétale.",
            severity: "favorable",
          },
          {
            name: "Abcès intra-abdominal résiduel",
            frequency: "2-6%, plus fréquent après perforation",
            management: "Drainage percutané guidé par imagerie associé à une antibiothérapie adaptée.",
            severity: "urgent",
          },
          {
            name: "Iléus post-opératoire prolongé",
            frequency: "Fréquent, surtout après péritonite",
            management: "Sonde naso-gastrique si besoin, reprise progressive de l'alimentation, surveillance clinique.",
            severity: "favorable",
          },
          {
            name: "Lâchage du moignon appendiculaire / péritonite post-opératoire",
            frequency: "Rare (<1%) mais grave",
            management: "Reprise chirurgicale en urgence.",
            severity: "urgent",
          },
          {
            name: "Occlusion sur bride tardive",
            frequency: "Risque à long terme après toute chirurgie abdominale",
            management: "Prise en charge médicale initiale, chirurgie si échec du traitement conservateur.",
            severity: "favorable",
          },
        ],
      },
      learningMode: {
        summary:
          "L'appendicectomie, réalisée par voie ouverte ou cœlioscopique, reste le traitement de référence, sous couverture antibiotique adaptée à la sévérité constatée.",
        keyPoints: [
          "La cœlioscopie réduit la douleur post-opératoire et la durée d'hospitalisation",
          "La laparotomie reste indiquée en cas d'instabilité ou d'indisponibilité du matériel",
          "Antibioprophylaxie en dose unique pour une appendicite simple",
          "Antibiothérapie prolongée en cas de perforation ou de péritonite",
          "L'abcès résiduel se traite le plus souvent par drainage percutané",
        ],
        pearl:
          "Devant un plastron appendiculaire déjà constitué, « on refroidit avant d'opérer » : antibiothérapie première, chirurgie différée à froid quelques semaines plus tard.",
        commonMistakes: [
          "Opérer en urgence dans une masse inflammatoire déjà constituée sans envisager un traitement médical premier.",
          "Sous-doser ou raccourcir l'antibiothérapie en cas de péritonite généralisée.",
        ],
        quiz: [
          {
            id: "s6-q1",
            question: "Quelle est l'attitude recommandée devant un plastron appendiculaire constitué ?",
            options: [
              "Antibiothérapie première puis chirurgie différée à froid",
              "Chirurgie immédiate systématique",
              "Simple surveillance sans traitement",
              "Drainage percutané uniquement, jamais de chirurgie",
            ],
            correctIndex: 0,
            explanation:
              "Opérer directement dans une masse inflammatoire constituée est risqué (tissus fragiles et collés) : on traite d'abord par antibiotiques, puis on opère à froid une fois l'inflammation résorbée.",
          },
        ],
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Slide 7 — Clinical pearls & pitfalls (Amber)
    // ─────────────────────────────────────────────────────────────────
    {
      id: "slide-7-pearls",
      title: "Perles Cliniques & Pièges à Éviter",
      subtitle: "Ce que les examinateurs — et les patients — attendent de toi",
      theme: "amber",
      domain: "clinical",
      visualType: "pearls",
      pearls: [
        "Une NFS ou une CRP normales n'éliminent JAMAIS le diagnostic d'appendicite, surtout dans les 12 premières heures.",
        "Chez toute femme en âge de procréer avec douleur en FID, un test de grossesse (β-hCG) doit être demandé systématiquement avant toute autre démarche.",
        "La migration typique de la douleur (péri-ombilicale puis FID) n'est présente que dans 50 à 60% des cas — son absence n'élimine pas le diagnostic.",
        "Le score d'Alvarado est un outil d'aide à la décision, pas un substitut au jugement clinique répété.",
        "Réexaminer un patient à quelques heures d'intervalle est souvent plus informatif qu'un seul examen initial, en particulier chez l'enfant.",
      ],
      pitfalls: [
        "Chez l'enfant de moins de 5 ans, le tableau est souvent atypique (diarrhée, fièvre isolée) — risque de retard diagnostique et de perforation plus précoce.",
        "Chez la personne âgée, la présentation est souvent fruste malgré une gravité anatomique plus importante — l'indice de suspicion doit rester élevé.",
        "Chez la femme enceinte, l'appendice est refoulé vers le haut par l'utérus gravide — la douleur peut se situer bien plus haut que la FID classique, surtout au 3e trimestre.",
        "Une échographie normale n'élimine pas le diagnostic si l'appendice n'est pas visualisé (fréquent en cas d'obésité ou de position rétrocæcale) — pas de mise en confiance excessive.",
      ],
      mistakes: [
        "Attendre une hyperleucocytose franche avant de solliciter un avis chirurgical.",
        "Éliminer le diagnostic uniquement sur l'absence de migration typique de la douleur.",
        "Retarder le transfert chirurgical dans l'attente d'une imagerie non disponible rapidement, alors que le tableau clinique est déjà évocateur et sévère.",
        "Négliger le test de grossesse chez une adolescente ou une jeune femme par gêne ou oubli.",
        "Opérer en urgence un plastron déjà constitué sans envisager un traitement médical premier.",
      ],
      learningMode: {
        summary:
          "La sécurité diagnostique repose sur la vigilance envers les présentations atypiques (enfant, sujet âgé, grossesse) et sur la réévaluation clinique répétée plutôt que sur un seul examen normal.",
        keyPoints: [
          "Une biologie normale n'élimine jamais le diagnostic, surtout précocement",
          "Le tableau est souvent atypique chez l'enfant, le sujet âgé et la femme enceinte",
          "Le score d'Alvarado aide la décision mais ne remplace pas le jugement clinique",
          "Réexaminer à quelques heures d'intervalle est souvent décisif",
        ],
        pearl: "Mieux vaut un avis chirurgical qui se révèle finalement inutile qu'un retard diagnostique fatal.",
        commonMistakes: [
          "Se fier uniquement à l'absence de migration typique de la douleur.",
          "Retarder l'avis chirurgical dans l'attente d'une imagerie non immédiatement disponible.",
        ],
        quiz: [
          {
            id: "s7-q1",
            question: "Chez quelle population le tableau clinique de l'appendicite est-il le plus souvent atypique ?",
            options: [
              "L'enfant, le sujet âgé et la femme enceinte",
              "Uniquement l'adulte jeune",
              "Uniquement l'homme",
              "Aucune population en particulier",
            ],
            correctIndex: 0,
            explanation:
              "Ces trois populations présentent des tableaux volontiers trompeurs, ce qui impose une vigilance accrue et une réévaluation clinique plus fréquente.",
          },
        ],
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Slide 8 — Comprehensive quiz (Emerald)
    // ─────────────────────────────────────────────────────────────────
    {
      id: "slide-8-quiz",
      title: "Quiz Récapitulatif",
      subtitle: "Anatomie, physiopathologie, clinique, diagnostic et prise en charge",
      theme: "emerald",
      domain: "clinical",
      visualType: "quiz",
      quiz: [
        {
          id: "final-q1",
          question:
            "Quelle est la branche artérielle qui vascularise l'appendice, expliquant sa vulnérabilité ischémique rapide ?",
          options: [
            "L'artère appendiculaire, branche terminale de l'iléo-colique, sans collatérale",
            "L'artère colique droite",
            "L'artère mésentérique inférieure",
            "L'artère iliaque interne",
          ],
          correctIndex: 0,
          explanation:
            "L'artère appendiculaire est une véritable artère terminale : en l'absence de collatérale de suppléance, toute compression suffisante entraîne une ischémie rapide et irréversible de la paroi.",
        },
        {
          id: "final-q2",
          question: "Dans la cascade physiopathologique de l'appendicite, quelle étape suit immédiatement l'obstruction ?",
          options: [
            "La distension luminale par accumulation de mucus",
            "La perforation directe",
            "La translocation bactérienne",
            "La gangrène pariétale",
          ],
          correctIndex: 0,
          explanation:
            "Après l'obstruction, la sécrétion muqueuse continue en amont provoque une distension progressive de la lumière, avant toute atteinte ischémique ou bactérienne.",
        },
        {
          id: "final-q3",
          question: "Quel signe clinique correspond à une douleur en FID déclenchée par la palpation de la fosse iliaque gauche ?",
          options: ["Le signe de Rovsing", "Le signe du Psoas", "Le signe de l'Obturateur", "Le signe de Blumberg"],
          correctIndex: 0,
          explanation:
            "Le signe de Rovsing est un signe indirect : la pression sur la fosse iliaque gauche déplace les gaz coliques et irrite à distance le cæcum et l'appendice enflammés à droite.",
        },
        {
          id: "final-q4",
          question: "Un score d'Alvarado ≥ 7 chez un patient stable oriente vers :",
          options: [
            "Une indication chirurgicale directe sans attendre l'imagerie",
            "Une simple surveillance ambulatoire",
            "Un traitement antibiotique seul systématique",
            "Un diagnostic alternatif à privilégier",
          ],
          correctIndex: 0,
          explanation:
            "Un score ≥7 correspond à une forte probabilité clinique : l'indication chirurgicale peut être posée sans attendre une imagerie qui ne ferait que retarder la prise en charge.",
        },
        {
          id: "final-q5",
          question:
            "Quelle complication post-opératoire justifie un drainage percutané guidé par imagerie plutôt qu'une reprise chirurgicale immédiate ?",
          options: [
            "Un abcès intra-abdominal résiduel bien circonscrit",
            "Une péritonite généralisée post-opératoire",
            "Un lâchage du moignon appendiculaire",
            "Un choc septique évolutif",
          ],
          correctIndex: 0,
          explanation:
            "Un abcès résiduel bien circonscrit se traite efficacement par un drainage percutané associé à une antibiothérapie, évitant une reprise chirurgicale plus lourde et plus risquée.",
        },
      ],
      learningMode: {
        summary:
          "Ce quiz final couvre l'ensemble du parcours : anatomie, physiopathologie, clinique, diagnostic et prise en charge de l'appendicite aiguë.",
        keyPoints: [
          "Relire les perles de chaque slide avant de répondre si besoin",
          "Chaque question cible une slide précédente du deck",
          "La correction explique le raisonnement, pas seulement la bonne réponse",
        ],
        pearl:
          "Un étudiant qui raisonne à partir de la physiopathologie répond juste même à une question qu'il n'a jamais vue formulée ainsi.",
        commonMistakes: [
          "Répondre au hasard sans relire l'énoncé complet.",
          "Ignorer les explications après une bonne réponse — elles consolident la mémorisation à long terme.",
        ],
        quiz: [
          {
            id: "s8-bonus-q1",
            question: "Quel est le fil conducteur qui relie les 8 slides de ce cours ?",
            options: [
              "Une seule maladie, vue sous tous ses angles cliniquement utiles",
              "Huit maladies différentes du tube digestif",
              "Un cours de pharmacologie générale",
              "Un cours d'anatomie isolé, sans lien clinique",
            ],
            correctIndex: 0,
            explanation:
              "Chaque slide éclaire un angle différent de la même pathologie — anatomie, mécanisme, clinique, diagnostic, différentiels, traitement, pièges — pour construire un raisonnement complet, pas une accumulation de faits isolés.",
          },
        ],
      },
    },
  ],
};
