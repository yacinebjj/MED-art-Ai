/**
 * English translations for curriculum CONTENT names — specialty/teaching
 * unit/module titles read straight from Supabase (curriculum_specialties.name,
 * curriculum_teaching_units.title, curriculum_modules.title — see
 * supabase/schema.sql), which is French-only at the database level with no
 * `_en` column or locale variant. Unlike lib/translations/*.ts (fixed UI
 * strings, always known at build time), these are actual database VALUES —
 * this file can only cover the names this app's own seed data actually
 * uses (every specialty/teaching-unit/module title currently in
 * supabase/schema.sql's seed blocks), not any name a future curriculum
 * update might add.
 *
 * Deliberately a plain dictionary + fallback-to-original lookup, not a
 * translation API call — these are a few dozen short, static academic terms,
 * not free-form content, so a real-time translation call would be pure
 * latency/cost for no benefit. A name with no entry here is passed through
 * UNTRANSLATED (French) rather than shown blank/undefined — see
 * translateCurriculumName's own comment.
 */

const CURRICULUM_NAME_TRANSLATIONS: Record<string, string> = {
  // Specialties
  "Médecine": "Medicine",
  "Pharmacie": "Pharmacy",
  "Dentaire": "Dentistry",

  // Teaching units
  "Unité Cardio-respiratoire": "Cardio-respiratory Unit",
  "Unité Appareil digestif": "Digestive System Unit",
  "Unité Appareil Urinaire": "Urinary System Unit",
  "Unité Appareil endocrinien": "Endocrine System Unit",
  "Unité Système nerveux et Organes des sens": "Nervous System & Sensory Organs Unit",
  "Uei 01 : Appareil cardiovasculaire et respiratoire": "UEI 01: Cardiovascular & Respiratory System",
  "Uei 02 : Appareil neurologique, locomoteur, cutané": "UEI 02: Neurological, Musculoskeletal & Skin System",
  "Uei 03 : Appareil endocrinien et Urinaire": "UEI 03: Endocrine & Urinary System",
  "Uei 04 : Appareil digestif et Organes hématopoïétiques": "UEI 04: Digestive System & Hematopoietic Organs",

  // Modules
  "Anatomie": "Anatomy",
  "Anatomie/Respiratoire": "Anatomy/Respiratory",
  "Anatomie générale": "General Anatomy",
  "Anatomie pathologique": "Pathological Anatomy",
  "Anatomie Dentaire": "Dental Anatomy",
  "Anatomie/Histologie": "Anatomy/Histology",
  "Histologie": "Histology",
  "Histologie/embryologie": "Histology/Embryology",
  "Cytologie": "Cytology",
  "Embryologie": "Embryology",
  "Physiologie": "Physiology",
  "Physiologie générale": "General Physiology",
  "Physiologie/Anatomie Pathologique": "Physiology/Pathological Anatomy",
  "Biophysique": "Biophysics",
  "Secourisme": "First Aid",
  "Biochimie": "Biochemistry",
  "Biochimie Clinique": "Clinical Biochemistry",
  "Immunologie": "Immunology",
  "Génétique": "Genetics",
  "Psychologie": "Psychology",
  "Psychologie médicale": "Medical Psychology",
  "Sémiologie": "Semiology",
  "Sémiologie médicale": "Medical Semiology",
  "Radiologie": "Radiology",
  "Physiopathologie": "Pathophysiology",
  "Parasitologie": "Parasitology",
  "Microbiologie": "Microbiology",
  "Pharmacologie": "Pharmacology",
  "Cardiologie": "Cardiology",
  "Hépato-Gastro-Entérologie": "Hepato-Gastroenterology",
  "Hématologie": "Hematology",
  "Hémobiologie": "Hemobiology",
  "Infectiologie": "Infectious Diseases",
  "Neurologie": "Neurology",
  "Pneumologie": "Pulmonology",
  "Endocrinologie": "Endocrinology",
  "Gynécologie": "Gynecology",
  "Orthopédie": "Orthopedics",
  "Orthopédie Dento-Faciale": "Dento-Facial Orthopedics",
  "Pédiatrie": "Pediatrics",
  "Psychiatrie": "Psychiatry",
  "Rhumatologie": "Rheumatology",
  "Urologie-Néphrologie": "Urology-Nephrology",
  "Dermatologie": "Dermatology",
  "Ophtalmologie": "Ophthalmology",
  "ORL": "ENT",
  "Épidémiologie": "Epidemiology",
  "Epidémiologie": "Epidemiology",
  "Epidémiologie et Recherche": "Epidemiology & Research",
  "Urgences": "Emergency Medicine",
  "Médecine légale": "Forensic Medicine",
  "Médecine de travail": "Occupational Medicine",
  "Thérapeutique": "Therapeutics",
  "Pathologie et Thérapeutique": "Pathology & Therapeutics",
  "Pathologie Médicale": "Medical Pathology",
  "Économie de la santé": "Health Economics",
  "Droit médical": "Medical Law",
  "Droit Pharmaceutique": "Pharmaceutical Law",
  "Stage Internat": "Internship",
  "Français": "French",
  "Anglais": "English",
  "Français/Anglais/Terminologie Médicale": "French/English/Medical Terminology",
  "Physique": "Physics",
  "Physique/Physique Pharmaceutique": "Physics/Pharmaceutical Physics",
  "Chimie": "Chemistry",
  "Chimie Générale": "General Chemistry",
  "Chimie Organique": "Organic Chemistry",
  "Chimie minérale pharmaceutique": "Pharmaceutical Inorganic Chemistry",
  "Chimie analytique fondamentale": "Fundamental Analytical Chemistry",
  "Chimie analytique": "Analytical Chemistry",
  "Chimie thérapeutique": "Therapeutic Chemistry",
  "Biomathématiques/Statistiques": "Biomathematics/Statistics",
  "Biomathématiques/Biostatistiques": "Biomathematics/Biostatistics",
  "Biostatistiques": "Biostatistics",
  "Santé sociale et sciences humaines": "Social Health & Humanities",
  "Culture générale": "General Culture",
  "S.S.H": "Social & Human Sciences",
  "Informatique": "Computer Science",
  "Biologie Cellulaire": "Cell Biology",
  "Biologie Végétale/Botanique": "Plant Biology/Botany",
  "Botanique pharmaceutique": "Pharmaceutical Botany",
  "Histoire de la Pharmacie": "History of Pharmacy",
  "Pharmacognosie": "Pharmacognosy",
  "Pharmacie galénique": "Galenical Pharmacy",
  "Pharmacie Hospitalière": "Hospital Pharmacy",
  "Pharmacie Clinique": "Clinical Pharmacy",
  "Pharmacie Industrielle": "Industrial Pharmacy",
  "Gestion Pharmaceutique": "Pharmaceutical Management",
  "Toxicologie": "Toxicology",
  "Hydro-Bromatologie": "Hydro-Bromatology",
  "Prothèse": "Prosthodontics",
  "Parodontologie": "Periodontology",
  "Implantologie": "Implantology",
  "Odontologie Conservatrice/Endodontie": "Conservative Dentistry/Endodontics",
  "Odontologie conservatrice/Endodontie": "Conservative Dentistry/Endodontics",
  "Pathologie et Chirurgie Buccale": "Oral Pathology & Surgery",
  "Pathologie et Chirurgie Buccales": "Oral Pathology & Surgery",

  // "Module Indépendant N" (independent-study placeholder modules) — templated below.
};

for (let i = 1; i <= 9; i++) {
  CURRICULUM_NAME_TRANSLATIONS[`Module Indépendant ${i}`] = `Independent Module ${i}`;
}

/**
 * Translates a curriculum specialty/teaching-unit/module name for display
 * when the app language is English. Falls back to the ORIGINAL French name
 * for anything not in the dictionary above — real curriculum content
 * (seeded from supabase/schema.sql) rather than a blank/undefined is always
 * the safe default, since a missing translation should never make a module
 * disappear or look broken.
 */
export function translateCurriculumName(name: string, language: "fr" | "en"): string {
  if (language === "fr") return name;
  return CURRICULUM_NAME_TRANSLATIONS[name] ?? name;
}
