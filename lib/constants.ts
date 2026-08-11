export const APP_NAME = "Med Art AI";

/** The hand-authored reference/showcase course ("masterclass") — the one course every visitor can open regardless of their own data, via the global "Voir la Démo" entry point (components/layout/Topbar.tsx). Single source of truth for this slug; do not redefine it locally elsewhere. */
export const PLEURESIE_DEMO_SLUG = "3-la-pleuresie-purulente-support-du-dr-firan-1785259421242";

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
  "Université d'Alger 1 (Benyoucef Benkhedda)",
  "Université de Blida 1 (Saad Dahlab)",
  "Université d'Oran 1 (Ahmed Ben Bella)",
  "Université de Constantine 3 (Salah Boubnider)",
  "Université d'Annaba (Badji Mokhtar)",
  "Université de Tlemcen (Abou Bekr Belkaid)",
  "Université de Sétif 1 (Ferhat Abbas)",
  "Université de Batna 2 (Mostefa Ben Boulaid)",
  "Université de Sidi Bel Abbès (Djillali Liabes)",
  "Université de Tizi Ouzou (Mouloud Mammeri)",
  "Université de Béjaïa (Abderrahmane Mira)",
  "Université de Mostaganem (Abdelhamid Ibn Badis)",
  "Université de Ouargla (Kasdi Merbah)",
  "Université de Laghouat (Amar Telidji)",
  "Université de Béchar (Tahri Mohammed)",
  "Université de Biskra (Mohamed Khider)",
  "Université de Tamanrasset",
  "Autre",
] as const;

export const ACCEPTED_FILE_TYPES = [".pdf", ".pptx", ".docx", ".txt"];

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
