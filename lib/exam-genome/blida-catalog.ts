/**
 * EXAM GENOME — the official exam-unit catalog of the Faculté de Médecine,
 * Université Saad Dahlab Blida 1, track Médecine, years 1 to 6 (product order
 * 2026-11-27: Blida Medicine is the ONLY scope of the bank).
 *
 * Source: the six national programmes the faculty publishes on
 * https://www.univ-blida.dz/programme-et-volume-horaire-de-lenseignement-de-medecine/
 * (read 2026-11-27), each fixed by a ministerial arrêté. What a student sits
 * is an EXAM UNIT, not a course module: from year 2 on, one paper examines a
 * whole integrated unit (« un seul examen pour l'ensemble des matières »), and
 * in year 1 Biostatistique and Informatique are one paper. `curriculumTitles`
 * maps each exam unit to the MedArt curriculum entries (curriculum_* tables,
 * same year) it examines, so a question bank and a student's courses meet.
 *
 * Exam slots per academic year (session normale): one paper per sitting in
 * `normalSittings` — EMD1 and EMD2 for year-1 annual modules, one paper
 * otherwise — plus ONE rattrapage paper per unit. Clinical units (years 4-6)
 * are taught in rotations: each rotation period can have its own theory
 * paper, tracked as extra papers of the same slot (`rotation`).
 */

export type GenomeSitting = "emd1" | "emd2" | "unique" | "synthese";

export type BlidaUnitKind = "module_annuel" | "module_semestriel" | "uei" | "uet" | "module" | "unite_clinique";

export interface BlidaExamUnit {
  /** Stable key, used in the database: "Y<year>-<NAME>". */
  code: string;
  year: 1 | 2 | 3 | 4 | 5 | 6;
  kind: BlidaUnitKind;
  /** The unit's title in the official programme. */
  title: string;
  /** Teaching semester when the programme fixes one; null for annual units and clinical rotations. */
  semester: 1 | 2 | null;
  /** Papers of the session normale, per academic year. */
  normalSittings: GenomeSitting[];
  /** Disciplines examined inside the unit's paper. */
  components: string[];
  /** Labels found on papers and in students' words (accent-insensitive). */
  aliases: string[];
  /** MedArt curriculum entries (teaching-unit or module titles of the same year) this exam unit covers. */
  curriculumTitles: string[];
  /** Taught in clinical rotations: one theory paper per rotation period is possible. */
  rotations: boolean;
}

export interface BlidaYearProgramme {
  year: 1 | 2 | 3 | 4 | 5 | 6;
  legalReference: string;
  /** First academic year the current programme applies to: papers older than this follow a previous programme. */
  validFrom: string;
  programmeUrl: string;
  /** MedArt curriculum entries of this year that the current official programme no longer examines. */
  legacyCurriculumTitles: string[];
  units: BlidaExamUnit[];
}

const PROGRAMME_BASE = "https://www.univ-blida.dz/wp-content/uploads/2026/11/";

function unit(u: Omit<BlidaExamUnit, "normalSittings" | "rotations"> & Partial<Pick<BlidaExamUnit, "normalSittings" | "rotations">>): BlidaExamUnit {
  return { normalSittings: ["unique"], rotations: false, ...u };
}

export const BLIDA_PROGRAMMES: readonly BlidaYearProgramme[] = [
  {
    year: 1,
    legalReference: "Arrêté n° 617 du 18 juillet 2018 (programme de première année)",
    validFrom: "2018/2019",
    programmeUrl: PROGRAMME_BASE + "Nouveau-Programme-1ere-annee-Medecine-2019-1-1.pdf",
    legacyCurriculumTitles: [],
    units: [
      unit({ code: "Y1-ANATOMIE", year: 1, kind: "module_annuel", title: "Anatomie", semester: null, normalSittings: ["emd1", "emd2"], components: ["Anatomie"], aliases: ["anatomie", "anat"], curriculumTitles: ["Anatomie"] }),
      unit({ code: "Y1-BIOCHIMIE", year: 1, kind: "module_annuel", title: "Biochimie", semester: null, normalSittings: ["emd1", "emd2"], components: ["Biochimie"], aliases: ["biochimie", "bioch"], curriculumTitles: ["Biochimie"] }),
      unit({ code: "Y1-BIOSTAT", year: 1, kind: "module_annuel", title: "Biostatistique - Informatique", semester: null, normalSittings: ["emd1", "emd2"], components: ["Biostatistique", "Informatique"], aliases: ["biostatistique", "biostatistiques", "biostat", "bio statistique", "statistiques", "informatique"], curriculumTitles: ["Biostatistiques", "Informatique"] }),
      unit({ code: "Y1-CHIMIE", year: 1, kind: "module_annuel", title: "Chimie", semester: null, normalSittings: ["emd1", "emd2"], components: ["Chimie générale", "Chimie organique"], aliases: ["chimie", "chimie generale", "chimie organique"], curriculumTitles: ["Chimie"] }),
      unit({ code: "Y1-CYTOLOGIE", year: 1, kind: "module_annuel", title: "Cytologie", semester: null, normalSittings: ["emd1", "emd2"], components: ["Cytologie"], aliases: ["cytologie", "cyto", "biologie cellulaire"], curriculumTitles: ["Cytologie"] }),
      unit({ code: "Y1-BIOPHYSIQUE", year: 1, kind: "module_annuel", title: "Physique - Biophysique", semester: null, normalSittings: ["emd1", "emd2"], components: ["Physique", "Biophysique"], aliases: ["biophysique", "physique", "physique biophysique"], curriculumTitles: ["Biophysique"] }),
      unit({ code: "Y1-EMBRYOLOGIE", year: 1, kind: "module_semestriel", title: "Embryologie", semester: 1, components: ["Embryologie"], aliases: ["embryologie", "embryo", "embryologie generale"], curriculumTitles: ["Embryologie"] }),
      unit({ code: "Y1-SSH", year: 1, kind: "module_semestriel", title: "Santé, Société et Humanité", semester: 1, components: ["Santé, société et humanité"], aliases: ["ssh", "s s h", "sante societe et humanite", "sante societe humanite", "sante societe"], curriculumTitles: ["S.S.H"] }),
      unit({ code: "Y1-HISTOLOGIE", year: 1, kind: "module_semestriel", title: "Histologie générale", semester: 2, components: ["Histologie"], aliases: ["histologie", "histo", "histologie generale"], curriculumTitles: ["Histologie"] }),
      unit({ code: "Y1-PHYSIOLOGIE", year: 1, kind: "module_semestriel", title: "Physiologie générale", semester: 2, components: ["Physiologie"], aliases: ["physiologie", "physio", "physiologie generale"], curriculumTitles: ["Physiologie"] }),
    ],
  },
  {
    year: 2,
    legalReference: "Arrêté n° 1058 du 07 juillet 2019 (programme de deuxième année)",
    validFrom: "2019/2020",
    programmeUrl: PROGRAMME_BASE + "Nouveau-Programme-2eme-annee-Medecine-2019-1.pdf",
    legacyCurriculumTitles: [],
    units: [
      unit({ code: "Y2-UEI-CARDIO-RESP", year: 2, kind: "uei", title: "UEI Appareil cardio-vasculaire, respiratoire et organes hématopoïétiques", semester: null, components: ["Anatomie", "Histologie", "Biophysique", "Physiologie"], aliases: ["uei 1", "uei1", "cardio respiratoire", "cardio vasculaire", "cardiovasculaire", "respiratoire", "appareil cardio"], curriculumTitles: ["Unité Cardio-respiratoire"] }),
      unit({ code: "Y2-UEI-DIGESTIF", year: 2, kind: "uei", title: "UEI Appareil digestif", semester: null, components: ["Anatomie", "Histologie", "Biochimie", "Physiologie"], aliases: ["uei 2", "uei2", "digestif", "appareil digestif"], curriculumTitles: ["Unité Appareil digestif"] }),
      unit({ code: "Y2-UEI-URINAIRE", year: 2, kind: "uei", title: "UEI Appareil urinaire", semester: null, components: ["Anatomie", "Histologie", "Biochimie", "Physiologie"], aliases: ["uei 3", "uei3", "urinaire", "appareil urinaire"], curriculumTitles: ["Unité Appareil Urinaire"] }),
      unit({ code: "Y2-UEI-ENDOCRINO", year: 2, kind: "uei", title: "UEI Appareil endocrinien et de la reproduction", semester: null, components: ["Anatomie", "Histologie", "Biochimie", "Physiologie"], aliases: ["uei 4", "uei4", "endocrinien", "endocrino", "reproduction", "appareil endocrinien"], curriculumTitles: ["Unité Appareil endocrinien"] }),
      unit({ code: "Y2-UEI-NERVEUX", year: 2, kind: "uei", title: "UEI Appareil nerveux et organes des sens", semester: null, components: ["Anatomie", "Histologie", "Biophysique", "Physiologie"], aliases: ["uei 5", "uei5", "nerveux", "systeme nerveux", "organes des sens", "neuro"], curriculumTitles: ["Unité Système nerveux et Organes des sens"] }),
      unit({ code: "Y2-GENETIQUE", year: 2, kind: "module", title: "Génétique", semester: null, components: ["Génétique"], aliases: ["genetique"], curriculumTitles: ["Génétique"] }),
      unit({ code: "Y2-IMMUNOLOGIE", year: 2, kind: "module", title: "Immunologie fondamentale", semester: null, components: ["Immunologie"], aliases: ["immunologie", "immuno", "immunologie fondamentale"], curriculumTitles: ["Immunologie"] }),
    ],
  },
  {
    year: 3,
    legalReference: "Arrêté n° 786 du 26 octobre 2020 (programme de troisième année)",
    validFrom: "2020/2021",
    programmeUrl: PROGRAMME_BASE + "Nouveau-Programme-3eme-annee-Medecine-2020.pdf",
    legacyCurriculumTitles: [],
    units: [
      unit({ code: "Y3-UEI1", year: 3, kind: "uei", title: "UEI 1 — Psychologie médicale, sémiologie générale, appareils cardio-vasculaire et respiratoire", semester: 1, components: ["Psychologie médicale", "Sémiologie", "Radiologie", "Physiopathologie", "Biochimie"], aliases: ["uei 1", "uei1", "uei 01", "cardio respiratoire", "cardiovasculaire et respiratoire", "semiologie generale"], curriculumTitles: ["Uei 01 : Appareil cardiovasculaire et respiratoire"] }),
      unit({ code: "Y3-UEI2", year: 3, kind: "uei", title: "UEI 2 — Appareils neurologique, locomoteur et cutané", semester: 1, components: ["Sémiologie", "Radiologie", "Physiopathologie", "Biochimie"], aliases: ["uei 2", "uei2", "uei 02", "neurologique", "locomoteur", "cutane"], curriculumTitles: ["Uei 02 : Appareil neurologique, locomoteur, cutané"] }),
      unit({ code: "Y3-UEI3", year: 3, kind: "uei", title: "UEI 3 — Appareils endocrinien, de la reproduction et urinaire", semester: 2, components: ["Sémiologie", "Radiologie", "Physiopathologie", "Biochimie"], aliases: ["uei 3", "uei3", "uei 03", "endocrinien", "urinaire", "reproduction"], curriculumTitles: ["Uei 03 : Appareil endocrinien + Urinaire"] }),
      unit({ code: "Y3-UEI4", year: 3, kind: "uei", title: "UEI 4 — Appareil digestif et organes hématopoïétiques", semester: 2, components: ["Sémiologie", "Radiologie", "Physiopathologie", "Biochimie"], aliases: ["uei 4", "uei4", "uei 04", "digestif", "hematopoietiques"], curriculumTitles: ["Uei 04 : Appareil digestif + Organes hématopoïétiques"] }),
      unit({ code: "Y3-UET-ACP", year: 3, kind: "uet", title: "UET 1 — Anatomie et cytologie pathologiques", semester: 1, components: ["Anatomie pathologique"], aliases: ["uet 1", "uet1", "acp", "anapath", "anatomie pathologique", "anatomie et cytologie pathologiques"], curriculumTitles: ["Anatomie pathologique"] }),
      unit({ code: "Y3-UET-IMMUNOLOGIE", year: 3, kind: "uet", title: "UET 2 — Immunologie", semester: 1, components: ["Immunologie"], aliases: ["uet 2", "uet2", "immunologie", "immuno"], curriculumTitles: ["Immunologie"] }),
      unit({ code: "Y3-UET-MICROBIOLOGIE", year: 3, kind: "uet", title: "UET 3 — Microbiologie médicale", semester: 2, components: ["Bactériologie", "Virologie"], aliases: ["uet 3", "uet3", "microbiologie", "microbio", "bacteriologie", "virologie"], curriculumTitles: ["Microbiologie"] }),
      unit({ code: "Y3-UET-PARASITOLOGIE", year: 3, kind: "uet", title: "UET 4 — Parasitologie - Mycologie", semester: 2, components: ["Parasitologie", "Mycologie"], aliases: ["uet 4", "uet4", "parasitologie", "parasito", "mycologie", "parasitologie mycologie"], curriculumTitles: ["Parasitologie"] }),
      unit({ code: "Y3-UET-PHARMACOLOGIE", year: 3, kind: "uet", title: "UET 5 — Pharmacologie clinique", semester: 2, components: ["Pharmacologie"], aliases: ["uet 5", "uet5", "pharmacologie", "pharmaco", "pharmacologie clinique"], curriculumTitles: ["Pharmacologie"] }),
    ],
  },
  {
    year: 4,
    legalReference: "Arrêté n° 914 du 08 août 2021 (programme de quatrième année)",
    validFrom: "2021/2022",
    programmeUrl: PROGRAMME_BASE + "Nouveau-programme-4-annee-medecine-1.pdf",
    legacyCurriculumTitles: [],
    units: [
      unit({ code: "Y4-CARDIO-PNEUMO", year: 4, kind: "unite_clinique", title: "Unité cardio-vasculaire et respiratoire", semester: null, rotations: true, components: ["Cardiologie", "Pneumo-phtisiologie"], aliases: ["cardiologie", "cardio", "pneumologie", "pneumo", "pneumo phtisiologie", "phtisiologie", "cardio pneumo", "cardio vasculaire et respiratoire"], curriculumTitles: ["Cardiologie", "Pneumologie"] }),
      unit({ code: "Y4-HGE", year: 4, kind: "unite_clinique", title: "Hépato-gastro-entérologie", semester: null, rotations: true, components: ["Hépato-gastro-entérologie"], aliases: ["hge", "hepato gastro enterologie", "gastro enterologie", "gastro", "hepatologie"], curriculumTitles: ["Hépato-Gastro-Entérologie"] }),
      unit({ code: "Y4-INFECTIOLOGIE", year: 4, kind: "unite_clinique", title: "Maladies infectieuses", semester: null, rotations: true, components: ["Maladies infectieuses"], aliases: ["maladies infectieuses", "infectiologie", "infectieux", "infectio"], curriculumTitles: ["Infectiologie"] }),
      unit({ code: "Y4-NEUROLOGIE", year: 4, kind: "unite_clinique", title: "Neurologie", semester: null, rotations: true, components: ["Neurologie"], aliases: ["neurologie", "neuro"], curriculumTitles: ["Neurologie"] }),
      unit({ code: "Y4-ONCO-HEMATO", year: 4, kind: "unite_clinique", title: "Onco-hématologie", semester: null, rotations: true, components: ["Hématologie", "Oncologie"], aliases: ["onco hematologie", "onco hemato", "hematologie", "oncologie", "hemato"], curriculumTitles: ["Hématologie"] }),
    ],
  },
  {
    year: 5,
    legalReference: "Arrêté n° 731 du 26 juin 2022 (programme de cinquième année)",
    validFrom: "2022/2023",
    programmeUrl: PROGRAMME_BASE + "programme-de-5eme-annee-medecine.pdf",
    legacyCurriculumTitles: [],
    units: [
      unit({ code: "Y5-LOCOMOTEUR", year: 5, kind: "unite_clinique", title: "Appareil locomoteur", semester: null, rotations: true, components: ["Orthopédie", "Rhumatologie", "Médecine physique et réadaptation"], aliases: ["appareil locomoteur", "locomoteur", "orthopedie", "traumatologie", "rhumatologie", "mpr"], curriculumTitles: ["Orthopédie", "Rhumatologie"] }),
      unit({ code: "Y5-GYNECO-OBST", year: 5, kind: "unite_clinique", title: "Gynécologie-obstétrique", semester: null, rotations: true, components: ["Gynécologie", "Obstétrique"], aliases: ["gynecologie obstetrique", "gynecologie", "gyneco", "obstetrique"], curriculumTitles: ["Gynécologie"] }),
      unit({ code: "Y5-ENDOCRINO", year: 5, kind: "unite_clinique", title: "Endocrinologie - maladies métaboliques", semester: null, rotations: true, components: ["Endocrinologie", "Diabétologie"], aliases: ["endocrinologie", "endocrino", "maladies metaboliques", "diabetologie"], curriculumTitles: ["Endocrinologie"] }),
      unit({ code: "Y5-PEDIATRIE", year: 5, kind: "unite_clinique", title: "Pédiatrie", semester: null, rotations: true, components: ["Pédiatrie"], aliases: ["pediatrie", "pedia"], curriculumTitles: ["Pédiatrie"] }),
      unit({ code: "Y5-SANTE-MENTALE", year: 5, kind: "unite_clinique", title: "Santé mentale", semester: null, rotations: true, components: ["Psychiatrie"], aliases: ["sante mentale", "psychiatrie"], curriculumTitles: ["Psychiatrie"] }),
      unit({ code: "Y5-URO-NEPHRO", year: 5, kind: "unite_clinique", title: "Urologie - néphrologie", semester: null, rotations: true, components: ["Urologie", "Néphrologie"], aliases: ["uro nephrologie", "uro nephro", "urologie", "nephrologie", "nephro"], curriculumTitles: ["Urologie-Néphrologie"] }),
    ],
  },
  {
    year: 6,
    legalReference: "Arrêté n° 844 du 03 juillet 2023 (programme de sixième année)",
    validFrom: "2023/2024",
    programmeUrl: PROGRAMME_BASE + "Nouveau-Programme-6eme-Annee-Medecine.pdf",
    // In MedArt's 6th-year curriculum, not in the 2023 programme.
    legacyCurriculumTitles: ["Thérapeutique", "Psychologie médicale"],
    units: [
      unit({ code: "Y6-URGENCES", year: 6, kind: "unite_clinique", title: "Médecine d'urgence", semester: null, rotations: true, components: ["Médecine d'urgence"], aliases: ["medecine d urgence", "urgences", "urgence"], curriculumTitles: ["Urgences"] }),
      unit({ code: "Y6-MEDECINE-LEGALE", year: 6, kind: "unite_clinique", title: "Médecine légale et droit médical", semester: null, rotations: true, components: ["Médecine légale", "Droit médical"], aliases: ["medecine legale", "droit medical", "legale"], curriculumTitles: ["Médecine légale", "Droit médical"] }),
      unit({ code: "Y6-PERSONNE-AGEE", year: 6, kind: "unite_clinique", title: "Personne âgée", semester: null, rotations: true, components: ["Gériatrie"], aliases: ["personne agee", "geriatrie", "sujet age"], curriculumTitles: [] }),
      unit({ code: "Y6-MALADIES-SYSTEMIQUES", year: 6, kind: "unite_clinique", title: "Maladies systémiques", semester: null, rotations: true, components: ["Médecine interne"], aliases: ["maladies systemiques", "maladie systemique", "systemiques", "medecine interne"], curriculumTitles: [] }),
      unit({ code: "Y6-DERMATOLOGIE", year: 6, kind: "unite_clinique", title: "Dermatologie", semester: null, rotations: true, components: ["Dermatologie"], aliases: ["dermatologie", "dermato"], curriculumTitles: ["Dermatologie"] }),
      unit({ code: "Y6-ORL", year: 6, kind: "unite_clinique", title: "Oto-rhino-laryngologie (ORL)", semester: null, rotations: true, components: ["ORL"], aliases: ["orl", "oto rhino laryngologie", "otorhinolaryngologie"], curriculumTitles: ["ORL"] }),
      unit({ code: "Y6-OPHTALMOLOGIE", year: 6, kind: "unite_clinique", title: "Ophtalmologie", semester: null, rotations: true, components: ["Ophtalmologie"], aliases: ["ophtalmologie", "ophtalmo"], curriculumTitles: ["Ophtalmologie"] }),
      unit({ code: "Y6-SANTE-TRAVAIL", year: 6, kind: "unite_clinique", title: "Santé au travail et environnement", semester: null, rotations: true, components: ["Médecine du travail", "Santé environnementale"], aliases: ["sante au travail", "medecine du travail", "medecine de travail"], curriculumTitles: ["Médecine de travail"] }),
      unit({ code: "Y6-EPIDEMIOLOGIE", year: 6, kind: "unite_clinique", title: "Épidémiologie - méthodologie de recherche - lecture critique d'article - santé publique et économie de la santé", semester: null, rotations: true, components: ["Épidémiologie", "Méthodologie de recherche", "Lecture critique d'article", "Santé publique", "Économie de la santé"], aliases: ["epidemiologie", "epidemio", "sante publique", "economie de la sante", "lecture critique", "methodologie de recherche"], curriculumTitles: ["Épidémiologie", "Économie de la santé"] }),
    ],
  },
];

export const BLIDA_UNITS: readonly BlidaExamUnit[] = BLIDA_PROGRAMMES.flatMap((programme) => programme.units);

const UNIT_BY_CODE = new Map(BLIDA_UNITS.map((u) => [u.code, u]));

export function getBlidaUnit(code: string): BlidaExamUnit | undefined {
  return UNIT_BY_CODE.get(code);
}

export function blidaUnitsForYear(year: number): BlidaExamUnit[] {
  return BLIDA_UNITS.filter((u) => u.year === year);
}

export function blidaProgramme(year: number): BlidaYearProgramme | undefined {
  return BLIDA_PROGRAMMES.find((p) => p.year === year);
}

/** "1re année", "2e année" … — the French ordinal of a year of study. */
export function yearLabel(year: number): string {
  return year === 1 ? "1re année" : `${year}e année`;
}

/** Expected papers of one academic year for a unit: one per normal sitting, plus the rattrapage. */
export function expectedSlots(u: BlidaExamUnit): { session: "normale" | "rattrapage"; sitting: GenomeSitting }[] {
  return [...u.normalSittings.map((sitting) => ({ session: "normale" as const, sitting })), { session: "rattrapage" as const, sitting: "unique" as const }];
}
