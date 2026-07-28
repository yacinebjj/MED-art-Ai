export interface VisualStudioSlide {
  id: number;
  type: "IMAGE_SLIDE" | "DIAGRAM_SLIDE";
  title: string;
  subtitle: string;
  content: string;
  imageUrl?: string;
  mermaidCode?: string;
}

export const VISUAL_STUDIO_DEMO_SLIDES: VisualStudioSlide[] = [
  {
    id: 1,
    type: "IMAGE_SLIDE",
    title: "Introduction & Épidémiologie",
    subtitle: "Généralités sur l'appendicite aigüe",
    content:
      "L'appendicite aiguë est l'urgence chirurgicale abdominale la plus fréquente dans le monde occidental. Elle touche surtout les sujets jeunes entre 10 et 30 ans, avec un pic chez l'adolescent, période où le tissu lymphoïde appendiculaire (GALT) est maximal. Le risque cumulé au cours de la vie avoisine 7 à 8 %. Son diagnostic précoce est capital : chaque heure de retard augmente le risque de perforation, de péritonite et de morbidité post-opératoire.",
    imageUrl:
      "https://images.unsplash.com/photo-1551076805-e1869033e561?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 2,
    type: "IMAGE_SLIDE",
    title: "Anatomie de l'Appendice",
    subtitle: "Rappel anatomique et embryologique",
    content:
      "L'appendice vermiculaire est un diverticule tubulaire borgne (6 à 10 cm) greffé sur la face postéro-médiale du cæcum, à la convergence exacte des trois bandelettes coliques (ténias) — repère chirurgical constant. Sa pointe est variable : rétrocæcale (~65 %), pelvienne (~30 %), sous-hépatique ou rétro-iléale. Il est vascularisé par l'artère appendiculaire, branche terminale de l'iléo-colique sans collatérale, ce qui explique la rapidité de l'ischémie en cas d'obstruction.",
    imageUrl:
      "https://images.unsplash.com/photo-1530213786676-415b0d4749cc?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 3,
    type: "DIAGRAM_SLIDE",
    title: "Physiopathologie 1 — L'Obstruction",
    subtitle: "Déclenchement du processus inflammatoire",
    content:
      "L'élément déclenchant initial est le plus souvent mécanique : obstruction brutale de la lumière appendiculaire par un stercorithe (appendicolithe) chez l'adulte, ou par une hyperplasie lymphoïde réactionnelle chez le sujet jeune — souvent post-virale. Plus rarement : corps étranger, tumeur carcinoïde ou ascariose en zone tropicale. Cette obstruction transforme l'appendice en cul-de-sac fermé, isolant la cavité appendiculaire du drainage cæcal.",
    mermaidCode: `graph LR
    A[Stercolithe / Hyperplasie Lymphoïde] --> B[Obstruction de la lumière appendiculaire]
    style A fill:#334155,stroke:#64748b,stroke-width:2px,color:#e2e8f0
    style B fill:#fbbf24,stroke:#333,stroke-width:2px,color:#000`,
  },
  {
    id: 4,
    type: "DIAGRAM_SLIDE",
    title: "Physiopathologie 2 — Distension",
    subtitle: "Augmentation de la pression intraluminale",
    content:
      "En amont de l'obstacle, la muqueuse continue de sécréter du mucus alors que l'évacuation est bloquée. Il en résulte une accumulation rapide de liquide intraluminal et une élévation progressive de la pression pariétale. Cette distension stimule les afférences viscérales sympathiques (métamère T10), provoquant la douleur péri-ombilicale diffuse et mal systématisée du stade initial.",
    mermaidCode: `graph LR
    A[Obstruction] --> C[Accumulation continue de mucus]
    C --> D[Augmentation de la pression intraluminale]
    style A fill:#334155,stroke:#64748b,stroke-width:2px,color:#e2e8f0
    style D fill:#f97316,stroke:#333,stroke-width:2px,color:#fff`,
  },
  {
    id: 5,
    type: "DIAGRAM_SLIDE",
    title: "Physiopathologie 3 — Ischémie Veineuse",
    subtitle: "Souffrance pariétale et œdème",
    content:
      "L'hyperpression comprime d'abord le drainage veineux et lymphatique — réseau à basse pression, le plus fragile. En résultent stase, anoxie locale et œdème pariétal important. La muqueuse, couche la plus sensible à l'hypoxie, est la première à souffrir. Tant que l'artère appendiculaire — artère terminale sans collatérale — reste perfusée, l'ischémie reste réversible.",
    mermaidCode: `graph LR
    D[Pression élevée] --> E[Compression du drainage veineux]
    E --> F[Œdème pariétal et stase]
    style D fill:#334155,stroke:#64748b,stroke-width:2px,color:#e2e8f0
    style F fill:#ef4444,stroke:#333,stroke-width:2px,color:#fff`,
  },
  {
    id: 6,
    type: "DIAGRAM_SLIDE",
    title: "Physiopathologie 4 — Ischémie Artérielle & Nécrose",
    subtitle: "Stade de transition vers la perforation",
    content:
      "Si la pression continue de monter, l'artère appendiculaire est à son tour comprimée. L'ischémie devient transmurale : micro-abcès, infarctus tissulaire, gangrène pariétale. La barrière muqueuse cède, la flore colique (E. coli, Bacteroides) envahit la paroi. La nécrose aboutit à la rupture de la paroi — perforation — avec déversement du contenu septicémique dans la cavité péritonéale.",
    mermaidCode: `graph LR
    F[Œdème & Stase] --> G[Arrêt de la perfusion artérielle]
    G --> H[Infarctus, Nécrose & Perforation]
    style F fill:#334155,stroke:#64748b,stroke-width:2px,color:#e2e8f0
    style H fill:#991b1b,stroke:#333,stroke-width:2px,color:#fff`,
  },
  {
    id: 7,
    type: "IMAGE_SLIDE",
    title: "La Complication — Péritonite",
    subtitle: "Diffusion de l'infection dans la cavité",
    content:
      "En l'absence de prise en charge, la perforation libère pus et contenu fécal dans le péritoine. On distingue la péritonite localisée (abcès appendiculaire ou plastron, parfois accessible au drainage percutané) de la péritonite généralisée fécale, urgence vitale nécessitant une réanimation, une antibiothérapie à large spectre et une intervention chirurgicale en urgence absolue.",
    imageUrl:
      "https://images.unsplash.com/photo-1584362917165-526a968579e8?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 8,
    type: "IMAGE_SLIDE",
    title: "Clinique — La Douleur Abdominale",
    subtitle: "Chronologie de Murphy",
    content:
      "La sémiologie classique suit la chronologie de Murphy : douleur épigastrique ou péri-ombilicale diffuse (viscérale, T10), apparaissant en 6 à 12 heures, puis migration et fixation en fosse iliaque droite (FID) lorsque l'inflammation atteint le péritoine pariétal (somatique). Cette migration est un signe très évocateur. Nausées, vomissements et anorexie accompagnent souvent le tableau.",
    imageUrl:
      "https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 9,
    type: "IMAGE_SLIDE",
    title: "Clinique — Examen Physique",
    subtitle: "Signes cliniques clés",
    content:
      "L'examen recherche des points douloureux précis : point de McBurney (1/3 externe de la ligne ombilic-épine iliaque antérieure), signe de Blumberg (douleur à la décompression brutale = irritation péritonéale), signe de Rovsing (douleur FID à la palpation FOG), signes du psoas et de l'obturateur en cas d'appendice rétrocæcal ou pelvien. Une défense localisée de la FID et une contracture en cas de péritonite généralisée complètent l'évaluation.",
    imageUrl:
      "https://images.unsplash.com/photo-1581056771107-24ca5f033842?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 10,
    type: "DIAGRAM_SLIDE",
    title: "Score d'Alvarado (MANTRELS)",
    subtitle: "Outil d'aide à la décision diagnostique",
    content:
      "Le score d'Alvarado (mnémotechnique MANTRELS : Migration, Anorexie, Nausées, Tenderness FID, Rebound, Élevated température, Leucocytose, Shift à gauche) stratifie la probabilité d'appendicite. ≤ 4 points : diagnostic alternatif probable. 5-6 points : imagerie complémentaire recommandée. ≥ 7 points : avis chirurgical urgent, appendicectomie souvent indiquée sans retard.",
    mermaidCode: `graph TD
    A[Évaluation Score d'Alvarado] --> B{Score global}
    B -- "<= 4 points" --> C[Diagnostic alternatif / Échographie de contrôle]
    B -- "5 à 6 points" --> D[Imagerie complémentaire : Échographie / Scanner]
    B -- ">= 7 points" --> E[Avis Chirurgical en urgence / Chirurgie]
    style A fill:#334155,stroke:#64748b,stroke-width:2px,color:#e2e8f0
    style C fill:#22c55e,color:#fff
    style D fill:#eab308,color:#000
    style E fill:#ef4444,color:#fff`,
  },
  {
    id: 11,
    type: "IMAGE_SLIDE",
    title: "Biologie — NFS & CRP",
    subtitle: "Syndrome inflammatoire biologique",
    content:
      "L'hémogramme montre classiquement une hyperleucocytose (> 10 000/mm³) à polynucléose neutrophile avec left shift (déviation à gauche). La CRP est élevée (> 10 mg/L), corrélée à la sévérité. Une formule sanguine normale n'élimine pas le diagnostic, surtout en début d'évolution ou chez l'immunodéprimé. La procalcitonine peut orienter en cas de sepsis ou de péritonite généralisée.",
    imageUrl:
      "https://images.unsplash.com/photo-1579154204601-01588f351e67?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 12,
    type: "IMAGE_SLIDE",
    title: "Imagerie — Échographie Abdominale",
    subtitle: "Examen de première intention",
    content:
      "L'échographie abdominale, sans irradiation, est l'examen de première intention chez l'enfant et la femme enceinte. Critères positifs : appendice non compressible, borgne, diamètre transversal > 6 mm, paroi épaissie (> 3 mm), hyperémie Doppler, infiltration de la graisse péri-appendiculaire et parfois collection liquidienne. Sensibilité 75-90 %, dépendante de l'opérateur.",
    imageUrl:
      "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 13,
    type: "IMAGE_SLIDE",
    title: "Imagerie — Tomodensitométrie (TDM)",
    subtitle: "Le gold standard diagnostique",
    content:
      "Le scanner abdominal avec injection de produit de contraste iodé est l'examen le plus performant : sensibilité 95-98 %, spécificité 94-97 %. Il confirme l'épaississement pariétal, l'obstruction, l'appendicolithe, l'infiltration graisseuse, l'abcès ou la collection, et précise l'état du péritoine. Indispensable en cas de doute, de tableau atypique ou de complication.",
    imageUrl:
      "https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 14,
    type: "IMAGE_SLIDE",
    title: "Traitement — Appendicectomie",
    subtitle: "Prise en charge chirurgicale",
    content:
      "Le traitement curatif de référence reste l'appendicectomie, réalisée le plus souvent par voie coelioscopique (3 trocarts, résection et ligature de la base appendiculaire). Avantages : récupération rapide (24-48 h), moins de douleurs post-opératoires, meilleur résultat esthétique. La laparotomie de McBurney ou la laparotomie médiane sont réservées aux cas compliqués (péritonite généralisée, plastron non opérable).",
    imageUrl:
      "https://images.unsplash.com/photo-1551190822-a9333d879b1e?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 15,
    type: "IMAGE_SLIDE",
    title: "Suites Opératoires & Antibiothérapie",
    subtitle: "Prévention et convalescence",
    content:
      "Une antibiothérapie prophylactique (ex. céfoxitine ou amoxicilline-acide clavulanique) est administrée en per-opératoire. En cas d'appendicite compliquée (perforée, abcédée, péritonite), une antibiothérapie curative post-opératoire est prolongée (5 à 7 jours IV puis PO selon évolution). La sortie est généralement autorisée à J1-J2 pour les formes simples. Consignes : reprise progressive des activités, surveillance de la cicatrice et des signes de surinfection.",
    imageUrl:
      "https://images.unsplash.com/photo-1585435557343-3b092031a831?auto=format&fit=crop&w=1920&q=80",
  },
];
