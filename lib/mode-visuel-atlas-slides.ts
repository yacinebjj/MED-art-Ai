/**
 * The 18-slide "Immersive Augmented Atlas" payload for Mode Visuel. Each
 * slide is one of:
 * - IMAGE_SLIDE: a full-bleed Unsplash photo behind a floating glassmorphism
 *   text card.
 * - DIAGRAM_SLIDE: a Mermaid.js graph rendered front-and-center, with the
 *   same floating card explaining it.
 * - ANATOMY_SLIDE: the hand-drawn glowing SVG anatomy diagram (cæcum +
 *   appendix) over a dark tech-grid backdrop, with the same floating card.
 */

export type SlideKind = "IMAGE_SLIDE" | "DIAGRAM_SLIDE" | "ANATOMY_SLIDE";

interface BaseSlide {
  id: string;
  index: number;
  kind: SlideKind;
  title: string;
  content: string;
}

export interface ImageSlide extends BaseSlide {
  kind: "IMAGE_SLIDE";
  unsplashId: string;
}

export interface DiagramSlide extends BaseSlide {
  kind: "DIAGRAM_SLIDE";
  mermaidChart: string;
}

export interface AnatomySlideData extends BaseSlide {
  kind: "ANATOMY_SLIDE";
}

export type AtlasSlide = ImageSlide | DiagramSlide | AnatomySlideData;

function unsplashUrl(id: string): string {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1920&q=80`;
}

export const MODE_VISUEL_ATLAS_SLIDES: AtlasSlide[] = [
  {
    id: "intro",
    index: 0,
    kind: "IMAGE_SLIDE",
    title: "Introduction & Épidémiologie",
    unsplashId: "photo-1551076805-e1869033e561",
    content:
      "L'appendicite aiguë désigne l'inflammation aiguë de l'appendice vermiforme. C'est la première cause de chirurgie abdominale en urgence dans le monde, avec un pic d'incidence entre 10 et 30 ans et un risque cumulé sur la vie estimé à environ 7-8%.\n\nSon diagnostic reste avant tout clinique, mais sa présentation peut être trompeuse : un simple mal de ventre au départ peut évoluer, en quelques heures, vers une urgence chirurgicale vitale si la prise en charge est retardée.",
  },
  {
    id: "anatomy",
    index: 1,
    kind: "ANATOMY_SLIDE",
    title: "Cartographie Anatomique de l'Appendice",
    content:
      "L'appendice vermiforme naît de la face postéro-médiale du cæcum, à la convergence exacte des trois bandelettes coliques (ténias) — un repère chirurgical constant, quelle que soit la position de sa pointe.\n\nSa vascularisation, assurée par l'artère appendiculaire (branche terminale de l'artère iléo-colique), ne possède aucune collatérale de suppléance : une véritable impasse artérielle qui explique la vulnérabilité ischémique rapide de l'organe. La position de sa pointe varie considérablement : rétrocæcale dans environ 65% des cas, pelvienne dans 30%, plus rarement sous-hépatique.",
  },
  {
    id: "patho-1-obstruction",
    index: 2,
    kind: "DIAGRAM_SLIDE",
    title: "Physiopathologie 1 — L'Obstruction",
    mermaidChart: `graph LR
  A[Stercolithe / Hyperplasie] --> B[Obstruction de la lumière]
  style B fill:#fbbf24,stroke:#f59e0b,color:#1e293b`,
    content:
      "Le processus pathologique débute par l'obstruction complète de la lumière appendiculaire. Chez l'adulte, la cause la plus fréquente est le stercolithe — une concrétion fécale durcie et calcifiée. Chez le sujet jeune, c'est le plus souvent une hyperplasie lymphoïde réactionnelle, déclenchée par une infection virale banale ailleurs dans le corps.\n\nDans tous les cas, le résultat est identique : la petite porte se ferme, transformant l'appendice en un cul-de-sac complètement clos.",
  },
  {
    id: "patho-2-distension",
    index: 3,
    kind: "DIAGRAM_SLIDE",
    title: "Physiopathologie 2 — Distension",
    mermaidChart: `graph LR
  A[Stercolithe / Hyperplasie] --> B[Obstruction de la lumière] --> C[Accumulation de mucus] --> D[Augmentation de la pression intraluminale]
  style B fill:#334155,stroke:#64748b,color:#e2e8f0
  style C fill:#334155,stroke:#64748b,color:#e2e8f0
  style D fill:#fbbf24,stroke:#f59e0b,color:#1e293b`,
    content:
      "Une fois l'obstruction installée, la muqueuse continue de sécréter du mucus, mais ce mucus ne peut plus s'évacuer vers le cæcum. La pression intraluminale augmente inexorablement, distendant progressivement la paroi appendiculaire.\n\nCette distension stimule les fibres afférentes viscérales sympathiques, qui remontent vers la métamère T10 — c'est ce mécanisme qui explique la douleur périombilicale vague ressentie au tout début de la maladie.",
  },
  {
    id: "patho-3-venous-ischemia",
    index: 4,
    kind: "DIAGRAM_SLIDE",
    title: "Physiopathologie 3 — Ischémie Veineuse",
    mermaidChart: `graph LR
  A[Stercolithe / Hyperplasie] --> B[Obstruction de la lumière] --> C[Accumulation de mucus] --> D[Augmentation de la pression intraluminale] --> E[Compression du drainage lymphatique et veineux] --> F[Œdème pariétal]
  style B fill:#334155,stroke:#64748b,color:#e2e8f0
  style C fill:#334155,stroke:#64748b,color:#e2e8f0
  style D fill:#334155,stroke:#64748b,color:#e2e8f0
  style E fill:#334155,stroke:#64748b,color:#e2e8f0
  style F fill:#fbbf24,stroke:#f59e0b,color:#1e293b`,
    content:
      "La paroi appendiculaire contient deux réseaux vasculaires distincts : les veines, à basse pression, et les artères, à haute pression. La distension croissante comprime en premier lieu le réseau veineux et lymphatique, le plus fragile.\n\nCe blocage du retour veineux provoque un œdème pariétal : la paroi se gonfle d'eau et de sang, devenant progressivement plus épaisse et plus fragile — c'est à ce stade qu'elle devient visible en échographie.",
  },
  {
    id: "patho-4-arterial-necrosis",
    index: 5,
    kind: "DIAGRAM_SLIDE",
    title: "Physiopathologie 4 — Ischémie Artérielle & Nécrose",
    mermaidChart: `graph LR
  A[Stercolithe / Hyperplasie] --> B[Obstruction de la lumière] --> C[Accumulation de mucus] --> D[Augmentation de la pression intraluminale] --> E[Compression du drainage lymphatique et veineux] --> F[Œdème pariétal] --> G[Arrêt de la perfusion artérielle] --> H[Infarctus et Nécrose tissulaire]
  style B fill:#334155,stroke:#64748b,color:#e2e8f0
  style C fill:#334155,stroke:#64748b,color:#e2e8f0
  style D fill:#334155,stroke:#64748b,color:#e2e8f0
  style E fill:#334155,stroke:#64748b,color:#e2e8f0
  style F fill:#334155,stroke:#64748b,color:#e2e8f0
  style G fill:#334155,stroke:#64748b,color:#e2e8f0
  style H fill:#ef4444,color:#fff`,
    content:
      "Si la pression continue de monter, elle finit par comprimer également le réseau artériel, pourtant bien plus résistant. C'est un point de non-retour : plus aucun sang oxygéné n'arrive à la paroi.\n\nPrivées d'oxygène, les cellules meurent progressivement — c'est la nécrose transmurale. La paroi devient grise puis noire par endroits, incapable d'assurer sa fonction de barrière contre les bactéries coliques qui envahissent alors les tissus environnants.",
  },
  {
    id: "perforation",
    index: 6,
    kind: "IMAGE_SLIDE",
    title: "La Complication — Perforation",
    unsplashId: "photo-1584362917165-526a968579e8",
    content:
      "Une paroi nécrosée finit toujours par se rompre. Cette perforation survient typiquement entre 24 et 72 heures après le début des symptômes, mais peut être bien plus précoce chez l'enfant en bas âge ou le sujet âgé.\n\nSi le processus est lent, l'épiploon et les anses grêles voisines cloisonnent le foyer infectieux, formant un abcès circonscrit. Si le processus est rapide, le contenu septique diffuse dans toute la cavité péritonéale — c'est la péritonite généralisée, une urgence vitale.",
  },
  {
    id: "clinical-pain",
    index: 7,
    kind: "IMAGE_SLIDE",
    title: "Clinique — La Douleur",
    unsplashId: "photo-1579684385127-1ef15d508118",
    content:
      "Le tableau clinique classique associe une douleur initialement périombilicale, sourde et diffuse, qui migre en quelques heures vers la fosse iliaque droite où elle devient précise et intense — présente dans 50 à 60% des cas, mais très évocatrice.\n\nS'y associent typiquement une anorexie quasi constante, des nausées ou vomissements, et une fièvre modérée autour de 38-38,5°C. Chez l'enfant, la personne âgée et la femme enceinte, ce tableau peut être totalement atypique.",
  },
  {
    id: "clinical-exam",
    index: 8,
    kind: "IMAGE_SLIDE",
    title: "Clinique — Examen Physique",
    unsplashId: "photo-1581056771107-24ca5f033842",
    content:
      "Le point de McBurney, situé au tiers externe de la ligne reliant l'ombilic à l'épine iliaque antéro-supérieure droite, est le repère classique de la douleur maximale.\n\nLe signe de Blumberg — une douleur plus intense au relâchement brusque de la main qu'à la pression elle-même — traduit un péritonisme localisé. La défense pariétale, contraction réflexe et douloureuse des muscles abdominaux, doit être recherchée systématiquement : elle signe une irritation péritonéale déjà installée.",
  },
  {
    id: "special-populations",
    index: 9,
    kind: "IMAGE_SLIDE",
    title: "Populations Particulières",
    unsplashId: "photo-1581056771107-24ca5f033842",
    content:
      "Chez l'enfant de moins de 5 ans, le tableau est souvent trompeur : diarrhée, fièvre isolée, irritabilité — sans la migration douloureuse classique. Le risque de perforation est plus élevé car le diagnostic est fréquemment retardé.\n\nChez la femme enceinte, l'utérus gravide refoule l'appendice vers le haut et l'extérieur à partir du 2e trimestre : la douleur peut se situer bien au-dessus de la fosse iliaque droite classique. Chez le sujet âgé, la présentation est souvent fruste malgré une gravité anatomique déjà avancée — l'indice de suspicion doit rester élevé dans ces trois populations.",
  },
  {
    id: "alvarado",
    index: 10,
    kind: "DIAGRAM_SLIDE",
    title: "Score d'Alvarado (MANTRELS)",
    mermaidChart: `graph TD
  A[Douleur FID suspecte] --> B[Calcul du score d'Alvarado / MANTRELS]
  B --> C{Score total sur 10}
  C -->|Score ≤ 4| D[Probabilité faible]
  C -->|Score 5-6| E[Probabilité intermédiaire]
  C -->|Score ≥ 7| F[Probabilité forte]
  D --> G[Échographie / Réévaluation clinique]
  E --> H[Imagerie complémentaire : Échographie ou Scanner]
  F --> I[Avis Chirurgical Direct]
  style G fill:#22c55e,stroke:#16a34a,color:#fff
  style H fill:#334155,stroke:#64748b,color:#e2e8f0
  style I fill:#ef4444,stroke:#b91c1c,color:#fff`,
    content:
      "Le score d'Alvarado structure la probabilité clinique à partir de huit critères regroupés sous l'acronyme MANTRELS : Migration de la douleur, Anorexie, Nausées/vomissements, sensibilité (Tenderness) en FID (+2), douleur au Rebond, Élévation thermique, Leucocytose (+2), déviation gauche (Shift) de la formule.\n\nUn score inférieur ou égal à 4 oriente vers une réévaluation clinique. Un score supérieur ou égal à 7 justifie un avis chirurgical direct sans attendre d'imagerie complémentaire qui ne ferait que retarder la prise en charge.",
  },
  {
    id: "differential-diagnosis",
    index: 11,
    kind: "DIAGRAM_SLIDE",
    title: "Diagnostics Différentiels",
    mermaidChart: `graph TD
  A[Douleur en fosse iliaque droite] --> B[Appendicite Aiguë]
  A --> C[Grossesse Extra-Utérine]
  A --> D[Torsion d'Annexe / Adnexite]
  A --> E[Diverticulite Cæcale]
  A --> F[Adénite Mésentérique]
  style B fill:#ef4444,stroke:#b91c1c,color:#fff
  style C fill:#f59e0b,stroke:#b45309,color:#1e293b
  style D fill:#f59e0b,stroke:#b45309,color:#1e293b
  style E fill:#334155,stroke:#64748b,color:#e2e8f0
  style F fill:#334155,stroke:#64748b,color:#e2e8f0`,
    content:
      "Devant une douleur de fosse iliaque droite, plusieurs diagnostics miment l'appendicite. Chez la femme en âge de procréer, la grossesse extra-utérine et la torsion d'annexe doivent être systématiquement éliminées par un dosage de β-hCG et une échographie pelvienne — ce réflexe ne se discute pas.\n\nLa diverticulite cæcale peut donner un tableau scanographique très proche, mais avec un appendice normal individualisé à côté du diverticule enflammé. L'adénite mésentérique touche surtout l'enfant après un épisode viral ORL récent, avec des ganglions mésentériques hypertrophiés à l'échographie et un appendice sain.",
  },
  {
    id: "biology",
    index: 12,
    kind: "IMAGE_SLIDE",
    title: "Biologie — NFS & CRP",
    unsplashId: "photo-1579154204601-01588f351e67",
    content:
      "La numération formule sanguine retrouve typiquement une hyperleucocytose à polynucléaires neutrophiles, associée à une CRP élevée traduisant le syndrome inflammatoire. Ces deux marqueurs restent cependant non spécifiques.\n\nIl est crucial de retenir qu'une biologie parfaitement normale n'élimine jamais le diagnostic, surtout dans les toutes premières heures de la maladie. La cinétique de ces marqueurs, avec des dosages répétés à quelques heures d'intervalle, est souvent plus informative qu'un unique prélèvement initial.",
  },
  {
    id: "ultrasound",
    index: 13,
    kind: "IMAGE_SLIDE",
    title: "Imagerie — Échographie",
    unsplashId: "photo-1559757148-5c350d0d3c56",
    content:
      "L'échographie abdominale est l'examen de première intention, en particulier chez l'enfant et la femme enceinte. Elle recherche un appendice non compressible, dont le diamètre dépasse 6mm, avec une paroi épaissie.\n\nLe signe de la cible (« target sign »), correspondant à la coupe transversale de l'appendice enflammé, est particulièrement évocateur. Cet examen reste très opérateur-dépendant, et sa négativité n'élimine pas totalement le diagnostic.",
  },
  {
    id: "ct-scan",
    index: 14,
    kind: "IMAGE_SLIDE",
    title: "Imagerie — Scanner (TDM)",
    unsplashId: "photo-1516549655169-df83a0774514",
    content:
      "Le scanner abdomino-pelvien injecté est l'examen de référence chez l'adulte en cas de doute diagnostique persistant, avec une sensibilité et une spécificité toutes deux supérieures à 95%.\n\nIl recherche un appendice épaissi associé à une infiltration de la graisse péri-appendiculaire (« fat stranding »), qui traduit la diffusion transmurale de l'inflammation et signe une forme déjà avancée. Le scanner détecte également les complications telles qu'un abcès péri-appendiculaire.",
  },
  {
    id: "surgery",
    index: 15,
    kind: "IMAGE_SLIDE",
    title: "Traitement — Appendicectomie Cœlioscopique",
    unsplashId: "photo-1551076805-e1869033e561",
    content:
      "Le traitement de référence reste l'appendicectomie chirurgicale, réalisée en urgence. La voie cœlioscopique est aujourd'hui privilégiée : elle réduit la douleur post-opératoire, la durée d'hospitalisation, et améliore le résultat esthétique par rapport à la laparotomie classique.\n\nDevant un plastron déjà constitué, on préfère souvent traiter par antibiotiques d'abord, et opérer à froid quelques semaines plus tard, une fois l'inflammation résorbée.",
  },
  {
    id: "antibiotics",
    index: 16,
    kind: "IMAGE_SLIDE",
    title: "Antibiothérapie & Suites Opératoires",
    unsplashId: "photo-1585435557343-3b092031a831",
    content:
      "Une antibioprophylaxie péri-opératoire à large spectre — couvrant anaérobies et bacilles Gram négatif (BGN) — est systématique pour une appendicite simple, en dose unique à l'induction.\n\nEn cas de perforation ou de péritonite constatée en peropératoire, une antibiothérapie curative prolongée de 3 à 5 jours est nécessaire. La surveillance post-opératoire porte sur trois éléments simples : la température, la souplesse de l'abdomen, et l'aspect de la cicatrice.",
  },
  {
    id: "postop-complications",
    index: 17,
    kind: "DIAGRAM_SLIDE",
    title: "Complications Post-Opératoires",
    mermaidChart: `graph TD
  A[Suites post-appendicectomie] --> B[Évolution simple]
  A --> C[Infection du site opératoire]
  A --> D[Abcès intra-abdominal résiduel]
  A --> E[Iléus post-opératoire prolongé]
  A --> F[Lâchage du moignon appendiculaire]
  style B fill:#22c55e,stroke:#16a34a,color:#fff
  style C fill:#f59e0b,stroke:#b45309,color:#1e293b
  style D fill:#f59e0b,stroke:#b45309,color:#1e293b
  style E fill:#334155,stroke:#64748b,color:#e2e8f0
  style F fill:#ef4444,stroke:#b91c1c,color:#fff`,
    content:
      "La majorité des appendicectomies évoluent simplement, avec une sortie à J1-J2 pour la voie cœlioscopique. L'infection du site opératoire (5-10% des cas) se traite par soins locaux et antibiothérapie ciblée.\n\nUn abcès intra-abdominal résiduel, plus fréquent après perforation, nécessite souvent un drainage percutané guidé par imagerie associé à une antibiothérapie adaptée. Le lâchage du moignon appendiculaire, rare (moins de 1%) mais grave, impose une reprise chirurgicale en urgence.",
  },
];
