/**
 * Is this picture about what the reply asked for? Shared by every repository
 * the Copilot's image engine searches (lib/medical-image-engine.ts). A wrong
 * medical picture is worse than none, so a candidate must have (see
 * relevance() for the exact rule):
 *  - every QUALIFIER of the query (left/right, normal, acute/chronic,
 *    anterior/posterior…) in its own name — a right bundle branch block never
 *    illustrates a left one;
 *  - one of its MODALITIES when it names one (ECG, X-ray, CT, MRI,
 *    ultrasound, histology…) — an anatomy drawing never stands in for a trace;
 *  - its other key words, mostly in its own name — "respiratory failure"
 *    whose description mentions the heart is not "heart failure".
 * Words are compared through synonyms (hepatic = liver, electrocardiogram =
 * ECG, radiographie = X-ray…) and inflections (nephron/nephrons,
 * histology/histological), in English and French.
 */

const STOPWORDS = new Set([
  // English
  "the", "of", "and", "or", "in", "on", "at", "to", "for", "with", "from", "by", "an", "as", "is", "are", "its", "this", "that", "into", "showing", "shows", "show", "view", "views", "human",
  "after", "before", "during", "between", "within", "without", "via", "using", "used", "one", "two", "three", "four", "five", "six",
  "deux", "trois", "quatre", "cinq", "selon", "ainsi",
  // French
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "ou", "en", "au", "aux", "dans", "sur", "par", "pour", "avec", "sans", "qui", "que", "son", "sa", "ses", "ce", "cette", "chez", "montrant", "vue", "humain", "humaine",
  "lors", "apres", "avant", "entre",
]);

/** Kinds of picture, sources and case-report boilerplate: they neither count toward a match nor are required. */
const GENERIC = new Set([
  "diagram", "diagrams", "schema", "schemas", "scheme", "schematic", "illustration", "illustrations", "image", "images", "picture", "figure", "fig", "photo", "photograph", "drawing",
  "labeled", "labelled", "label", "labels", "unlabeled", "unlabelled", "legende", "svg", "png", "jpg", "jpeg", "gif", "file", "simple", "simplified", "version", "vector", "english", "french",
  "cropped", "crop", "edited", "detail", "detailed", "overview", "anatomy", "anatomie", "medical", "medicale", "representation", "representations", "coupe", "planche",
  "waveform", "waveforms", "trace", "tracing", "tracings", "strip", "recording", "graph", "chart", "curve", "plot", "pattern", "panel", "panels", "case", "patient", "patients", "year", "old",
  "diagramme", "legendee", "schematique", "photographie", "aspect", "type",
  "blausen", "gray", "grays", "openstax", "servier", "bioart", "nih", "lynch", "wikimedia", "wikipedia", "commons",
]);

/** Synonyms and translations, folded to one form before anything is compared. */
const CANONICAL = new Map<string, string>([
  // Modalities
  ["ekg", "ecg"], ["ecgs", "ecg"], ["electrocardiogram", "ecg"], ["electrocardiograms", "ecg"], ["electrocardiography", "ecg"], ["electrocardiographic", "ecg"], ["electrocardiogramme", "ecg"],
  ["xray", "xray"], ["xrays", "xray"], ["radiograph", "xray"], ["radiographs", "xray"], ["radiography", "xray"], ["radiographic", "xray"], ["roentgenogram", "xray"], ["radiographie", "xray"],
  ["tomography", "ct"], ["tomographic", "ct"], ["scanner", "ct"], ["tomodensitometrie", "ct"],
  ["irm", "mri"], ["resonance", "mri"],
  ["ultrasonography", "ultrasound"], ["sonography", "ultrasound"], ["sonographic", "ultrasound"], ["sonogram", "ultrasound"], ["echography", "ultrasound"], ["echographie", "ultrasound"], ["ultrasonographic", "ultrasound"],
  ["echocardiogram", "echocardiography"], ["echocardiographic", "echocardiography"], ["echocardiographie", "echocardiography"],
  ["angiogram", "angiography"], ["angiographic", "angiography"], ["angiographie", "angiography"], ["arteriography", "angiography"],
  ["endoscopic", "endoscopy"], ["endoscopie", "endoscopy"], ["colonoscopy", "endoscopy"], ["gastroscopy", "endoscopy"],
  ["micrograph", "histology"], ["micrographs", "histology"], ["photomicrograph", "histology"], ["microscopy", "histology"], ["microscopic", "histology"], ["histological", "histology"],
  ["histologic", "histology"], ["histopathology", "histology"], ["histopathological", "histology"], ["histologie", "histology"], ["histologique", "histology"], ["microscopie", "histology"],
  // Organs (adjective = noun, French = English)
  ["hepatic", "liver"], ["hepatique", "liver"], ["foie", "liver"],
  ["renal", "kidney"], ["kidneys", "kidney"], ["rein", "kidney"], ["reins", "kidney"], ["renale", "kidney"],
  ["cardiac", "heart"], ["cardiaque", "heart"], ["coeur", "heart"], ["hearts", "heart"],
  ["pulmonary", "lung"], ["lungs", "lung"], ["poumon", "lung"], ["poumons", "lung"], ["pulmonaire", "lung"],
  ["gastric", "stomach"], ["estomac", "stomach"],
  ["cerebral", "brain"], ["cerveau", "brain"], ["cerebrale", "brain"],
  ["cutaneous", "skin"], ["peau", "skin"],
  ["ocular", "eye"], ["eyes", "eye"], ["oeil", "eye"],
  ["neuronal", "neuron"], ["neurons", "neuron"], ["neurone", "neuron"], ["neurones", "neuron"],
  // Qualifiers (French = English)
  ["gauche", "left"], ["droit", "right"], ["droite", "right"], ["normale", "normal"], ["normaux", "normal"], ["normales", "normal"],
  ["anterieur", "anterior"], ["anterieure", "anterior"], ["posterieur", "posterior"], ["posterieure", "posterior"],
  ["aigu", "acute"], ["aigue", "acute"], ["chronique", "chronic"], ["superieur", "superior"], ["inferieur", "inferior"],
  ["superieure", "superior"], ["inferieure", "inferior"], ["anormal", "abnormal"], ["anormale", "abnormal"], ["laterale", "lateral"],
  ["proximale", "proximal"], ["distale", "distal"], ["benin", "benign"], ["benigne", "benign"], ["maligne", "malignant"], ["malin", "malignant"],
  ["foetal", "fetal"], ["foetale", "fetal"],
  // Medical French = English (accents removed): a French caption or file name finds the English-titled picture.
  ...([
    ["systeme", "system"], ["nerveux", "nervous"], ["nerveuse", "nervous"], ["nerf", "nerve"], ["nerfs", "nerve"], ["noeud", "node"], ["sinusal", "sinus"], ["sinusale", "sinus"],
    ["auriculoventriculaire", "atrioventricular"], ["faisceau", "bundle"], ["branche", "branch"], ["branches", "branch"], ["bloc", "block"], ["tissu", "tissue"],
    ["onde", "wave"], ["ondes", "wave"], ["complexe", "complex"], ["intervalle", "interval"], ["derivation", "lead"], ["derivations", "lead"],
    // ECG electrodes are "leads" in the pictures' English titles ("Precordial leads").
    ["precordiale", "precordial"], ["precordiales", "precordial"], ["peripherique", "peripheral"], ["peripheriques", "peripheral"],
    ["electrode", "lead"], ["electrodes", "lead"], ["leads", "lead"],
    ["cavite", "chamber"], ["cavites", "chamber"], ["oreillette", "atrium"], ["oreillettes", "atrium"], ["ventricule", "ventricle"], ["ventricules", "ventricle"],
    ["ventriculaire", "ventricular"], ["auriculaire", "atrial"], ["valvule", "valve"], ["valvules", "valve"], ["valves", "valve"], ["mitrale", "mitral"],
    ["tricuspide", "tricuspid"], ["aortique", "aortic"], ["aorte", "aorta"], ["artere", "artery"], ["arteres", "artery"], ["arteriel", "arterial"], ["arterielle", "arterial"],
    ["coronaire", "coronary"], ["coronaires", "coronary"], ["veine", "vein"], ["veines", "vein"], ["veineux", "venous"], ["veineuse", "venous"], ["capillaire", "capillary"],
    ["capillaires", "capillary"], ["vaisseau", "vessel"], ["vaisseaux", "vessel"], ["sang", "blood"], ["sanguin", "blood"], ["sanguine", "blood"], ["globule", "cell"],
    ["globules", "cell"], ["rouge", "red"], ["rouges", "red"], ["blanc", "white"], ["blancs", "white"], ["plaquette", "platelet"], ["plaquettes", "platelet"],
    ["hematie", "erythrocyte"], ["hematies", "erythrocyte"], ["cellule", "cell"], ["cellules", "cell"], ["cellulaire", "cell"], ["noyau", "nucleus"],
    ["mitochondrie", "mitochondria"], ["proteine", "protein"], ["proteines", "protein"], ["recepteur", "receptor"], ["recepteurs", "receptor"], ["canal", "channel"],
    ["canaux", "channel"], ["pompe", "pump"], ["potentiel", "potential"], ["repos", "resting"], ["depolarisation", "depolarization"], ["repolarisation", "repolarization"],
    ["musculaire", "muscle"], ["muscles", "muscle"], ["squelettique", "skeletal"], ["lisse", "smooth"], ["strie", "striated"], ["osseux", "bone"], ["osseuse", "bone"],
    ["articulation", "joint"], ["vertebre", "vertebra"], ["vertebres", "vertebra"], ["vertebrale", "vertebral"], ["crane", "skull"], ["bassin", "pelvis"],
    ["derme", "dermis"], ["epiderme", "epidermis"], ["bronche", "bronchus"], ["bronches", "bronchus"], ["bronchique", "bronchial"], ["alveole", "alveolus"],
    ["alveoles", "alveolus"], ["alveolaire", "alveolar"], ["plevre", "pleura"], ["pleurale", "pleural"], ["trachee", "trachea"], ["thoracique", "chest"],
    ["diaphragme", "diaphragm"], ["respiratoire", "respiratory"], ["oesophage", "esophagus"], ["gastrique", "stomach"], ["intestin", "intestine"],
    ["intestins", "intestine"], ["intestinal", "intestine"], ["intestinale", "intestine"], ["biliaire", "biliary"], ["pancreatique", "pancreatic"],
    ["digestif", "digestive"], ["glomerule", "glomerulus"], ["glomerules", "glomerulus"], ["glomerulaire", "glomerular"], ["tubule", "tubule"],
    ["tubulaire", "tubular"], ["urinaire", "urinary"], ["vessie", "bladder"], ["uretere", "ureter"], ["uretre", "urethra"], ["cervelet", "cerebellum"],
    ["encephale", "brain"], ["epiniere", "spinal"], ["axone", "axon"], ["myeline", "myelin"], ["hypophyse", "pituitary"], ["thyroide", "thyroid"],
    ["surrenale", "adrenal"], ["surrenales", "adrenal"], ["insuline", "insulin"], ["yeux", "eye"], ["retine", "retina"], ["cornee", "cornea"], ["oreille", "ear"],
    ["cochlee", "cochlea"], ["ovaire", "ovary"], ["ovaires", "ovary"], ["foetus", "fetus"], ["embryon", "embryo"], ["sein", "breast"], ["testicule", "testis"],
    ["insuffisance", "failure"], ["infarctus", "infarction"], ["ischemie", "ischemia"], ["necrose", "necrosis"], ["tumeur", "tumor"], ["tumeurs", "tumor"],
    ["metastase", "metastasis"], ["metastases", "metastasis"], ["hemorragie", "hemorrhage"], ["thrombose", "thrombosis"], ["embolie", "embolism"],
    ["anevrisme", "aneurysm"], ["stenose", "stenosis"], ["hypertrophie", "hypertrophy"], ["tachycardie", "tachycardia"], ["bradycardie", "bradycardia"],
    ["arythmie", "arrhythmia"], ["pneumonie", "pneumonia"], ["asthme", "asthma"], ["diabete", "diabetes"], ["cirrhose", "cirrhosis"], ["hepatite", "hepatitis"],
    ["anemie", "anemia"], ["leucemie", "leukemia"], ["atherosclerose", "atherosclerosis"], ["oedeme", "edema"], ["epanchement", "effusion"], ["ulcere", "ulcer"],
    ["carcinome", "carcinoma"], ["lymphome", "lymphoma"], ["pression", "pressure"], ["mecanisme", "mechanism"], ["physiologie", "physiology"],
    ["frontale", "frontal"], ["sagittale", "sagittal"], ["transversale", "transverse"], ["axiale", "axial"],
    // Picture words, in English for the search (relevance ignores them, see GENERIC).
    ["diagramme", "diagram"], ["schema", "diagram"], ["schemas", "diagram"], ["schematique", "diagram"], ["photographie", "photo"],
    // English plurals and nouns, folded to one form (and so recognised in a caption).
    ["nephron", "nephron"], ["nephrons", "nephron"], ["hepatocyte", "hepatocyte"], ["hepatocytes", "hepatocyte"], ["sarcomere", "sarcomere"],
    ["synapse", "synapse"], ["synapses", "synapse"], ["alveoli", "alveolus"], ["villi", "villus"], ["villosite", "villus"], ["villosites", "villus"],
    ["glomeruli", "glomerulus"], ["bronchi", "bronchus"], ["ventricles", "ventricle"], ["atria", "atrium"], ["arteries", "artery"], ["veins", "vein"],
    ["cells", "cell"], ["bones", "bone"], ["nerves", "nerve"], ["vessels", "vessel"], ["sinus", "sinus"], ["node", "node"], ["nodes", "node"],
  ] as [string, string][]),
]);

/** What a picture is: a trace, a radiograph, a slide… */
const MODALITIES = new Set(["ecg", "xray", "ct", "mri", "ultrasound", "echocardiography", "angiography", "endoscopy", "histology"]);

/** Organs: the subject of most medical pictures. One a short query names must be in the picture's own name; its other word can be in the description ("heart chamber" → "Heart numlabels", whose description names the chambers). */
const ORGANS = new Set([
  "heart", "liver", "kidney", "lung", "brain", "stomach", "skin", "eye", "ear", "intestine", "colon", "esophagus", "pancreas", "spleen", "thyroid",
  "bladder", "uterus", "ovary", "testis", "prostate", "breast", "placenta", "bone", "muscle", "nerve", "artery", "vein", "aorta", "trachea",
  "bronchus", "larynx", "pharynx", "cerebellum", "spinal", "retina", "cornea", "skull", "pelvis", "vertebra", "joint", "blood",
]);

/** Words that flip the meaning when they differ: a picture must have every one the query has. */
const QUALIFIERS = new Set([
  "left", "right", "normal", "abnormal", "anterior", "posterior", "superior", "inferior", "medial", "lateral", "proximal", "distal",
  "acute", "chronic", "upper", "lower", "benign", "malignant", "fetal", "neonatal", "pediatric", "adult", "male", "female",
]);

/** A text's plain words: camelCase and digits split, accents and case removed, ligatures spelled out ("cœur" → "coeur": NFD leaves "œ" whole, and "cœur" became "ur"). */
function plainWords(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae");
}

/**
 * Folded words of a text, for comparing: plain words, "x-ray" (also "X- ray",
 * "x ray") kept whole, a view phrase left out ("coupe frontale", "sagittal
 * section": how the picture is cut, not what it shows — "frontal" alone, as in
 * "frontal lobe", stays), synonyms and translations folded to one form.
 */
export function foldedWords(text: string): string[] {
  return plainWords(text)
    .replace(/\b(?:coupes?|vues?|plans?)\s+(?:frontales?|sagittales?|transversales?|axiales?|coronales?)\b/g, " ")
    .replace(/\b(?:frontal|sagittal|transverse|axial|coronal)\s+(?:sections?|views?|planes?|cuts?)\b/g, " ")
    .replace(/\bx\s*-?\s*rays?\b/g, "xray")
    .replace(/\bmagnetic\s+resonance(?:\s+imaging)?\b/g, "mri")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2)
    .map((word) => CANONICAL.get(word) ?? word);
}

/** The words a picture's text must answer: no stopwords, no generic picture words, no bare numbers. */
export function keyWords(text: string): string[] {
  return Array.from(new Set(foldedWords(text).filter((word) => !STOPWORDS.has(word) && !GENERIC.has(word) && !/^\d+$/.test(word))));
}

/**
 * The words worth sending to an English-language repository's search (Commons
 * in English, Open-i, Wellcome): the text's words folded to English — a
 * French caption ("Coupe du cœur gauche") asks for "heart left" — letters and
 * digits only, stopwords and picture words out, each once, at most 12. "xray"
 * goes out as "x-ray": written as one word it finds nothing in either Commons
 * or Open-i (checked live).
 */
export function searchWords(text: string): string {
  // Of the picture words, only those that steer a search toward illustrations stay ("heart failure diagram" finds drawings,
  // "heart failure" finds charts); the rest ("trace", "strip"…) only blur it. Relevance ignores them all.
  return Array.from(new Set(foldedWords(text).filter((word) => !STOPWORDS.has(word) && (!GENERIC.has(word) || SEARCH_STEERS.has(word)))))
    .slice(0, 12)
    .map((word) => (word === "xray" ? "x-ray" : word))
    .join(" ");
}

/** Picture words worth keeping in a search query. */
const SEARCH_STEERS = new Set(["diagram", "diagrams", "schematic", "illustration", "illustrations", "drawing", "anatomy", "labeled", "labelled"]);

/** The words of a French caption as written (accents off), for Commons' own French descriptions. */
export function frenchSearchWords(text: string): string {
  return plainWords(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word))
    .slice(0, 12)
    .join(" ");
}

/** Every word this file understands: the folded forms, their French and English variants, the modalities and qualifiers. */
const RECOGNIZED = new Set<string>([...Array.from(CANONICAL.keys()), ...Array.from(CANONICAL.values()), ...Array.from(MODALITIES), ...Array.from(QUALIFIERS)]);

/**
 * Does a picture agree with the caption the reply gave it? Judged only when
 * the caption names at least `minimumUnderstood` things this file
 * understands (an organ, a structure, a modality, a qualifier…): then the
 * picture must have one of those words. A searched picture is judged on one
 * (another candidate can take its place); the exact file the model named
 * only on two — its description may be terse, so it takes a clear mismatch
 * (an example copied into another answer) to set it aside.
 */
export function captionAgrees(caption: string, candidate: CandidateText, minimumUnderstood = 1): boolean {
  const understood = Array.from(
    new Set(
      plainWords(caption)
        .split(/[^a-z0-9]+/)
        .filter((word) => RECOGNIZED.has(word) && !GENERIC.has(word))
        .map((word) => CANONICAL.get(word) ?? word)
    )
  );
  if (understood.length < Math.max(1, minimumUnderstood)) return true;
  const have = foldedWords(`${candidate.primary} ${candidate.full}`);
  return understood.some((word) => have.some((candidateWord) => sameWord(word, candidateWord)));
}

/** Same word, or one inflection of it ("lead"/"leads", "nephron"/"nephrons", "histology"/"histological"). */
function sameWord(a: string, b: string): boolean {
  if (a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 5) return false;
  let prefix = 0;
  while (prefix < shorter && a[prefix] === b[prefix]) prefix += 1;
  return prefix >= Math.max(5, shorter - 2);
}

/** What a repository says about a picture: its own name (a title, a caption's first sentence) and everything else. */
export interface CandidateText {
  /** The picture's own title, or its caption's first sentence: what the picture IS. */
  primary: string;
  /** All of it — title, description, caption, categories. */
  full: string;
}

/**
 * How well a picture answers `query`: null when it doesn't pass, else a
 * score in (0, 1.2] — the share of key words it has, plus 0.2 for a matching
 * modality. To pass:
 *  - a modality of the query (ECG, X-ray…) anywhere in what is said of it;
 *  - every qualifier of the query (left, right, normal…) in its OWN name —
 *    a right bundle branch block whose description mentions "left" fails;
 *  - every organ of the query in its own name — "respiratory failure" is not
 *    "heart failure", whatever its description says;
 *  - its other key words: up to two, in its own name (or, beside an organ,
 *    anywhere); more, two of them in its own name, two thirds anywhere, the
 *    longest anywhere.
 * A picture that has the words in its own name ranks above one that only
 * has them in its description.
 */
export function relevance(query: string, candidate: CandidateText): number | null {
  const wanted = keyWords(query);
  if (wanted.length === 0) return null;
  const own = foldedWords(candidate.primary);
  const all = foldedWords(`${candidate.primary} ${candidate.full}`);
  const inOwn = (word: string) => own.some((candidateWord) => sameWord(word, candidateWord));
  const inAll = (word: string) => all.some((candidateWord) => sameWord(word, candidateWord));

  const modalities = wanted.filter((word) => MODALITIES.has(word));
  const content = wanted.filter((word) => !MODALITIES.has(word));
  if (modalities.length > 0 && !modalities.some(inAll)) return null;
  if (!content.filter((word) => QUALIFIERS.has(word)).every(inOwn)) return null;
  if (content.length === 0) return 1.2;

  const matched = content.filter(inAll).length;
  const ownMatched = content.filter(inOwn).length;
  const organs = content.filter((word) => ORGANS.has(word));
  if (!organs.every(inOwn)) return null;
  if (content.length <= 2) {
    // An organ in its own name, the other word anywhere; without an organ, both in its own name.
    if (organs.length > 0 ? matched < content.length : ownMatched < content.length) return null;
  } else {
    const anchor = content.reduce((longest, word) => (word.length > longest.length ? word : longest), content[0]);
    if (ownMatched < 2 || !inAll(anchor) || matched < Math.ceil((content.length * 2) / 3)) return null;
  }
  return matched / content.length + ownMatched / (content.length * 10) + (modalities.length > 0 ? 0.2 : 0);
}

/** What kind of picture a request is after, from its words (French or English) — it decides which repository is favoured. */
export type ImageKind = "diagram" | "imaging" | "microscopy" | "trace";

/** Words that ask for a drawing, not a recording: an ECG "lead placement" or a "schéma" is a diagram. */
const DIAGRAM_CUES = new Set([
  "diagram", "diagrams", "schema", "schemas", "schematic", "scheme", "illustration", "labeled", "labelled", "legende",
  "anatomy", "anatomie", "placement", "position", "mechanism", "mecanisme", "structure",
]);

export function imageKind(text: string): ImageKind {
  const words = new Set(foldedWords(text));
  if (words.has("histology")) return "microscopy";
  if (["xray", "ct", "mri", "ultrasound", "echocardiography", "angiography", "endoscopy"].some((word) => words.has(word))) return "imaging";
  if (words.has("ecg") && !Array.from(DIAGRAM_CUES).some((word) => words.has(word))) return "trace";
  return "diagram";
}
