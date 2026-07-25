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
      "L'appendicite aigüe est l'urgence chirurgicale abdominale la plus fréquente. Elle touche principalement sujets jeunes entre 10 et 30 ans, avec un pic de fréquence chez l'adolescent. Son diagnostic précoce est capital pour éviter les complications redoutables telles que la péritonite.",
    imageUrl:
      "https://images.unsplash.com/photo-1551076805-e1869033e561?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 2,
    type: "IMAGE_SLIDE",
    title: "Anatomie de l'Appendice",
    subtitle: "Rappel anatomique et embryologique",
    content:
      "L'appendice vermiculaire est un diverticule tubulaire greffé sur le caecum, situé à la convergence des trois bandelettes coliques (ténias). Sa position est variable (pelvienne, rétro-caecale, mésocœliaque), ce qui explique la diversité des tableaux cliniques.",
    imageUrl:
      "https://images.unsplash.com/photo-1530213786676-415b0d4749cc?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 3,
    type: "DIAGRAM_SLIDE",
    title: "Physiopathologie 1 - L'Obstruction",
    subtitle: "Déclenchement du processus inflammatoire",
    content:
      "L'élément déclenchant initial est le plus souvent mécanique : obstruction de la lumière appendiculaire par un stercorithe (appendicolithe) ou par une hyperplasie lymphoïde. Cette obstruction isole la cavité appendiculaire.",
    mermaidCode: `graph LR
    A[Stercolithe / Hyperplasie Lymphoïde] --> B[Obstruction de la lumière appendiculaire]
    style B fill:#fbbf24,stroke:#333,stroke-width:2px,color:#000`,
  },
  {
    id: 4,
    type: "DIAGRAM_SLIDE",
    title: "Physiopathologie 2 - Distension",
    subtitle: "Augmentation de la pression intraluminale",
    content:
      "Suite à l'obstruction, la sécrétion continue de mucus par la muqueuse ne peut plus s'évacuer. Il en résulte une accumulation rapide de liquide et une élévation progressive de la pression intraluminale.",
    mermaidCode: `graph LR
    A[Obstruction] --> C[Accumulation continue de mucus]
    C --> D[Augmentation de la pression intraluminale]
    style D fill:#f97316,stroke:#333,stroke-width:2px,color:#fff`,
  },
  {
    id: 5,
    type: "DIAGRAM_SLIDE",
    title: "Physiopathologie 3 - Ischémie Veineuse",
    subtitle: "Souffrance pariétale et œdème",
    content:
      "L'hyper-pression dépasse la pression veineuse capillaire. Cela provoque la compression du drainage lymphatique et veineux, entraînant une stase, une anoxie locale et un œdème pariétal important.",
    mermaidCode: `graph LR
    D[Pression élevée] --> E[Compression du drainage veineux]
    E --> F[Œdème pariétal et stase]
    style F fill:#ef4444,stroke:#333,stroke-width:2px,color:#fff`,
  },
  {
    id: 6,
    type: "DIAGRAM_SLIDE",
    title: "Physiopathologie 4 - Ischémie Artérielle & Nécrose",
    subtitle: "Stade de transition vers la perforation",
    content:
      "L'ischémie s'aggrave par atteinte de la micro-circulation artérielle. Des micro-abcès se forment dans la paroi, menant à l'infarctus tissulaire, à la nécrose et ultimement à la rupture de la paroi (perforation).",
    mermaidCode: `graph LR
    F[Œdème & Stase] --> G[Arrêt de la perfusion artérielle]
    G --> H[Infarctus, Nécrose & Perforation]
    style H fill:#991b1b,stroke:#333,stroke-width:2px,color:#fff`,
  },
  {
    id: 7,
    type: "IMAGE_SLIDE",
    title: "La Complication - Péritonite",
    subtitle: "Diffusion de l'infection dans la cavité",
    content:
      "En l'absence de prise en charge, la nécrose conduit à la perforation de l'appendice, déversant le contenu septicémique dans la cavité péritonéale. Cela provoque une péritonite localisée (abcès) ou généralisée.",
    imageUrl:
      "https://images.unsplash.com/photo-1584362917165-526a968579e8?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 8,
    type: "IMAGE_SLIDE",
    title: "Clinique - La Douleur Abdominale",
    subtitle: "Chronologie de Murphy",
    content:
      "La sémiologie classique débute par une douleur épigastrique ou péri-ombilicale diffuse (viscérale), pour migrer secondairement et se fixer dans la Fosse Iliaque Droite (FID) au bout de quelques heures (somatique).",
    imageUrl:
      "https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 9,
    type: "IMAGE_SLIDE",
    title: "Clinique - Examen Physique",
    subtitle: "Signes cliniques clés",
    content:
      "L'examen recherche des points douloureux précis : le point de McBurney, le signe de Blumberg (douleur à la décompression brusque témoignant d'une irritation péritonéale), et une défense localisée de la FID.",
    imageUrl:
      "https://images.unsplash.com/photo-1581056771107-24ca5f033842?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 10,
    type: "DIAGRAM_SLIDE",
    title: "Score d'Alvarado (MANTRELS)",
    subtitle: "Outil d'aide à la décision diagnostique",
    content:
      "Le score d'alvarado combine des critères cliniques et biologiques pour stratifier le risque d'appendicite et orienter la stratégie radiologique ou chirurgicale immédiate.",
    mermaidCode: `graph TD
    A[Évaluation Score d'Alvarado] --> B{Score global}
    B -- "<= 4 points" --> C[Diagnostic alternatif / Échographie de contrôle]
    B -- "5 à 6 points" --> D[Imagerie complémentaire : Échographie / Scanner]
    B -- ">= 7 points" --> E[Avis Chirurgical en urgence / Chirurgie]
    style C fill:#22c55e,color:#fff
    style D fill:#eab308,color:#000
    style E fill:#ef4444,color:#fff`,
  },
  {
    id: 11,
    type: "IMAGE_SLIDE",
    title: "Biologie - NFS & CRP",
    subtitle: "Syndrome inflammatoire biologique",
    content:
      "L'hémogramme montre classiquement une hyperleucocytose à PNN (Polynucléaires Neutrophiles). La CRP (Protéine C-Réactive) est élevée, renforçant la probabilité du diagnostic d'appendicite aigüe.",
    imageUrl:
      "https://images.unsplash.com/photo-1579154204601-01588f351e67?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 12,
    type: "IMAGE_SLIDE",
    title: "Imagerie - Échographie Abdominale",
    subtitle: "Examen de première intention",
    content:
      "L'échographie objective un appendice non compressible, borgne, dont le diamètre externe dépasse 6 mm, associé à une infiltration de la graisse péri-appendiculaire (signes écho-géniques de l'inflammation).",
    imageUrl:
      "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 13,
    type: "IMAGE_SLIDE",
    title: "Imagerie - Tomodensitométrie (TDM)",
    subtitle: "Le Gold Standard diagnostique",
    content:
      "Le Scanner abdominal avec injection de produit de contraste est l'examen le plus sensible et spécifique. Il confirme l'épaississement pariétal, l'obstruction, et précise l'état du péritoine environnant.",
    imageUrl:
      "https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 14,
    type: "IMAGE_SLIDE",
    title: "Traitement - Appendicectomie",
    subtitle: "Prise en charge chirurgicale",
    content:
      "Le traitement curatif de référence est l'appendicectomie, réalisée le plus souvent par voie coelioscopique (mini-invasive), permettant une récupération rapide, moins de douleurs post-opératoires et un meilleur préjudice esthétique.",
    imageUrl:
      "https://images.unsplash.com/photo-1551076805-e1869033e561?auto=format&fit=crop&w=1920&q=80",
  },
  {
    id: 15,
    type: "IMAGE_SLIDE",
    title: "Suites Opératoires & Antibiothérapie",
    subtitle: "Prévention et convalescence",
    content:
      "Une antibiothérapie prophylactique est administrée en per-opératoire. En cas d'appendicite compliquée (perforée ou abcédée), une antibiothérapie curative post-opératoire est prolongée. La sortie est généralement autorisée à J1-J2.",
    imageUrl:
      "https://images.unsplash.com/photo-1585435557343-3b092031a831?auto=format&fit=crop&w=1920&q=80",
  },
];
