/**
 * Atlas Zoom — the 12 zoomable anatomy atlases.
 *
 * Each atlas lives in public/atlas-zoom/<slug>/ :
 *   atlas.txt    the atlas page, fetched by AtlasViewer and run in an <iframe srcdoc>
 *                (.txt so the Supabase middleware never runs for it — see middleware.ts matcher)
 *   index.html   the same page, opened on its own when the embedded view is unavailable
 *   *.webp       its plates and their thumbnails, loaded on demand by the atlas itself
 * Shared fonts and the board texture sit in public/atlas-zoom/_shared/, the hub's
 * medallion art in public/atlas-zoom/_hub/.
 */

export type AtlasCategory = "thorax" | "digestif" | "genital";

export interface AtlasEntry {
  slug: string;
  /** Position in the collection, shown as "01".."12". */
  number: number;
  name: string;
  /** Compact name for the organ switcher. */
  short: string;
  tagline: string;
  /** Ring colour of the medallion. */
  category: AtlasCategory;
  /** Filter pills the atlas answers to. */
  categories: AtlasCategory[];
  /** Micro-badges: the scales the atlas travels through. */
  stages: string[];
  scale: string;
  pins: number;
  /** First plate the atlas shows — warmed in the HTTP cache when a medallion is hovered. */
  firstPlate: string;
  /** [short label, full title] of every plate, in order. Searchable; a hit opens the atlas on that plate. */
  plates: readonly (readonly [string, string])[];
  /** Extra search terms (synonyms, eponyms, adjectives). */
  keywords: string;
  /** Shown in the hero showcase rather than in the grid. */
  featured?: boolean;
  /** false shows a "Bientôt disponible" medallion instead of opening the viewer. */
  available: boolean;
}

const ORGAN_STAGES = ["Anatomie", "Histologie", "Cytologie"];

export const ATLASES: readonly AtlasEntry[] = [
  {
    slug: "tronc",
    number: 1,
    name: "Le Tronc",
    short: "Tronc",
    tagline: "Dissection plan par plan : de la peau aux viscères profonds.",
    category: "thorax",
    categories: ["thorax", "digestif"],
    stages: ["Peau & Histologie", "Muscles & Os", "Viscères"],
    scale: "9 plans",
    pins: 124,
    firstPlate: "p1",
    featured: true,
    available: true,
    keywords: "tronc torse paroi peau derme epiderme hypoderme glande mammaire sein muscles myologie aponevrose diaphragme dos rachis colonne squelette osteologie cotes sternum bassin thorax abdomen visceres mediastin peritoine retroperitoine pelvis dissection surface",
    plates: [
      ["Surface", "Anatomie de surface du tronc (homme et femme) : peau et repères"],
      ["Peau ×100", "Histologie de la peau du tronc, hypoderme et glande mammaire"],
      ["Muscles superficiels", "Myologie superficielle du tronc : muscles et tendons (vue antérieure)"],
      ["Plan profond", "Myologie profonde du tronc, aponévroses et diaphragme"],
      ["Dos", "Myologie du dos : muscles et tendons postérieurs du tronc"],
      ["Squelette", "Ostéologie du tronc : cage thoracique, rachis et bassin"],
      ["Thorax", "Cavité thoracique : cœur, poumons et médiastin"],
      ["Abdomen", "Cavité abdominale : appareil digestif en place"],
      ["Rétropéritoine", "Rétropéritoine et pelvis : appareils urinaire et génital"],
    ],
  },
  {
    slug: "coeur",
    number: 2,
    name: "Le Cœur",
    short: "Cœur",
    tagline: "Des cavités et des valves jusqu’au sarcomère du cardiomyocyte.",
    category: "thorax",
    categories: ["thorax"],
    stages: ORGAN_STAGES,
    scale: "×1 → ×10 000",
    pins: 78,
    firstPlate: "p1",
    available: true,
    keywords: "cardiaque cardio cardiologie myocarde endocarde epicarde pericarde valves valve mitrale tricuspide aortique coronaires ventricule oreillette atrium aorte septum tissu nodal purkinje sinusal cardiomyocyte sarcomere disque intercalaire",
    plates: [
      ["Externe", "Anatomie externe du cœur, gros vaisseaux et péricarde"],
      ["Interne", "Anatomie interne : cavités, septums et valves cardiaques"],
      ["Coronaires", "Vascularisation coronaire et tissu nodal du cœur"],
      ["Paroi", "Histologie de la paroi cardiaque : endocarde, myocarde, épicarde"],
      ["Myocarde", "Histologie du myocarde contractile et stries scalariformes"],
      ["Purkinje & valves", "Histologie du tissu nodal (Purkinje) et des valves cardiaques"],
      ["Cardiomyocyte", "Cytologie du cardiomyocyte : ultrastructure et diades"],
      ["Disque intercalaire", "Ultrastructure du disque intercalaire (strie scalariforme)"],
      ["Sarcomère", "Ultrastructure du sarcomère et canaux ioniques cardiaques"],
    ],
  },
  {
    slug: "poumons",
    number: 3,
    name: "Les Poumons",
    short: "Poumons",
    tagline: "Des lobes et du hile jusqu’à la barrière alvéolo-capillaire.",
    category: "thorax",
    categories: ["thorax"],
    stages: ORGAN_STAGES,
    scale: "×1 → ×10 000",
    pins: 107,
    firstPlate: "p1",
    available: true,
    keywords: "poumon pulmonaire respiratoire pneumologie plevre lobes scissures trachee bronches bronchioles alveoles hile segmentation pneumocyte surfactant macrophage alveolaire epithelium cilie caliciforme hematose",
    plates: [
      ["Poumons", "Anatomie externe des poumons : lobes, scissures et plèvre"],
      ["Arbre bronchique", "Arbre trachéo-bronchique et segmentation pulmonaire"],
      ["Hile & vaisseaux", "Hile pulmonaire et double vascularisation des poumons"],
      ["Trachée & bronches", "Histologie de la trachée et des bronches"],
      ["Bronchioles", "Histologie des bronchioles et du lobule pulmonaire"],
      ["Alvéoles", "Histologie des alvéoles pulmonaires et du parenchyme"],
      ["Épithélium cilié", "Cytologie de l’épithélium respiratoire : cellule ciliée et caliciforme"],
      ["Pneumocytes", "Cytologie alvéolaire : pneumocytes I et II et macrophage alvéolaire"],
      ["Barrière", "Ultrastructure de la barrière alvéolo-capillaire (échanges gazeux)"],
    ],
  },
  {
    slug: "foie",
    number: 4,
    name: "Le Foie",
    short: "Foie",
    tagline: "Segments de Couinaud, lobule hépatique et canalicule biliaire.",
    category: "digestif",
    categories: ["digestif"],
    stages: ORGAN_STAGES,
    scale: "×1 → ×10 000",
    pins: 109,
    firstPlate: "p1",
    available: true,
    keywords: "hepatique hepatologie couinaud segments pedicule veine porte voies biliaires vesicule biliaire choledoque lobule triade glisson acinus rappaport hepatocyte sinusoide disse kupffer ito canalicule bile",
    plates: [
      ["Foie", "Anatomie externe du foie : faces diaphragmatique et viscérale"],
      ["Couinaud", "Segmentation hépatique de Couinaud (8 segments) et pédicule"],
      ["Voies biliaires", "Voies biliaires intra- et extra-hépatiques et vésicule biliaire"],
      ["Lobule", "Histologie du lobule hépatique classique (hexagone)"],
      ["Triade & acinus", "Espace porte (triade de Glisson) et acinus de Rappaport"],
      ["Vésicule", "Histologie de la vésicule biliaire"],
      ["Hépatocyte", "Cytologie de l’hépatocyte : ultrastructure et polarité"],
      ["Sinusoïde & Disse", "Ultrastructure du sinusoïde hépatique et de l’espace de Disse"],
      ["Canalicule", "Ultrastructure du canalicule biliaire et sécrétion de la bile"],
    ],
  },
  {
    slug: "estomac",
    number: 5,
    name: "L’Estomac",
    short: "Estomac",
    tagline: "Vascularisation, glandes fundiques et cellule pariétale.",
    category: "digestif",
    categories: ["digestif"],
    stages: ORGAN_STAGES,
    scale: "×1 → ×7 200",
    pins: 37,
    firstPlate: "ext",
    available: true,
    keywords: "gastrique gastro fundus antre pylore cardia petite grande courbure omentum epiploon tronc coeliaque nerf vague plexus glandes fundiques cellule parietale principale hcl acide chlorhydrique pepsine facteur intrinseque",
    plates: [
      ["Externe", "Anatomie externe & vascularisation"],
      ["Interne", "Coupe frontale & anatomie interne"],
      ["Nerfs", "Innervation : nerfs vagues & plexus cœliaque"],
      ["Histologie", "Histologie de la paroi & glandes fundiques"],
      ["Cellule", "Cellule pariétale & sécrétion d’HCl"],
    ],
  },
  {
    slug: "pancreas",
    number: 6,
    name: "Le Pancréas",
    short: "Pancréas",
    tagline: "Acinus exocrine, îlots de Langerhans et cellule bêta.",
    category: "digestif",
    categories: ["digestif"],
    stages: ORGAN_STAGES,
    scale: "×1 → ×10 000",
    pins: 102,
    firstPlate: "p1",
    available: true,
    keywords: "pancreatique wirsung santorini ampoule vater oddi duodenum exocrine endocrine acinus acineuse zymogene ilots langerhans insuline glucagon cellule beta alpha bicarbonate canalaire",
    plates: [
      ["Pancréas", "Anatomie externe du pancréas et rapports duodénaux"],
      ["Canaux", "Canaux pancréatiques et jonction hépato-pancréatique"],
      ["Vascularisation", "Vascularisation artérielle et veineuse du pancréas"],
      ["Exocrine", "Histologie du pancréas exocrine : acinus et système canalaire"],
      ["Îlots", "Histologie du pancréas endocrine : îlots de Langerhans"],
      ["Canaux (histo)", "Histologie des canaux pancréatiques et sécrétion hydro-bicarbonatée"],
      ["Cellule acineuse", "Cytologie de la cellule acineuse pancréatique (zymogène)"],
      ["Cellule bêta", "Cytologie de la cellule bêta et sécrétion d’insuline"],
      ["Cellule canalaire", "Cytologie de la cellule canalaire pancréatique et sécrétion de HCO₃⁻"],
    ],
  },
  {
    slug: "rate",
    number: 7,
    name: "La Rate",
    short: "Rate",
    tagline: "Pulpes blanche et rouge, sinus veineux et macrophages.",
    category: "digestif",
    categories: ["digestif"],
    stages: ORGAN_STAGES,
    scale: "×1 → ×10 000",
    pins: 99,
    firstPlate: "p1",
    available: true,
    keywords: "splenique splenologie hile ligaments pulpe blanche rouge pals follicule zone marginale cordons billroth sinus veineux macrophage erythrophagocytose lymphoide immunite",
    plates: [
      ["Rate", "Anatomie externe de la rate : faces diaphragmatique et viscérale"],
      ["Hile & ligaments", "Hile splénique, pédicule et ligaments péritonéaux"],
      ["Vascularisation", "Vascularisation segmentaire et circulation splénique"],
      ["Pulpes", "Histologie générale de la rate : pulpe blanche et pulpe rouge"],
      ["Pulpe blanche", "Histologie de la pulpe blanche : PALS, follicule et zone marginale"],
      ["Pulpe rouge", "Histologie de la pulpe rouge : cordons de Billroth et sinus veineux"],
      ["Sinus veineux", "Ultrastructure du sinus veineux splénique (filtration des hématies)"],
      ["Macrophage", "Cytologie du macrophage splénique et érythrophagocytose"],
      ["Zone marginale", "Cytologie de la zone marginale et réponse immunitaire splénique"],
    ],
  },
  {
    slug: "intestin-grele",
    number: 8,
    name: "L’Intestin Grêle",
    short: "Intestin grêle",
    tagline: "Villosités, cryptes et entérocyte en pleine absorption.",
    category: "digestif",
    categories: ["digestif"],
    stages: ORGAN_STAGES,
    scale: "×1 → ×10 000",
    pins: 101,
    firstPlate: "p1",
    available: true,
    keywords: "intestin grele intestinal duodenum jejunum ileon mesentere valvules conniventes ams mesenterique villosite cryptes lieberkuhn brunner peyer enterocyte plateau strie microvillosites caliciforme paneth enteroendocrine cellule m absorption",
    plates: [
      ["Intestin grêle", "Anatomie externe de l’intestin grêle : duodénum, jéjunum et iléon"],
      ["Jéjunum / iléon", "Anatomie interne : valvules conniventes et différences jéjunum / iléon"],
      ["AMS & veine porte", "Vascularisation et innervation de l’intestin grêle (AMS et veine porte)"],
      ["Quatre tuniques", "Histologie générale de la paroi intestinale : les quatre tuniques"],
      ["Villosité", "Histologie de la villosité intestinale et des cryptes de Lieberkühn"],
      ["Brunner & Peyer", "Histologie régionale : glandes de Brunner (duodénum) et plaques de Peyer (iléon)"],
      ["Entérocyte", "Cytologie de l’entérocyte : plateau strié et complexes jonctionnels"],
      ["Cellules spécialisées", "Cytologie des cellules spécialisées : caliciforme, Paneth, entéroendocrine et M"],
      ["Absorption", "Ultrastructure de l’absorption intestinale : glucides, protides et lipides"],
    ],
  },
  {
    slug: "oesophage",
    number: 9,
    name: "L’Œsophage",
    short: "Œsophage",
    tagline: "Quatre tuniques, ligne Z et barrière anti-reflux.",
    category: "digestif",
    categories: ["thorax", "digestif"],
    stages: ORGAN_STAGES,
    scale: "×1 → ×10 000",
    pins: 98,
    firstPlate: "p1",
    available: true,
    keywords: "oesophagien oesophage sphincter ligne z cardia jonction oeso gastrique retrecissements killian anastomose porto cave varices tuniques musculeuse epithelium malpighien keratinocyte desmosomes auerbach peristaltisme reflux rgo barrett",
    plates: [
      ["Œsophage", "Anatomie externe de l’œsophage : portions et rétrécissements"],
      ["Sphincters & ligne Z", "Anatomie interne : sphincters et jonction œso-gastrique (ligne Z)"],
      ["Vaisseaux & nerfs", "Vascularisation, anastomose porto-cave et innervation de l’œsophage"],
      ["Quatre tuniques", "Histologie générale de la paroi œsophagienne : les quatre tuniques"],
      ["Glandes & musculeuse", "Glandes œsophagiennes et transition musculaire (strié → lisse)"],
      ["Jonction œso-gastrique", "Histologie de la jonction œso-gastrique (transition de la ligne Z)"],
      ["Épithélium malpighien", "Cytologie de l’épithélium malpighien œsophagien : kératinocyte et desmosomes"],
      ["Muscle lisse", "Cytologie du muscle lisse œsophagien et plexus d’Auerbach (péristaltisme)"],
      ["Barrière anti-reflux", "Ultrastructure de la barrière muqueuse œsophagienne (défense anti-reflux)"],
    ],
  },
  {
    slug: "cavite-orale",
    number: 10,
    name: "La Cavité Orale",
    short: "Cavité orale",
    tagline: "Langue, dent et parodonte, jusqu’au bourgeon du goût.",
    category: "digestif",
    categories: ["digestif"],
    stages: ORGAN_STAGES,
    scale: "×1 → ×10 000",
    pins: 114,
    firstPlate: "p1",
    available: true,
    keywords: "bouche buccale orale palais luette isthme gosier plancher langue linguale dent dentaire arcade parodonte gencive email dentine odontoblaste glandes salivaires parotide submandibulaire sublinguale papilles bourgeon gout gustatif",
    plates: [
      ["Cavité orale", "Anatomie de la cavité orale : palais, isthme du gosier et plancher buccal"],
      ["Langue & dent", "Anatomie de la langue et de l’arcade dentaire"],
      ["Glandes & nerfs", "Glandes salivaires principales, vascularisation et innervation"],
      ["Muqueuse & papilles", "Histologie de la muqueuse buccale et des papilles linguales"],
      ["Dent & parodonte", "Histologie de la dent et du parodonte"],
      ["Glandes (histo)", "Histologie des glandes salivaires : acini et canaux striés"],
      ["Bourgeon du goût", "Cytologie du bourgeon du goût et transduction gustative"],
      ["Odontoblaste", "Cytologie de l’odontoblaste et formation de la dentine"],
      ["Acinus & canal strié", "Cytologie de la cellule acineuse salivaire et du canal strié"],
    ],
  },
  {
    slug: "genital-masculin",
    number: 11,
    name: "Appareil Génital Masculin",
    short: "Génital masculin",
    tagline: "Du tube séminifère au spermatozoïde, Sertoli et Leydig.",
    category: "genital",
    categories: ["genital"],
    stages: ORGAN_STAGES,
    scale: "×1 → ×10 000",
    pins: 119,
    firstPlate: "p1",
    available: true,
    keywords: "masculin homme genital reproduction andrologie urologie testicule epididyme cordon spermatique canal deferent vesicule seminale prostate penis corps caverneux spongieux erection tube seminifere spermatogenese sertoli leydig testosterone barriere hemato testiculaire spermatozoide",
    plates: [
      ["Coupe sagittale", "Anatomie de l’appareil génital masculin (coupe sagittale)"],
      ["Testicule & cordon", "Anatomie du testicule, de l’épididyme et du cordon spermatique"],
      ["Pénis & prostate", "Anatomie du pénis (corps érectiles), prostate et vascularisation"],
      ["Tube séminifère", "Histologie du testicule : tube séminifère et tissu interstitiel"],
      ["Épididyme & déférent", "Histologie de l’épididyme et du canal déférent"],
      ["Prostate & érectile", "Histologie de la prostate et du tissu érectile (corps caverneux)"],
      ["Sertoli & BHT", "Cytologie de la cellule de Sertoli et barrière hémato-testiculaire"],
      ["Leydig", "Cytologie de la cellule de Leydig et stéroïdogenèse (testostérone)"],
      ["Spermatozoïde", "Ultrastructure du spermatozoïde mature (tête, pièce intermédiaire et flagelle)"],
    ],
  },
  {
    slug: "genital-feminin",
    number: 12,
    name: "Appareil Génital Féminin",
    short: "Génital féminin",
    tagline: "Ovaire, endomètre et ovocyte II, de l’organe à la cellule.",
    category: "genital",
    categories: ["genital"],
    stages: ORGAN_STAGES,
    scale: "×1 → ×10 000",
    pins: 117,
    firstPlate: "p1",
    available: true,
    keywords: "feminin femme genital reproduction gynecologie obstetrique uterus utero col trompe fallope ovaire ovarien vagin vulve ligaments folliculogenese follicule corps jaune endometre myometre cycle menstruel ovocyte zone pellucide luteale progesterone cils pinopodes",
    plates: [
      ["Coupe sagittale", "Anatomie de l’appareil génital féminin (coupe sagittale)"],
      ["Coupe frontale", "Utérus, trompes de Fallope, ovaires et ligaments (coupe frontale)"],
      ["Vulve & vaisseaux", "Anatomie de la vulve (organes externes) et vascularisation pelvienne"],
      ["Ovaire", "Histologie de l’ovaire : folliculogenèse et corps jaune"],
      ["Endomètre", "Histologie de l’utérus : endomètre (cycle) et myomètre"],
      ["Col & trompe", "Histologie du col utérin (zone de jonction) et de la trompe de Fallope"],
      ["Ovocyte II", "Cytologie de l’ovocyte II mature et de la zone pellucide"],
      ["Cellule lutéale", "Cytologie de la cellule lutéale (corps jaune) et stéroïdogenèse"],
      ["Cils & pinopodes", "Cytologie de l’épithélium tubaire et endométrial (cils et pinopodes)"],
    ],
  },
];

export const FEATURED_ATLAS: AtlasEntry = ATLASES.find((atlas) => atlas.featured) ?? ATLASES[0];

export const ATLAS_TOTALS = {
  atlases: ATLASES.length,
  plates: ATLASES.reduce((sum, atlas) => sum + atlas.plates.length, 0),
  pins: ATLASES.reduce((sum, atlas) => sum + atlas.pins, 0),
};

export function getAtlas(slug: string | null | undefined): AtlasEntry | undefined {
  return slug ? ATLASES.find((atlas) => atlas.slug === slug) : undefined;
}

export const atlasMedallion = (slug: string) => `/atlas-zoom/_hub/${slug === "tronc" ? "tronc-1" : slug}.webp`;
export const atlasDocument = (slug: string) => `/atlas-zoom/${slug}/atlas.txt`;
export const atlasStandalonePage = (slug: string, plate?: number | null) =>
  `/atlas-zoom/${slug}/index.html${plate != null && plate >= 0 ? `?planche=${plate + 1}` : ""}`;
export const atlasFirstPlate = (atlas: AtlasEntry) => `/atlas-zoom/${atlas.slug}/${atlas.firstPlate}.webp`;

/* ───────────── search ───────────── */

/** Lower-case, accents and ligatures flattened: "Cœur" / "coeur", "Pancréas" / "pancreas" all match. */
export function normalizeQuery(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[’‘`´]/g, "'");
}

interface SearchIndex {
  /** The organ's own name: words found here only pick the atlas. */
  name: string;
  /** Everything searchable about the atlas. */
  all: string;
  plates: string[];
}

const searchIndex = new Map<string, SearchIndex>();

function indexOf(atlas: AtlasEntry): SearchIndex {
  let index = searchIndex.get(atlas.slug);
  if (!index) {
    const plates = atlas.plates.map(([short, title]) => normalizeQuery(`${short} ${title}`));
    index = {
      name: normalizeQuery(`${atlas.name} ${atlas.short}`),
      all: normalizeQuery([atlas.name, atlas.short, atlas.tagline, atlas.keywords, ...atlas.stages, ...plates].join(" ")),
      plates,
    };
    searchIndex.set(atlas.slug, index);
  }
  return index;
}

const STOP_WORDS = new Set(["l'", "le", "la", "les", "de", "du", "des", "d'", "et", "a", "au", "aux", "en", "un", "une"]);

export interface AtlasMatch {
  atlas: AtlasEntry;
  /** 0-based plate the query points at, or null to open the atlas at its start. */
  plate: number | null;
}

/**
 * Instant search: every word must appear somewhere in the atlas (name, keywords, plate titles;
 * accents and partial words welcome). Words that are not the organ's own name then point at
 * the first plate containing them all, which the result opens on:
 * "langerhans" → Le Pancréas, plate 5 · "histologie" → each organ at its first histology plate.
 */
export function searchAtlases(atlases: readonly AtlasEntry[], query: string): AtlasMatch[] {
  const words = normalizeQuery(query)
    .split(/[\s,;:/]+/)
    .map((word) => word.replace(/^(l|d)'/, ""))
    .filter((word) => word && !STOP_WORDS.has(word));
  if (words.length === 0) return atlases.map((atlas) => ({ atlas, plate: null }));
  const matches: AtlasMatch[] = [];
  for (const atlas of atlases) {
    const index = indexOf(atlas);
    if (!words.every((word) => index.all.includes(word))) continue;
    const content = words.filter((word) => !index.name.includes(word));
    const plate = content.length ? index.plates.findIndex((text) => content.every((word) => text.includes(word))) : -1;
    matches.push({ atlas, plate: plate > 0 ? plate : null });
  }
  return matches;
}
