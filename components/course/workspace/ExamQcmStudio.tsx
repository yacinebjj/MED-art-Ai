"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ListChecks, CheckCircle2, XCircle, PenLine, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------------------- */
/* Phase 1 — Strict data structure.                                         */
/* ----------------------------------------------------------------------- */

interface ExplicationQCM {
  globale: string;
  A: string;
  B: string;
  C: string;
  D: string;
  E: string;
}

interface QCM {
  id: number;
  question: string;
  options: { label: string; text: string }[];
  reponsesCorrectes: string[];
  explication: ExplicationQCM;
}

interface QROC {
  id: number;
  question: string;
  reponseOfficielle: string;
}

/* ----------------------------------------------------------------------- */
/* Phase 2 — The database. 25 QCMs, 7 QROCs. Extreme-difficulty vignettes,  */
/* multi-answer, with classic Blida-style traps ("Toutes"/"Aucune").        */
/* ----------------------------------------------------------------------- */

const qcmsData: QCM[] = [
  {
    id: 1,
    question:
      "Un homme de 24 ans consulte pour une douleur abdominale ayant débuté la veille au soir de façon diffuse, péri-ombilicale, puis fixée ce matin en fosse iliaque droite. Il est apyrétique, sans nausée ni vomissement, et l'examen retrouve une sensibilité minime sans défense. Concernant la physiopathologie de ce tableau, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "La douleur initiale péri-ombilicale s'explique par l'innervation du péritoine viscéral, peu discriminante et rattachée au territoire de l'intestin moyen embryonnaire." },
      { label: "B", text: "La migration de la douleur vers la FID traduit l'atteinte secondaire du péritoine pariétal, richement innervé par les nerfs somatiques de la paroi." },
      { label: "C", text: "L'absence de fièvre élimine formellement le diagnostic d'appendicite aiguë." },
      { label: "D", text: "Le mécanisme initial le plus fréquent chez l'adulte est l'obstruction de la lumière appendiculaire par un stercolithe." },
      { label: "E", text: "Toutes les propositions précédentes sont exactes." },
    ],
    reponsesCorrectes: ["A", "B", "D"],
    explication: {
      globale:
        "Ce tableau évoque une appendicite aiguë à un stade encore débutant, où l'absence de fièvre et l'examen pauvre ne doivent jamais éliminer le diagnostic — un piège classique des examens de Blida.",
      A: "Vrai. Le péritoine viscéral est peu innervé et transmet une douleur diffuse, mal systématisée, projetée sur le territoire embryonnaire correspondant (T10, intestin moyen).",
      B: "Vrai. Une fois l'inflammation atteint la séreuse et le péritoine pariétal adjacent, la douleur devient précise et se fixe en FID — c'est la migration classique.",
      C: "Faux. La fièvre est inconstante, surtout aux stades précoces ; son absence ne doit jamais faire éliminer le diagnostic devant une clinique évocatrice.",
      D: "Vrai. Le stercolithe est la cause la plus fréquente chez l'adulte (l'hyperplasie lymphoïde prédomine chez l'enfant et l'adolescent).",
      E: "Faux, puisque la proposition C est fausse.",
    },
  },
  {
    id: 2,
    question:
      "Concernant le signe de Blumberg et le signe de Rovsing dans l'appendicite aiguë, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "Le signe de Blumberg correspond à une douleur provoquée par la palpation profonde du point de McBurney." },
      { label: "B", text: "Le signe de Blumberg traduit une irritation du péritoine pariétal lors de la décompression brutale après compression." },
      { label: "C", text: "Le signe de Rovsing est positif lorsque la palpation de la fosse iliaque gauche déclenche une douleur en fosse iliaque droite." },
      { label: "D", text: "La négativité du signe de Rovsing élimine le diagnostic d'appendicite aiguë." },
      { label: "E", text: "Aucune des réponses n'est juste." },
    ],
    reponsesCorrectes: ["B", "C"],
    explication: {
      globale:
        "Ces deux signes explorent l'irritation péritonéale par des mécanismes différents ; leur association renforce la suspicion clinique sans qu'aucun ne soit isolément indispensable.",
      A: "Faux. Blumberg n'est pas la douleur à la palpation directe mais celle survenant au relâchement brusque après compression (douleur de décompression).",
      B: "Vrai. La décompression brutale étire le péritoine enflammé, provoquant une douleur vive spécifique de l'irritation péritonéale.",
      C: "Vrai. C'est la définition même du signe de Rovsing : douleur controlatérale par mobilisation des gaz et anses vers le foyer inflammatoire droit.",
      D: "Faux. Aucun signe clinique isolé n'a une sensibilité suffisante pour éliminer le diagnostic à lui seul ; sa négativité ne l'exclut pas.",
      E: "Faux, puisque B et C sont exactes.",
    },
  },
  {
    id: 3,
    question: "Un appendice en position rétro-cæcale se caractérise classiquement par :",
    options: [
      { label: "A", text: "Une défense abdominale antérieure franche, quasi constante." },
      { label: "B", text: "Un signe du psoas positif, du fait du contact direct entre l'appendice et le muscle psoas-iliaque." },
      { label: "C", text: "Une localisation qui rend l'échographie souvent non concluante du fait de l'interposition gazeuse cæcale." },
      { label: "D", text: "Une contre-indication formelle à la voie cœlioscopique." },
      { label: "E", text: "Toutes les réponses sont justes." },
    ],
    reponsesCorrectes: ["B", "C"],
    explication: {
      globale:
        "La forme rétro-cæcale est l'archétype du piège diagnostique : le cæcum fait écran au péritoine antérieur, ce qui explique la pauvreté de l'examen clinique standard.",
      A: "Faux. C'est l'inverse : la défense antérieure est classiquement absente ou minime, le cæcum s'interposant entre l'appendice et le péritoine pariétal antérieur.",
      B: "Vrai. Le muscle psoas, en contact direct avec l'appendice rétro-cæcal, transmet la douleur à son étirement — le seul signal fiable dans cette topographie.",
      C: "Vrai. Les gaz cæcaux interposés bloquent la transmission des ultrasons, rendant l'appendice souvent invisible à l'échographie.",
      D: "Faux. Au contraire, la cœlioscopie est particulièrement indiquée ici car elle permet une exploration complète malgré la position atypique.",
      E: "Faux, puisque A et D sont fausses.",
    },
  },
  {
    id: 4,
    question:
      "Chez une femme de 26 ans en âge de procréer consultant pour une douleur en fosse iliaque droite fébrile, quelle(s) est/sont la/les proposition(s) exacte(s) concernant la démarche diagnostique ?",
    options: [
      { label: "A", text: "Le dosage des β-hCG plasmatiques doit être systématique avant tout geste chirurgical." },
      { label: "B", text: "Une grossesse extra-utérine peut parfaitement mimer une appendicite aiguë sur le plan clinique." },
      { label: "C", text: "En cas de β-hCG positif, l'échographie pelvienne devient inutile." },
      { label: "D", text: "Une salpingite se distingue classiquement par une douleur bilatérale et une douleur à la mobilisation utérine." },
      { label: "E", text: "Un tableau bilatéral oriente davantage vers une pathologie gynécologique que vers une appendicite." },
    ],
    reponsesCorrectes: ["A", "B", "D", "E"],
    explication: {
      globale:
        "Chez la femme en âge de procréer, le diagnostic différentiel gynécologique doit systématiquement être intégré au raisonnement — l'un des terrains les plus piégeux de la sémiologie abdominale.",
      A: "Vrai. Éliminer une grossesse extra-utérine est un réflexe non négociable avant toute décision chirurgicale chez cette patiente.",
      B: "Vrai. La GEU peut donner une douleur en FID fébrile ou subfébrile tout à fait superposable au tableau appendiculaire.",
      C: "Faux. Un β-hCG positif impose au contraire une échographie pelvienne en urgence pour localiser la grossesse et éliminer une GEU.",
      D: "Vrai. La bilatéralité et la douleur à la mobilisation utérine sont évocatrices de salpingite, contrairement à l'appendicite qui ne touche jamais le côté gauche.",
      E: "Vrai. L'appendicite étant une pathologie strictement droite, un tableau bilatéral doit réorienter vers une cause gynécologique.",
    },
  },
  {
    id: 5,
    question: "Concernant la biologie de l'appendicite aiguë, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "Une NFS strictement normale élimine le diagnostic d'appendicite aiguë." },
      { label: "B", text: "La CRP s'élève classiquement avec un décalage cinétique par rapport à l'hyperleucocytose." },
      { label: "C", text: "La cinétique d'un dosage répété de la CRP a plus de valeur qu'un chiffre isolé, même élevé." },
      { label: "D", text: "Chez le sujet âgé, une NFS quasi-normale associée à une CRP très élevée doit faire évoquer un tableau compliqué et non un tableau bénin." },
      { label: "E", text: "L'hyperleucocytose de l'appendicite est classiquement à prédominance lymphocytaire." },
    ],
    reponsesCorrectes: ["B", "C", "D"],
    explication: {
      globale:
        "La biologie de l'appendicite doit toujours être interprétée avec prudence : aucun paramètre isolé n'a une valeur discriminante absolue, et le piège est particulièrement marqué chez le sujet âgé.",
      A: "Faux. Une NFS normale, notamment dans les 6 premières heures d'évolution, n'élimine jamais le diagnostic.",
      B: "Vrai. La CRP, dépendante de la synthèse hépatique sous IL-6, s'élève plus tardivement que la leucocytose, avec un décalage de 6 à 12h.",
      C: "Vrai. Une cinétique ascendante démontre une inflammation activement progressive, plus informative qu'une valeur ponctuelle.",
      D: "Vrai. Chez le sujet âgé, la NFS peut rester quasi normale malgré une gravité authentique révélée par une CRP très élevée — un contraste qui doit alerter, pas rassurer.",
      E: "Faux. L'hyperleucocytose de l'appendicite est à prédominance neutrophile (polynucléaires neutrophiles), non lymphocytaire.",
    },
  },
  {
    id: 6,
    question: "Concernant l'imagerie de l'appendicite aiguë, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "Le seuil échographique classiquement retenu pour un appendice pathologique est un diamètre supérieur à 6mm." },
      { label: "B", text: "L'échographie est l'examen de première intention recommandé chez l'enfant et la femme enceinte." },
      { label: "C", text: "La TDM abdomino-pelvienne injectée est le gold standard chez l'adulte, avec une sensibilité et une spécificité supérieures à 95%." },
      { label: "D", text: "Chez la femme enceinte, en cas d'échographie non concluante, l'IRM sans gadolinium est préférée au scanner." },
      { label: "E", text: "Toutes les réponses précédentes sont exactes." },
    ],
    reponsesCorrectes: ["E"],
    explication: {
      globale:
        "Cette question teste la hiérarchie des examens d'imagerie selon le terrain — un point extrêmement classant, où chaque proposition prise isolément est vraie.",
      A: "Vrai. Un appendice non compressible de diamètre > 6mm est le critère échographique pathologique classiquement retenu.",
      B: "Vrai. L'échographie, non irradiante, est l'examen de première intention chez l'enfant et la femme enceinte.",
      C: "Vrai. La TDM injectée reste la référence chez l'adulte du fait de ses performances diagnostiques supérieures à 95%.",
      D: "Vrai. L'IRM, non irradiante et performante sur les tissus mous, est le recours de choix pendant la grossesse quand l'échographie est mise en défaut.",
      E: "Vrai, car toutes les propositions A à D sont exactes — la bonne réponse ici, sans piège caché.",
    },
  },
  {
    id: 7,
    question: "Concernant le score d'Alvarado (MANTRELS), quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "Un score inférieur à 4 impose une chirurgie en urgence sans délai." },
      { label: "B", text: "Un score compris entre 5 et 6 justifie la réalisation d'une imagerie complémentaire avant toute décision." },
      { label: "C", text: "Un score supérieur ou égal à 7 justifie un avis chirurgical direct, sans attendre l'imagerie." },
      { label: "D", text: "Le score d'Alvarado intègre exclusivement des paramètres cliniques." },
      { label: "E", text: "Le score d'Alvarado intègre à la fois des paramètres cliniques et biologiques." },
    ],
    reponsesCorrectes: ["B", "C", "E"],
    explication: {
      globale:
        "Le score d'Alvarado stratifie le risque en trois zones de conduite à tenir bien distinctes ; il combine clinique et biologie, un point souvent mal maîtrisé par les étudiants.",
      A: "Faux. Un score bas oriente au contraire vers la surveillance simple, pas vers la chirurgie immédiate.",
      B: "Vrai. C'est la zone grise classique, où l'imagerie complémentaire est nécessaire pour trancher.",
      C: "Vrai. Un score élevé justifie l'avis chirurgical direct, sans perdre de temps en imagerie complémentaire.",
      D: "Faux. Le score inclut notamment l'hyperleucocytose et la déviation gauche, des paramètres biologiques.",
      E: "Vrai. C'est précisément la combinaison de critères cliniques et biologiques qui fait la force du score.",
    },
  },
  {
    id: 8,
    question:
      "Concernant la cascade physiopathologique des 4 stades anatomo-cliniques de l'appendicite, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "Le stade catarrhale se caractérise par une congestion vasculaire et un œdème muqueux réactionnel." },
      { label: "B", text: "Le stade suppuré (flegmoneux) s'accompagne classiquement de micro-abcès pariétaux et de fausses membranes fibrino-leucocytaires." },
      { label: "C", text: "Le stade gangréneux résulte d'une thrombose des vaisseaux appendiculaires aboutissant à une nécrose pariétale." },
      { label: "D", text: "Le stade perforé constitue une urgence vitale imposant un bloc opératoire immédiat." },
      { label: "E", text: "Ces 4 stades surviennent dans un ordre aléatoire et imprévisible." },
    ],
    reponsesCorrectes: ["A", "B", "C", "D"],
    explication: {
      globale:
        "Cette cascade illustre l'évolution naturelle et progressive de la maladie non traitée, de la simple congestion muqueuse à la péritonite généralisée.",
      A: "Vrai. C'est le stade le plus précoce, encore réversible, avec une atteinte limitée à la muqueuse et à la sous-muqueuse.",
      B: "Vrai. L'extension transmurale de l'inflammation s'accompagne d'abcès pariétaux et d'un exsudat fibrino-leucocytaire.",
      C: "Vrai. L'ischémie vasculaire aboutit à la nécrose de la paroi appendiculaire, stade précédant la perforation.",
      D: "Vrai. La perforation expose à une péritonite localisée ou généralisée, urgence vitale absolue.",
      E: "Faux. Ces stades surviennent selon une chronologie progressive et prévisible en l'absence de traitement, du catarrhale vers le perforé.",
    },
  },
  {
    id: 9,
    question: "Concernant le plastron appendiculaire, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "Il correspond à un magma inflammatoire agglutinant l'appendice, le grand épiploon et les anses digestives voisines." },
      { label: "B", text: "Sa présence constitue une contre-indication formelle à la chirurgie immédiate." },
      { label: "C", text: "Le traitement de première intention repose sur une antibiothérapie intraveineuse, dite « à chaud »." },
      { label: "D", text: "L'appendicectomie est réalisée secondairement, dite « à froid », habituellement à 6-8 semaines." },
      { label: "E", text: "Toutes les réponses précédentes sont exactes." },
    ],
    reponsesCorrectes: ["E"],
    explication: {
      globale:
        "Le plastron représente une tentative naturelle de cloisonnement de l'infection ; le respecter chirurgicalement à chaud est une règle d'or à ne jamais transgresser.",
      A: "Vrai. C'est la définition anatomique exacte du plastron appendiculaire.",
      B: "Vrai. Opérer à chaud sur ce magma expose à un risque majeur de plaie digestive iatrogène et de dissémination septique.",
      C: "Vrai. L'antibiothérapie IV première permet de refroidir l'inflammation avant tout geste chirurgical.",
      D: "Vrai. Ce délai laisse le temps à l'inflammation de régresser complètement, rendant la chirurgie bien plus sûre.",
      E: "Vrai, car toutes les propositions précédentes sont exactes — une question de synthèse sans piège.",
    },
  },
  {
    id: 10,
    question:
      "Un patient de 45 ans est amené aux urgences en choc septique avec une contracture abdominale généralisée. Quelle(s) proposition(s) est/sont exacte(s) concernant sa prise en charge immédiate ?",
    options: [
      { label: "A", text: "La TDM abdomino-pelvienne doit être réalisée avant toute mesure de réanimation, pour ne pas retarder le diagnostic étiologique." },
      { label: "B", text: "Le remplissage vasculaire par cristalloïdes doit être débuté avant l'introduction éventuelle de vasopresseurs." },
      { label: "C", text: "L'antibiothérapie probabiliste doit être débutée dans l'heure, après prélèvement des hémocultures." },
      { label: "D", text: "La cœlioscopie reste la voie d'abord de référence même en cas de péritonite généralisée sévère." },
      { label: "E", text: "Les lactates artériels constituent un marqueur pronostique fiable de l'hypoperfusion tissulaire." },
    ],
    reponsesCorrectes: ["B", "C", "E"],
    explication: {
      globale:
        "Cette question teste la hiérarchisation absolue des priorités devant un choc septique d'origine chirurgicale : réanimer avant d'imager, imager avant d'opérer, jamais dans le désordre.",
      A: "Faux. On ne scanne jamais un patient en choc non stabilisé — la réanimation prime toujours sur la confirmation d'imagerie.",
      B: "Vrai. Le remplissage vasculaire constitue la première ligne, avant tout recours aux vasopresseurs.",
      C: "Vrai. Chaque heure de retard d'antibiothérapie efficace augmente la mortalité ; les hémocultures doivent précéder la première dose.",
      D: "Faux. La laparotomie médiane devient la voie de référence dans une péritonite généralisée sévère, la cœlioscopie n'étant plus indiquée.",
      E: "Vrai. Les lactates traduisent directement l'hypoperfusion tissulaire par métabolisme anaérobie, un marqueur pronostique majeur.",
    },
  },
  {
    id: 11,
    question:
      "Concernant l'antibioprophylaxie et l'antibiothérapie dans l'appendicite aiguë, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "L'association Céfazoline-Métronidazole cible respectivement la flore aérobie et anaérobie digestive." },
      { label: "B", text: "L'antibioprophylaxie dans une appendicite non compliquée nécessite un traitement prolongé de plusieurs jours." },
      { label: "C", text: "Le Métronidazole couvre notamment Bacteroides fragilis, principal anaérobie de la flore colique." },
      { label: "D", text: "En cas de choc septique d'origine abdominale, la Pipéracilline-Tazobactam est une option probabiliste à large spectre adaptée." },
      { label: "E", text: "Aucune des réponses n'est juste." },
    ],
    reponsesCorrectes: ["A", "C", "D"],
    explication: {
      globale:
        "La question distingue l'antibioprophylaxie (dose unique, geste non compliqué) de l'antibiothérapie curative prolongée (sepsis, complication) — une confusion fréquente chez les étudiants.",
      A: "Vrai. La Céfazoline couvre les entérobactéries aérobies, le Métronidazole la flore anaérobie — une association qui cible exactement l'écologie colique.",
      B: "Faux. Il s'agit d'une prophylaxie à dose unique péri-opératoire, non d'un traitement curatif prolongé, dans les formes non compliquées.",
      C: "Vrai. Bacteroides fragilis est le principal anaérobie ciblé par le Métronidazole dans ce contexte.",
      D: "Vrai. Son spectre large (entérobactéries, anaérobies, partie du Pseudomonas) en fait une option probabiliste adaptée à un sepsis abdominal sévère.",
      E: "Faux, puisque A, C et D sont exactes.",
    },
  },
  {
    id: 12,
    question:
      "Chez une femme enceinte de 28 semaines d'aménorrhée suspectée d'appendicite aiguë, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "La douleur peut se projeter au niveau du flanc voire de l'hypochondre droit du fait du refoulement de l'appendice par l'utérus gravide." },
      { label: "B", text: "La cœlioscopie est formellement contre-indiquée au 3e trimestre de la grossesse." },
      { label: "C", text: "Une hyperleucocytose modérée peut être physiologique pendant la grossesse et ne doit pas être surinterprétée isolément." },
      { label: "D", text: "La CRP reste un marqueur fiable pendant la grossesse, contrairement à la NFS." },
      { label: "E", text: "Une tocolyse préventive systématique est recommandée en pré-opératoire chez toute patiente enceinte opérée d'une appendicite." },
    ],
    reponsesCorrectes: ["A", "C", "D"],
    explication: {
      globale:
        "La grossesse modifie profondément la présentation clinique et l'interprétation biologique de l'appendicite, sans changer fondamentalement les grands principes thérapeutiques.",
      A: "Vrai. L'utérus gravide repousse progressivement le cæcum et l'appendice, expliquant une douleur atypique au 3e trimestre.",
      B: "Faux. La cœlioscopie n'est pas contre-indiquée pendant la grossesse, y compris au 3e trimestre, entre des mains expérimentées.",
      C: "Vrai. Une hyperleucocytose modérée (jusqu'à 12-15 000/mm³) est banale en grossesse normale, du fait d'une démargination physiologique des neutrophiles.",
      D: "Vrai. La CRP n'est pas significativement modifiée par la grossesse et garde toute sa valeur discriminante, contrairement à la NFS.",
      E: "Faux. La tocolyse préventive systématique n'a pas montré de bénéfice net et n'est réservée qu'à l'apparition de contractions régulières authentiques.",
    },
  },
  {
    id: 13,
    question: "Concernant l'appendicite aiguë du sujet âgé, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "La réponse inflammatoire est classiquement plus intense et plus précoce que chez l'adulte jeune." },
      { label: "B", text: "Une confusion aiguë inexpliquée chez un sujet âgé autonome doit faire rechercher une cause somatique sous-jacente." },
      { label: "C", text: "Une coloscopie de contrôle systématique est recommandée à distance après guérison d'un épisode d'appendicite compliquée d'un plastron." },
      { label: "D", text: "Le diagnostic différentiel doit systématiquement intégrer la possibilité d'une néoplasie colique droite perforée ou abcédée." },
      { label: "E", text: "Un remplissage vasculaire doit être conduit avec la même vitesse que chez l'adulte jeune, sans précaution particulière." },
    ],
    reponsesCorrectes: ["B", "C", "D"],
    explication: {
      globale:
        "Le sujet âgé cumule deux difficultés majeures : une clinique et une biologie faussement rassurantes, et une réserve physiologique réduite qui impose prudence thérapeutique.",
      A: "Faux. La réponse inflammatoire est au contraire émoussée et retardée chez le sujet âgé, ce qui explique le retard diagnostique fréquent.",
      B: "Vrai. Toute confusion aiguë inexpliquée chez un sujet âgé habituellement autonome impose la recherche d'une cause somatique, notamment infectieuse.",
      C: "Vrai. Un cancer du cæcum peut parfaitement se compliquer d'un tableau pseudo-appendiculaire ; la coloscopie de contrôle est impérative.",
      D: "Vrai. C'est un diagnostic différentiel classant à ne jamais oublier chez le sujet âgé présentant ce tableau.",
      E: "Faux. Un remplissage trop rapide expose à une décompensation cardiaque par réserve myocardique diminuée ; le débit doit être titré plus prudemment.",
    },
  },
  {
    id: 14,
    question: "Concernant les diagnostics différentiels de l'appendicite aiguë, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "La colique néphrétique se caractérise par un patient agité, ne trouvant aucune position antalgique, contrairement au patient appendiculaire qui reste immobile." },
      { label: "B", text: "L'adénolymphite mésentérique touche préférentiellement l'adulte de plus de 60 ans." },
      { label: "C", text: "La gastro-entérite aiguë se caractérise par une douleur qui reste diffuse, sans jamais se fixer en un point précis." },
      { label: "D", text: "La diverticulite droite est un diagnostic différentiel classique, plus fréquent que la diverticulite sigmoïdienne." },
      { label: "E", text: "L'adénolymphite mésentérique survient typiquement dans un contexte viral ORL récent chez l'enfant." },
    ],
    reponsesCorrectes: ["A", "C", "E"],
    explication: {
      globale:
        "Ces diagnostics différentiels partagent souvent une composante clinique trompeuse ; c'est la sémiologie fine et le contexte qui permettent de les distinguer.",
      A: "Vrai. L'agitation motrice sans position antalgique retrouvée est quasi pathognomonique de colique néphrétique, à l'opposé de l'immobilité du patient appendiculaire.",
      B: "Faux. L'adénolymphite mésentérique est une pathologie typiquement pédiatrique, pas gériatrique.",
      C: "Vrai. La douleur de la gastro-entérite reste diffuse et ne se fixe jamais en un point précis, contrairement à la migration typique de l'appendicite.",
      D: "Faux. La diverticulite droite est au contraire beaucoup plus rare que la diverticulite sigmoïdienne classique.",
      E: "Vrai. Un contexte viral ORL récent chez l'enfant est très évocateur d'adénolymphite mésentérique plutôt que d'appendicite.",
    },
  },
  {
    id: 15,
    question:
      "Un enfant de 4 ans présente une diarrhée, une irritabilité et une douleur abdominale diffuse peu systématisée, sans triade clinique franche. Quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "L'absence de triade clinique classique élimine formellement le diagnostic d'appendicite chez cet enfant." },
      { label: "B", text: "Chez l'enfant de moins de 5 ans, la présentation clinique est souvent atypique, avec une diarrhée et une irritabilité isolée pouvant être trompeuses." },
      { label: "C", text: "Ce tableau impose de garder un indice de suspicion élevé malgré l'atypie clinique." },
      { label: "D", text: "L'adénolymphite mésentérique doit être évoquée comme diagnostic différentiel principal dans ce contexte." },
      { label: "E", text: "Toutes les réponses précédentes sont exactes, sauf la première." },
    ],
    reponsesCorrectes: ["B", "C", "D", "E"],
    explication: {
      globale:
        "Chez le jeune enfant, l'atypie clinique est la règle plutôt que l'exception, ce qui impose une vigilance accrue plutôt qu'une élimination hâtive du diagnostic.",
      A: "Faux. L'absence de triade classique n'élimine jamais le diagnostic chez l'enfant, où la présentation atypique est fréquente.",
      B: "Vrai. Chez l'enfant de moins de 5 ans, diarrhée et irritabilité isolée peuvent parfaitement révéler une appendicite débutante.",
      C: "Vrai. L'indice de suspicion doit rester élevé précisément parce que la clinique pédiatrique est trompeuse.",
      D: "Vrai. Le contexte évoqué est également compatible avec une adénolymphite mésentérique, diagnostic différentiel à considérer sérieusement.",
      E: "Vrai, en cohérence avec les réponses B, C et D qui sont exactes, et A qui est fausse.",
    },
  },
  {
    id: 16,
    question:
      "Concernant la bandelette urinaire dans le contexte d'une suspicion d'appendicite aiguë, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "Une bandelette urinaire positive aux leucocytes élimine formellement le diagnostic d'appendicite." },
      { label: "B", text: "Un appendice enflammé au contact de l'uretère droit peut irriter la voie urinaire et donner quelques leucocytes dans les urines par contiguïté." },
      { label: "C", text: "La bandelette urinaire doit systématiquement être réalisée pour orienter vers une pyélonéphrite ou une colique néphrétique." },
      { label: "D", text: "Un contact lombaire franc à la palpation oriente davantage vers une cause rénale que vers une appendicite." },
      { label: "E", text: "Aucune des réponses n'est juste." },
    ],
    reponsesCorrectes: ["B", "C", "D"],
    explication: {
      globale:
        "La bandelette urinaire est un examen simple mais dont l'interprétation peut être piégeuse en cas de contiguïté anatomique entre l'appendice et la voie urinaire.",
      A: "Faux. C'est un piège classique : quelques leucocytes urinaires peuvent être présents par simple contiguïté inflammatoire, sans authentique infection urinaire.",
      B: "Vrai. La proximité anatomique entre l'appendice enflammé et l'uretère droit explique cette irritation réactionnelle de la voie urinaire.",
      C: "Vrai. Cet examen simple et rapide participe à l'élimination des diagnostics différentiels urinaires.",
      D: "Vrai. Un contact lombaire franc est plus évocateur d'une pathologie rénale que d'une appendicite, qui ne donne classiquement pas ce signe.",
      E: "Faux, puisque B, C et D sont exactes.",
    },
  },
  {
    id: 17,
    question:
      "Concernant l'appendice noyé en position méso-cœliaque (au milieu des anses grêles), quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "Cette position donne classiquement un tableau trompeur d'occlusion fébrile par iléus réflexe précoce." },
      { label: "B", text: "Ce piège topographique est particulièrement fréquent chez le sujet jeune sans comorbidité." },
      { label: "C", text: "Le diagnostic repose davantage sur l'imagerie que sur la seule clinique dans cette forme." },
      { label: "D", text: "Cette position est classiquement associée à une défense pariétale franche et localisée." },
      { label: "E", text: "Toutes les réponses précédentes sont exactes." },
    ],
    reponsesCorrectes: ["A", "C"],
    explication: {
      globale:
        "La position méso-cœliaque illustre combien la topographie de l'appendice peut transformer radicalement la présentation clinique de la même maladie.",
      A: "Vrai. L'iléus réflexe précoce lié à l'inflammation au contact des anses grêles mime un tableau occlusif fébrile trompeur.",
      B: "Faux. Ce piège topographique est classiquement décrit comme plus fréquent chez le sujet âgé, où il s'ajoute aux autres facteurs de retard diagnostique.",
      C: "Vrai. La clinique étant peu spécifique dans cette forme, l'imagerie devient déterminante pour poser le diagnostic.",
      D: "Faux. La défense y est au contraire souvent absente ou minime, l'appendice étant noyé au milieu des anses et non au contact direct de la paroi antérieure.",
      E: "Faux, puisque B et D sont fausses.",
    },
  },
  {
    id: 18,
    question:
      "Concernant les contre-indications et pièges thérapeutiques de l'appendicite aiguë, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "L'administration d'un laxatif devant une douleur abdominale fébrile non étiquetée peut précipiter une perforation." },
      { label: "B", text: "Les antalgiques majeurs doivent être évités avant l'avis chirurgical, car ils masquent la défense et faussent la surveillance évolutive." },
      { label: "C", text: "Un lavement est formellement contre-indiqué devant une suspicion d'appendicite aiguë." },
      { label: "D", text: "L'utilisation d'antalgiques majeurs retarde toujours la prise de décision chirurgicale, quel que soit le contexte." },
      { label: "E", text: "Toutes les réponses A, B et C sont exactes." },
    ],
    reponsesCorrectes: ["E"],
    explication: {
      globale:
        "Ces règles constituent des réflexes de sécurité absolus, indépendamment du terrain ou du contexte de gravité — des pièges d'examen classiques et redoutés.",
      A: "Vrai. Un laxatif majore la pression intraluminale et peut précipiter la perforation d'un appendice déjà fragilisé.",
      B: "Vrai. Les antalgiques majeurs masquent la défense pariétale, faussant l'évaluation évolutive avant la décision chirurgicale.",
      C: "Vrai. Le lavement, comme le laxatif, précipite la perforation en majorant la pression intraluminale.",
      D: "Faux — cette proposition surgénéralise abusivement : une fois la décision chirurgicale prise, l'antalgie ne doit justement plus être retardée.",
      E: "Vrai, car A, B et C sont exactes ; la question teste la capacité à distinguer la nuance de D, qui est fausse.",
    },
  },
  {
    id: 19,
    question:
      "Concernant le traitement chirurgical de référence de l'appendicite aiguë non compliquée, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "L'appendicectomie cœlioscopique est la voie de référence en l'absence de contre-indication." },
      { label: "B", text: "La cœlioscopie permet une exploration complète de la cavité péritonéale, utile en cas de position atypique de l'appendice." },
      { label: "C", text: "Un lavage péritonéal systématique est requis même en l'absence de tout épanchement ou de perforation." },
      { label: "D", text: "L'antibioprophylaxie doit être administrée dans l'heure précédant l'incision chirurgicale." },
      { label: "E", text: "La convalescence après cœlioscopie est classiquement plus rapide qu'après laparotomie." },
    ],
    reponsesCorrectes: ["A", "B", "D", "E"],
    explication: {
      globale:
        "La cœlioscopie s'est imposée comme la référence moderne de l'appendicectomie non compliquée, pour des raisons diagnostiques autant que thérapeutiques.",
      A: "Vrai. C'est la voie de référence actuelle, en l'absence de contre-indication spécifique.",
      B: "Vrai. Cette exploration complète est un avantage majeur face à une position atypique, contrairement à une incision de McBurney limitée.",
      C: "Faux. Le lavage péritonéal systématique n'est indiqué qu'en cas de perforation ou d'épanchement, pas dans une forme simple sans complication.",
      D: "Vrai. C'est la fenêtre temporelle classiquement retenue pour l'efficacité de l'antibioprophylaxie péri-opératoire.",
      E: "Vrai. La cœlioscopie offre une convalescence plus rapide et des suites moins douloureuses qu'une laparotomie classique.",
    },
  },
  {
    id: 20,
    question:
      "Concernant la surveillance post-opératoire d'une appendicectomie non compliquée, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "Les constantes doivent être surveillées toutes les 4 heures dans les suites immédiates." },
      { label: "B", text: "La reprise du transit est un critère de surveillance clinique pertinent." },
      { label: "C", text: "Une sortie à J1-J2 est envisageable en cas de suites simples." },
      { label: "D", text: "Une fièvre persistante au-delà de J3 doit faire rechercher une complication infectieuse (abcès de paroi, collection profonde)." },
      { label: "E", text: "Toutes les réponses précédentes sont exactes." },
    ],
    reponsesCorrectes: ["E"],
    explication: {
      globale:
        "La surveillance post-opératoire standard vise à détecter précocement toute complication, tout en permettant une sortie rapide en cas d'évolution simple.",
      A: "Vrai. Cette fréquence de surveillance des constantes est classique en post-opératoire immédiat.",
      B: "Vrai. La reprise du transit est un marqueur clinique simple de bonne évolution digestive post-opératoire.",
      C: "Vrai. Une sortie précoce à J1-J2 est habituelle après cœlioscopie non compliquée.",
      D: "Vrai. Une fièvre persistante au-delà de J3 doit systématiquement faire rechercher une complication infectieuse post-opératoire.",
      E: "Vrai, l'ensemble des propositions décrivant fidèlement la surveillance standard attendue.",
    },
  },
  {
    id: 21,
    question:
      "Concernant le diagnostic de péritonite généralisée d'origine appendiculaire, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "La disparition de la matité pré-hépatique traduit la présence d'un pneumopéritoine." },
      { label: "B", text: "Le silence auscultatoire abdominal complet traduit un iléus réflexe généralisé." },
      { label: "C", text: "La contracture abdominale généralisée (« ventre de bois ») est un signe qui, à lui seul, pose déjà l'indication chirurgicale." },
      { label: "D", text: "L'acidose métabolique à trou anionique élevé retrouvée aux gaz du sang s'explique par l'accumulation de lactates." },
      { label: "E", text: "Toutes les réponses précédentes sont exactes." },
    ],
    reponsesCorrectes: ["E"],
    explication: {
      globale:
        "Cette question de synthèse rassemble les grands signes cliniques et biologiques cardinaux de la péritonite généralisée compliquant une appendicite perforée.",
      A: "Vrai. L'air libre intra-péritonéal issu de la perforation s'interpose entre le foie et la paroi, remplaçant la matité hépatique par une sonorité anormale.",
      B: "Vrai. L'inflammation péritonéale bloque le péristaltisme intestinal par inhibition neurogène, expliquant le silence auscultatoire.",
      C: "Vrai. Ce signe, à lui seul, pose déjà l'indication chirurgicale sans attendre la moindre imagerie.",
      D: "Vrai. L'accumulation d'acide lactique consomme les bicarbonates tampons, créant cette acidose à trou anionique augmenté.",
      E: "Vrai, l'ensemble de ces signes décrivant fidèlement le tableau de péritonite généralisée.",
    },
  },
  {
    id: 22,
    question:
      "Concernant les hémocultures et l'antibiothérapie dans le sepsis d'origine abdominale, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "Les hémocultures doivent être prélevées après la première dose d'antibiotique, pour ne pas retarder le traitement." },
      { label: "B", text: "Un retard d'antibiothérapie efficace augmente mesurablement la mortalité du choc septique." },
      { label: "C", text: "La Pipéracilline-Tazobactam couvre les entérobactéries, les anaérobies, et partiellement le Pseudomonas." },
      { label: "D", text: "La procalcitonine est un marqueur plus spécifique que la CRP pour confirmer une infection bactérienne systémique authentique." },
      { label: "E", text: "Aucune des réponses n'est juste." },
    ],
    reponsesCorrectes: ["B", "C", "D"],
    explication: {
      globale:
        "Cette question porte sur la séquence exacte de prise en charge microbiologique et antibiotique du sepsis sévère, un point extrêmement classant en réanimation chirurgicale.",
      A: "Faux. Les hémocultures doivent impérativement être prélevées avant la première dose d'antibiotique, sous peine de stériliser le prélèvement.",
      B: "Vrai. Chaque heure de retard d'antibiothérapie efficace augmente la mortalité du choc septique de façon mesurable.",
      C: "Vrai. C'est précisément ce spectre large qui justifie son utilisation probabiliste dans un sepsis abdominal non documenté.",
      D: "Vrai. La procalcitonine, sécrétée massivement lors d'une infection bactérienne systémique authentique, est plus spécifique que la CRP à cet égard.",
      E: "Faux, puisque B, C et D sont exactes.",
    },
  },
  {
    id: 23,
    question:
      "Concernant l'objectif hémodynamique et le remplissage vasculaire dans le choc septique d'origine abdominale, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "Le remplissage initial recommandé est de l'ordre de 30 mL/kg de cristalloïdes en bolus." },
      { label: "B", text: "Le Ringer Lactate est préféré au sérum salé isotonique seul notamment pour limiter la surcharge en chlore." },
      { label: "C", text: "L'objectif de pression artérielle moyenne (PAM) sous vasopresseurs est habituellement fixé à 65 mmHg." },
      { label: "D", text: "La Noradrénaline agit principalement par un effet vasodilatateur périphérique." },
      { label: "E", text: "La diurèse horaire cible de la réanimation est habituellement supérieure à 0,5 mL/kg/h." },
    ],
    reponsesCorrectes: ["A", "B", "C", "E"],
    explication: {
      globale:
        "Cette question synthétise les grands objectifs quantifiés de la réanimation du choc septique, indépendamment de sa cause chirurgicale sous-jacente.",
      A: "Vrai. Ce volume initial en bolus est la recommandation standard pour restaurer la précharge cardiaque.",
      B: "Vrai. Le Ringer Lactate, plus proche du plasma, limite la surcharge chlorée délétère associée au sérum salé isotonique seul en grande quantité.",
      C: "Vrai. Un objectif de PAM ≥ 65 mmHg est la cible habituellement retenue sous vasopresseurs.",
      D: "Faux. La Noradrénaline est au contraire un vasoconstricteur alpha-1 puissant, restaurant le tonus vasculaire périphérique effondré.",
      E: "Vrai. Cette diurèse horaire cible reflète une perfusion rénale, donc une réanimation hémodynamique efficace.",
    },
  },
  {
    id: 24,
    question:
      "Concernant la stratégie de coloscopie de contrôle après un épisode d'appendicite aiguë, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "Elle est systématique chez tout patient, quel que soit l'âge, après une appendicectomie simple non compliquée." },
      { label: "B", text: "Elle est particulièrement indiquée après un plastron appendiculaire traité médicalement chez le sujet âgé." },
      { label: "C", text: "Elle vise notamment à ne pas méconnaître une néoplasie colique droite sous-jacente." },
      { label: "D", text: "Elle doit être réalisée immédiatement en période inflammatoire aiguë, sans attendre la cicatrisation." },
      { label: "E", text: "Aucune des réponses n'est juste." },
    ],
    reponsesCorrectes: ["B", "C"],
    explication: {
      globale:
        "La coloscopie de contrôle n'est pas systématique pour toute appendicite, mais devient un réflexe impératif dans certains contextes à risque de diagnostic différentiel néoplasique méconnu.",
      A: "Faux. Elle n'est pas systématique pour une appendicectomie simple, non compliquée, chez un sujet jeune sans facteur de risque.",
      B: "Vrai. Chez le sujet âgé traité pour un plastron, la coloscopie de contrôle à distance est impérative.",
      C: "Vrai. C'est précisément son objectif principal : ne pas méconnaître un cancer colique droit révélé par sa complication pseudo-appendiculaire.",
      D: "Faux. Elle doit être réalisée à distance, après cicatrisation complète, jamais en période inflammatoire aiguë (risque de perforation instrumentale).",
      E: "Faux, puisque B et C sont exactes.",
    },
  },
  {
    id: 25,
    question:
      "Concernant la prise en charge globale et la hiérarchisation des priorités dans un tableau évocateur d'appendicite aiguë, quelle(s) proposition(s) est/sont exacte(s) ?",
    options: [
      { label: "A", text: "Devant un score d'Alvarado élevé et une clinique franche, l'avis chirurgical doit toujours précéder l'imagerie complémentaire systématique." },
      { label: "B", text: "Chez un patient en état de choc, la réanimation hémodynamique doit précéder la confirmation d'imagerie." },
      { label: "C", text: "Chez le sujet âgé et la femme enceinte, la présentation clinique doit être réinterprétée en fonction des particularités physiologiques du terrain." },
      { label: "D", text: "Le raisonnement diagnostique et thérapeutique de l'appendicite aiguë est strictement identique quel que soit le terrain considéré." },
      { label: "E", text: "Toutes les réponses précédentes sont exactes." },
    ],
    reponsesCorrectes: ["A", "B", "C"],
    explication: {
      globale:
        "Cette question de synthèse finale rassemble les grands principes transversaux de la prise en charge de l'appendicite aiguë, quel que soit le terrain ou la gravité du tableau.",
      A: "Vrai. Face à une clinique et un score suffisamment évocateurs, il ne faut pas perdre de temps en imagerie complémentaire systématique.",
      B: "Vrai. La réanimation prime toujours sur l'imagerie chez le patient en état de choc, quelle qu'en soit la cause.",
      C: "Vrai. Le terrain modifie profondément l'expression clinique et biologique de la maladie, imposant une réinterprétation systématique des signes.",
      D: "Faux. C'est l'inverse : cette question entière démontre que le terrain modifie profondément le raisonnement clinique, biologique et thérapeutique.",
      E: "Faux, puisque D est fausse.",
    },
  },
];

const qrocData: QROC[] = [
  {
    id: 1,
    question:
      "Citez les 3 examens biologiques à demander systématiquement en première intention devant une suspicion d'appendicite aiguë chez une femme en âge de procréer.",
    reponseOfficielle:
      "NFS (recherche d'une hyperleucocytose à polynucléaires neutrophiles) ; CRP (marqueur inflammatoire, à interpréter en cinétique) ; β-hCG plasmatiques (élimination formelle d'une grossesse extra-utérine).",
  },
  {
    id: 2,
    question:
      "Citez le seuil échographique classiquement retenu pour affirmer le caractère pathologique d'un appendice, ainsi que le signe échographique associé traduisant sa non-compressibilité.",
    reponseOfficielle:
      "Diamètre appendiculaire supérieur à 6 mm ; appendice non compressible à la pression de la sonde d'échographie, associé à une infiltration de la graisse péri-appendiculaire.",
  },
  {
    id: 3,
    question: "Décrivez la conduite à tenir en fonction des 3 zones du score d'Alvarado (moins de 4, 5-6, 7 et plus).",
    reponseOfficielle:
      "Score < 4 : surveillance clinique simple, réévaluation à quelques heures. Score 5-6 : imagerie complémentaire nécessaire (échographie ou TDM selon le terrain). Score ≥ 7 : avis chirurgical direct sans délai, sans attendre l'imagerie.",
  },
  {
    id: 4,
    question:
      "Citez les 2 molécules et leurs classes pharmacologiques utilisées en antibioprophylaxie péri-opératoire dans l'appendicectomie non compliquée, ainsi que le moment de leur administration.",
    reponseOfficielle:
      "Céfazoline (céphalosporine de 1ère génération, 2g IV) et Métronidazole (imidazolé, 500mg IV), administrés en dose unique dans l'heure précédant l'incision chirurgicale.",
  },
  {
    id: 5,
    question:
      "Citez les 2 gestes formellement contre-indiqués devant une suspicion d'appendicite aiguë et expliquez brièvement le mécanisme du danger encouru.",
    reponseOfficielle:
      "Laxatifs et lavements, tous deux contre-indiqués car ils majorent la pression intraluminale appendiculaire et peuvent précipiter la perforation d'un appendice déjà fragilisé par l'inflammation.",
  },
  {
    id: 6,
    question:
      "Décrivez la conduite à tenir thérapeutique devant un plastron appendiculaire constitué, en précisant le délai de l'appendicectomie différée.",
    reponseOfficielle:
      "Pas de chirurgie immédiate (contre-indication formelle) ; antibiothérapie IV première (traitement « à chaud », par exemple Ceftriaxone + Métronidazole) ; appendicectomie différée « à froid » à 6-8 semaines, associée à une coloscopie de contrôle systématique chez le sujet à risque.",
  },
  {
    id: 7,
    question:
      "Citez les 3 premières mesures de réanimation à entreprendre chez un patient en choc septique d'origine appendiculaire (péritonite généralisée), avant tout geste chirurgical.",
    reponseOfficielle:
      "Oxygénothérapie à haut débit avec monitorage scope continu ; pose de 2 voies veineuses de gros calibre (14-16G) ; remplissage vasculaire par cristalloïdes (Ringer Lactate 30 mL/kg en bolus initial), avec recours aux vasopresseurs (Noradrénaline) en cas d'hypotension persistante.",
  },
];

/* ----------------------------------------------------------------------- */
/* Phase 3 & 4 — Interactive UI.                                            */
/* ----------------------------------------------------------------------- */

function QcmCard({ qcm, revealed, onReveal }: { qcm: QCM; revealed: boolean; onReveal: () => void }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 md:p-6 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-black text-sm">{qcm.id}</span>
        <p className="text-sm md:text-base font-semibold text-slate-800 dark:text-slate-100 leading-relaxed pt-0.5">{qcm.question}</p>
      </div>

      <div className="space-y-2">
        {qcm.options.map((opt) => {
          const isCorrect = qcm.reponsesCorrectes.includes(opt.label);
          return (
            <div
              key={opt.label}
              className={cn(
                "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors duration-300",
                !revealed && "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300",
                revealed &&
                  isCorrect &&
                  "border-emerald-500 bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-200",
                revealed &&
                  !isCorrect &&
                  "border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/20 text-slate-500 dark:text-slate-500"
              )}
            >
              <span className="font-black shrink-0">{opt.label}.</span>
              <span className="flex-1">{opt.text}</span>
              {revealed && isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />}
              {revealed && !isCorrect && <XCircle className="w-4 h-4 text-rose-300 dark:text-rose-800 shrink-0 mt-0.5" />}
            </div>
          );
        })}
      </div>

      {!revealed && (
        <button
          onClick={onReveal}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-sm transition-colors duration-200"
        >
          Vérifier la réponse
        </button>
      )}

      {revealed && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-r-xl border-l-4 border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 p-4 space-y-2"
        >
          <p className="text-sm font-bold text-indigo-900 dark:text-indigo-200 leading-relaxed">{qcm.explication.globale}</p>
          <ul className="space-y-1.5 text-sm text-indigo-800 dark:text-indigo-300 leading-relaxed">
            <li>
              <strong className="text-indigo-900 dark:text-indigo-100">A.</strong> {qcm.explication.A}
            </li>
            <li>
              <strong className="text-indigo-900 dark:text-indigo-100">B.</strong> {qcm.explication.B}
            </li>
            <li>
              <strong className="text-indigo-900 dark:text-indigo-100">C.</strong> {qcm.explication.C}
            </li>
            <li>
              <strong className="text-indigo-900 dark:text-indigo-100">D.</strong> {qcm.explication.D}
            </li>
            <li>
              <strong className="text-indigo-900 dark:text-indigo-100">E.</strong> {qcm.explication.E}
            </li>
          </ul>
        </motion.div>
      )}
    </div>
  );
}

function QrocCard({ qroc, revealed, onReveal }: { qroc: QROC; revealed: boolean; onReveal: () => void }) {
  return (
    <div className="rounded-2xl border border-purple-200 dark:border-purple-900/40 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-8 h-8 rounded-lg bg-purple-600 text-white flex items-center justify-center font-black text-sm">{qroc.id}</span>
        <p className="text-sm md:text-base font-semibold text-slate-800 dark:text-slate-100 leading-relaxed pt-0.5">{qroc.question}</p>
      </div>

      {!revealed ? (
        <button
          onClick={onReveal}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold shadow-sm transition-colors duration-200"
        >
          Voir le corrigé (Mots-clés)
        </button>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-xl border-2 border-dashed border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/20 p-4"
        >
          <p className="text-[10px] font-black uppercase tracking-wide text-purple-600 dark:text-purple-400 mb-1.5">Barème — Mots-clés attendus</p>
          <p className="text-sm font-medium text-purple-900 dark:text-purple-200 leading-relaxed">{qroc.reponseOfficielle}</p>
        </motion.div>
      )}
    </div>
  );
}

export function ExamQcmStudio() {
  const [revealedQcms, setRevealedQcms] = useState<Record<number, boolean>>({});
  const [revealedQrocs, setRevealedQrocs] = useState<Record<number, boolean>>({});

  return (
    <div className="w-full mx-auto space-y-8 font-sans text-slate-800 dark:text-slate-200 animate-fade-in">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-700 to-blue-900 dark:from-indigo-950 dark:to-black p-8 shadow-xl border border-indigo-400/30">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-white/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-3 bg-white/10 backdrop-blur-md rounded-2xl text-white">
            <GraduationCap className="w-9 h-9" />
          </div>
          <div>
            <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-white/20 text-white rounded-full border border-white/30">
              Niveau Faculté de Médecine de Blida — 4ème Année
            </span>
            <h1 className="text-2xl md:text-4xl font-black text-white uppercase tracking-tight mt-2">L'Épreuve Ultime</h1>
            <p className="text-sm text-indigo-100 mt-1 max-w-2xl">
              {qcmsData.length} QCM et {qrocData.length} QROC à difficulté extrême — vignettes longues, réponses multiples, pièges classiques. Aucune complaisance.
            </p>
          </div>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b-2 border-indigo-200 dark:border-indigo-900/40 pb-2">
          <ListChecks className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-lg font-black uppercase tracking-wide text-indigo-700 dark:text-indigo-400">Épreuve QCM ({qcmsData.length} questions)</h2>
        </div>
        <div className="space-y-4">
          {qcmsData.map((qcm) => (
            <QcmCard
              key={qcm.id}
              qcm={qcm}
              revealed={!!revealedQcms[qcm.id]}
              onReveal={() => setRevealedQcms((prev) => ({ ...prev, [qcm.id]: true }))}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b-2 border-purple-200 dark:border-purple-900/40 pb-2">
          <PenLine className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          <h2 className="text-lg font-black uppercase tracking-wide text-purple-700 dark:text-purple-400">Épreuve QROC ({qrocData.length} questions)</h2>
        </div>
        <div className="space-y-4">
          {qrocData.map((qroc) => (
            <QrocCard
              key={qroc.id}
              qroc={qroc}
              revealed={!!revealedQrocs[qroc.id]}
              onReveal={() => setRevealedQrocs((prev) => ({ ...prev, [qroc.id]: true }))}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
