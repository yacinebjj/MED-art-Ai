export const APP_NAME = "Med Art AI";

export const SPECIALTIES = [
  { value: "medicine", label: "Médecine" },
  { value: "dentistry", label: "Médecine Dentaire" },
  { value: "pharmacy", label: "Pharmacie" },
] as const;

export type SpecialtyValue = (typeof SPECIALTIES)[number]["value"];

const YEAR_ORDINALS = ["1ère", "2ème", "3ème", "4ème", "5ème", "6ème", "7ème"];

function buildYearOptions(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    value: String(i + 1),
    label: `${YEAR_ORDINALS[i]} année`,
  }));
}

/** How many academic years each specialty's curriculum spans. */
const YEAR_COUNT_BY_SPECIALTY: Record<SpecialtyValue, number> = {
  medicine: 7,
  dentistry: 6,
  pharmacy: 5,
};

export const ACADEMIC_YEARS_BY_SPECIALTY: Record<
  SpecialtyValue,
  { value: string; label: string }[]
> = {
  medicine: buildYearOptions(YEAR_COUNT_BY_SPECIALTY.medicine),
  dentistry: buildYearOptions(YEAR_COUNT_BY_SPECIALTY.dentistry),
  pharmacy: buildYearOptions(YEAR_COUNT_BY_SPECIALTY.pharmacy),
};

/** The "Année" select must always match the currently chosen "Spécialité". */
export function getAcademicYearOptions(specialty: string) {
  return (
    ACADEMIC_YEARS_BY_SPECIALTY[specialty as SpecialtyValue] ??
    ACADEMIC_YEARS_BY_SPECIALTY.medicine
  );
}

export const ALGERIAN_FACULTIES = [
  "Université de Blida",
  "Université d'Alger",
  "Université de Médéa",
  "Université d'Oran",
  "Autre",
] as const;

export const ACCEPTED_FILE_TYPES = [".pdf", ".pptx", ".docx"];

export const OUTPUT_TABS = [
  {
    id: "explication",
    label: "Explication Ultra-Détaillée",
    shortLabel: "Explication",
  },
  {
    id: "resume",
    label: "Résumé",
    shortLabel: "Résumé",
  },
  {
    id: "pieges",
    label: "Les Pièges",
    shortLabel: "Pièges",
  },
  {
    id: "astuces",
    label: "Astuces Mnémotechniques",
    shortLabel: "Astuces",
  },
  {
    id: "cas-clinique",
    label: "Cas Clinique",
    shortLabel: "Cas Clinique",
  },
  {
    id: "qcm",
    label: "Examen QCMs",
    shortLabel: "QCMs",
  },
] as const;

export type OutputTabId = (typeof OUTPUT_TABS)[number]["id"];
