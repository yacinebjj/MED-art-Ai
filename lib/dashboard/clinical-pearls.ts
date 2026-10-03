import type { Language } from "@/providers/LanguageProvider";

/**
 * "Cas Flash du Jour" — hand-written, classic emergency/clinical-reasoning
 * questions (no AI call, no credit, instant). One per calendar day, the same
 * for every student, rotating through the list by day-of-year.
 */
export interface ClinicalPearl {
  id: string;
  question: Record<Language, string>;
  options: Record<Language, string[]>;
  /** Index into `options`. */
  answer: number;
  explanation: Record<Language, string>;
  tag: Record<Language, string>;
}

export const CLINICAL_PEARLS: ClinicalPearl[] = [
  {
    id: "purpura-fulminans",
    tag: { fr: "Pédiatrie · Urgence", en: "Pediatrics · Emergency" },
    question: {
      fr: "Enfant de 3 ans, fièvre à 39,5 °C et purpura extensif qui ne s'efface pas à la vitropression. Premier geste ?",
      en: "3-year-old, fever 39.5 °C and a spreading non-blanching purpura. First action?",
    },
    options: {
      fr: ["Ponction lombaire immédiate", "Ceftriaxone IV/IM sans attendre", "Hémocultures puis attendre les résultats", "Corticothérapie IV"],
      en: ["Immediate lumbar puncture", "IV/IM ceftriaxone without delay", "Blood cultures, then wait for results", "IV corticosteroids"],
    },
    answer: 1,
    explanation: {
      fr: "Purpura fulminans jusqu'à preuve du contraire : C3G (ceftriaxone) immédiatement, avant tout transfert ou examen.",
      en: "Purpura fulminans until proven otherwise: give a 3rd-gen cephalosporin (ceftriaxone) immediately, before transfer or any test.",
    },
  },
  {
    id: "charcot-triad",
    tag: { fr: "Hépato-gastro", en: "Gastroenterology" },
    question: {
      fr: "Fièvre, puis ictère, puis douleur de l'hypochondre droit, en 48 h. Diagnostic ?",
      en: "Fever, then jaundice, then right upper quadrant pain, within 48 h. Diagnosis?",
    },
    options: {
      fr: ["Cholécystite aiguë", "Hépatite virale aiguë", "Angiocholite aiguë", "Pancréatite aiguë"],
      en: ["Acute cholecystitis", "Acute viral hepatitis", "Acute cholangitis", "Acute pancreatitis"],
    },
    answer: 2,
    explanation: {
      fr: "Triade de Charcot (douleur, fièvre, ictère) = angiocholite, le plus souvent lithiasique.",
      en: "Charcot's triad (pain, fever, jaundice) = acute cholangitis, most often due to a stone.",
    },
  },
  {
    id: "hyperkalemia-ecg",
    tag: { fr: "Réanimation", en: "Critical care" },
    question: {
      fr: "Kaliémie à 7,2 mmol/L avec QRS élargis à l'ECG. Premier traitement ?",
      en: "Potassium 7.2 mmol/L with widened QRS on ECG. First treatment?",
    },
    options: {
      fr: ["Kayexalate per os", "Furosémide IV", "Gluconate de calcium IV", "Bicarbonate per os"],
      en: ["Oral sodium polystyrene sulfonate", "IV furosemide", "IV calcium gluconate", "Oral bicarbonate"],
    },
    answer: 2,
    explanation: {
      fr: "Le calcium IV protège le myocarde en quelques minutes ; on enchaîne ensuite insuline-glucose pour transférer le potassium.",
      en: "IV calcium stabilises the myocardium within minutes; insulin-glucose follows to shift potassium into cells.",
    },
  },
  {
    id: "thunderclap",
    tag: { fr: "Neurologie", en: "Neurology" },
    question: {
      fr: "Céphalée brutale « en coup de tonnerre », maximale d'emblée. Examen de première intention ?",
      en: "Sudden \"thunderclap\" headache, maximal at onset. First-line investigation?",
    },
    options: {
      fr: ["IRM cérébrale à J+2", "Scanner cérébral sans injection en urgence", "EEG", "Fond d'œil"],
      en: ["Brain MRI two days later", "Emergency non-contrast head CT", "EEG", "Fundoscopy"],
    },
    answer: 1,
    explanation: {
      fr: "Hémorragie méningée jusqu'à preuve du contraire : scanner sans injection en urgence, PL s'il est normal.",
      en: "Subarachnoid haemorrhage until proven otherwise: emergency non-contrast CT, lumbar puncture if it is normal.",
    },
  },
  {
    id: "paracetamol-antidote",
    tag: { fr: "Toxicologie", en: "Toxicology" },
    question: {
      fr: "Antidote d'une intoxication au paracétamol ?",
      en: "Antidote for paracetamol (acetaminophen) poisoning?",
    },
    options: {
      fr: ["Naloxone", "Flumazénil", "N-acétylcystéine", "Atropine"],
      en: ["Naloxone", "Flumazenil", "N-acetylcysteine", "Atropine"],
    },
    answer: 2,
    explanation: {
      fr: "La N-acétylcystéine restaure le glutathion hépatique ; à débuter selon la paracétamolémie (nomogramme) ou d'emblée si doute.",
      en: "N-acetylcysteine restores hepatic glutathione; start according to the paracetamol level (nomogram), or straight away if in doubt.",
    },
  },
  {
    id: "anaphylaxis",
    tag: { fr: "Urgences", en: "Emergency" },
    question: {
      fr: "Choc anaphylactique chez un adulte. Traitement de première intention ?",
      en: "Anaphylactic shock in an adult. First-line treatment?",
    },
    options: {
      fr: ["Adrénaline IM 0,5 mg", "Hydrocortisone IV", "Antihistaminique IV", "Salbutamol inhalé"],
      en: ["IM adrenaline (epinephrine) 0.5 mg", "IV hydrocortisone", "IV antihistamine", "Inhaled salbutamol"],
    },
    answer: 0,
    explanation: {
      fr: "L'adrénaline IM (face antérolatérale de la cuisse) est le seul traitement de première ligne ; corticoïdes et antihistaminiques sont adjuvants.",
      en: "IM adrenaline (anterolateral thigh) is the only first-line treatment; steroids and antihistamines are adjuncts.",
    },
  },
  {
    id: "inferior-stemi",
    tag: { fr: "Cardiologie", en: "Cardiology" },
    question: {
      fr: "Sus-décalage du segment ST en DII, DIII et aVF. Territoire atteint ?",
      en: "ST elevation in leads II, III and aVF. Which territory?",
    },
    options: {
      fr: ["Antérieur", "Latéral haut", "Inférieur", "Septal"],
      en: ["Anterior", "High lateral", "Inferior", "Septal"],
    },
    answer: 2,
    explanation: {
      fr: "DII-DIII-aVF = territoire inférieur, le plus souvent la coronaire droite ; rechercher une extension au ventricule droit (V3R-V4R).",
      en: "II-III-aVF = inferior territory, most often the right coronary artery; look for right-ventricular extension (V3R-V4R).",
    },
  },
  {
    id: "heparin-antidote",
    tag: { fr: "Pharmacologie", en: "Pharmacology" },
    question: {
      fr: "Antidote de l'héparine non fractionnée ?",
      en: "Antidote for unfractionated heparin?",
    },
    options: {
      fr: ["Vitamine K", "Sulfate de protamine", "Idarucizumab", "Acide tranexamique"],
      en: ["Vitamin K", "Protamine sulfate", "Idarucizumab", "Tranexamic acid"],
    },
    answer: 1,
    explanation: {
      fr: "La protamine neutralise l'HNF (et partiellement les HBPM). La vitamine K concerne les AVK, l'idarucizumab le dabigatran.",
      en: "Protamine neutralises UFH (and partly LMWH). Vitamin K is for VKAs, idarucizumab for dabigatran.",
    },
  },
  {
    id: "murphy",
    tag: { fr: "Chirurgie digestive", en: "Digestive surgery" },
    question: {
      fr: "Douleur de l'hypochondre droit, fièvre, inspiration bloquée à la palpation sous-costale droite. Diagnostic ?",
      en: "Right upper quadrant pain, fever, inspiration arrested on right subcostal palpation. Diagnosis?",
    },
    options: {
      fr: ["Cholécystite aiguë", "Colique néphrétique droite", "Pneumopathie de la base droite", "Appendicite"],
      en: ["Acute cholecystitis", "Right renal colic", "Right lower-lobe pneumonia", "Appendicitis"],
    },
    answer: 0,
    explanation: {
      fr: "Signe de Murphy positif + fièvre = cholécystite aiguë ; échographie abdominale en première intention.",
      en: "Positive Murphy's sign + fever = acute cholecystitis; abdominal ultrasound first.",
    },
  },
  {
    id: "opioid-antidote",
    tag: { fr: "Toxicologie", en: "Toxicology" },
    question: {
      fr: "Coma, myosis serré, bradypnée à 6/min. Antidote ?",
      en: "Coma, pinpoint pupils, respiratory rate 6/min. Antidote?",
    },
    options: {
      fr: ["Flumazénil", "Naloxone", "N-acétylcystéine", "Glucagon"],
      en: ["Flumazenil", "Naloxone", "N-acetylcysteine", "Glucagon"],
    },
    answer: 1,
    explanation: {
      fr: "Toxidrome opioïde : naloxone IV titrée ; attention à sa demi-vie courte (ré-intoxication possible).",
      en: "Opioid toxidrome: titrated IV naloxone; mind its short half-life (re-narcotisation can occur).",
    },
  },
  {
    id: "courvoisier",
    tag: { fr: "Oncologie digestive", en: "GI oncology" },
    question: {
      fr: "Ictère cutanéo-muqueux progressif, sans douleur, avec une grosse vésicule palpable. Diagnostic à évoquer ?",
      en: "Progressive painless jaundice with a palpable, non-tender gallbladder. Diagnosis to consider?",
    },
    options: {
      fr: ["Lithiase du cholédoque", "Hépatite alcoolique", "Cancer de la tête du pancréas", "Cholécystite aiguë"],
      en: ["Common bile duct stone", "Alcoholic hepatitis", "Cancer of the head of the pancreas", "Acute cholecystitis"],
    },
    answer: 2,
    explanation: {
      fr: "Loi de Courvoisier-Terrier : ictère + grosse vésicule = obstacle tumoral bas (tête du pancréas, ampullome).",
      en: "Courvoisier's law: jaundice + enlarged gallbladder = low malignant obstruction (pancreatic head, ampullary tumour).",
    },
  },
  {
    id: "tension-pneumothorax",
    tag: { fr: "Pneumologie · Urgence", en: "Pulmonology · Emergency" },
    question: {
      fr: "Détresse respiratoire, hémithorax droit tympanique et abolition du murmure vésiculaire, hypotension. Geste immédiat ?",
      en: "Respiratory distress, hyper-resonant right hemithorax with absent breath sounds, hypotension. Immediate action?",
    },
    options: {
      fr: ["Radiographie thoracique d'abord", "Exsufflation à l'aiguille", "Intubation orotrachéale", "Remplissage vasculaire seul"],
      en: ["Chest X-ray first", "Needle decompression", "Orotracheal intubation", "Fluid resuscitation alone"],
    },
    answer: 1,
    explanation: {
      fr: "Pneumothorax compressif = diagnostic clinique : exsufflation immédiate, sans attendre l'imagerie, puis drainage.",
      en: "Tension pneumothorax is a clinical diagnosis: immediate decompression without waiting for imaging, then a chest drain.",
    },
  },
  {
    id: "hypocalcemia-signs",
    tag: { fr: "Endocrinologie", en: "Endocrinology" },
    question: {
      fr: "Après une thyroïdectomie totale : paresthésies péribuccales, signe de Chvostek et signe de Trousseau. Trouble en cause ?",
      en: "After total thyroidectomy: perioral paraesthesia, Chvostek's and Trousseau's signs. Underlying disorder?",
    },
    options: {
      fr: ["Hypokaliémie", "Hypocalcémie", "Hyponatrémie", "Hypermagnésémie"],
      en: ["Hypokalaemia", "Hypocalcaemia", "Hyponatraemia", "Hypermagnesaemia"],
    },
    answer: 1,
    explanation: {
      fr: "Hypoparathyroïdie post-opératoire → hypocalcémie ; contrôler la calcémie et supplémenter en calcium (± vitamine D active).",
      en: "Post-operative hypoparathyroidism → hypocalcaemia; check calcium and supplement it (± active vitamin D).",
    },
  },
  {
    id: "vka-bleeding",
    tag: { fr: "Hématologie", en: "Haematology" },
    question: {
      fr: "Hémorragie grave chez un patient sous AVK, INR à 6. Traitement ?",
      en: "Major bleeding in a patient on a vitamin K antagonist, INR 6. Treatment?",
    },
    options: {
      fr: ["Arrêt de l'AVK seul", "Vitamine K seule", "Concentré de complexe prothrombinique (CCP) + vitamine K", "Sulfate de protamine"],
      en: ["Stop the VKA only", "Vitamin K only", "Prothrombin complex concentrate (PCC) + vitamin K", "Protamine sulfate"],
    },
    answer: 2,
    explanation: {
      fr: "Hémorragie grave sous AVK : CCP (effet immédiat) + vitamine K IV (effet durable), objectif INR < 1,5.",
      en: "Major VKA bleeding: PCC (immediate effect) + IV vitamin K (lasting effect), target INR < 1.5.",
    },
  },
  {
    id: "appendicitis",
    tag: { fr: "Chirurgie digestive", en: "Digestive surgery" },
    question: {
      fr: "Douleur ayant débuté en péri-ombilical puis migré en fosse iliaque droite, fébricule, défense localisée. Diagnostic ?",
      en: "Periumbilical pain migrating to the right iliac fossa, low-grade fever, localised guarding. Diagnosis?",
    },
    options: {
      fr: ["Appendicite aiguë", "Sigmoïdite", "Colique néphrétique", "Gastro-entérite"],
      en: ["Acute appendicitis", "Sigmoid diverticulitis", "Renal colic", "Gastroenteritis"],
    },
    answer: 0,
    explanation: {
      fr: "Migration de la douleur vers la FID + défense + fièvre : tableau typique d'appendicite aiguë.",
      en: "Pain migrating to the right iliac fossa + guarding + fever: the classic picture of acute appendicitis.",
    },
  },
  {
    id: "glasgow-min",
    tag: { fr: "Neurologie · Réa", en: "Neurology · ICU" },
    question: {
      fr: "Score de Glasgow le plus bas possible ?",
      en: "Lowest possible Glasgow Coma Scale score?",
    },
    options: { fr: ["0", "1", "3", "5"], en: ["0", "1", "3", "5"] },
    answer: 2,
    explanation: {
      fr: "Chaque item (Y, V, M) cote au minimum 1 : le Glasgow va de 3 à 15. Un GCS ≤ 8 impose de protéger les voies aériennes.",
      en: "Each component (E, V, M) scores at least 1: the GCS ranges from 3 to 15. GCS ≤ 8 calls for airway protection.",
    },
  },
];

/** Same pearl for the whole calendar day (local time), rotating through the list. */
export function pearlOfTheDay(date: Date): ClinicalPearl {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  return CLINICAL_PEARLS[dayOfYear % CLINICAL_PEARLS.length];
}
