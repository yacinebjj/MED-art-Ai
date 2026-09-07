import type { AcademicYear } from "@/types/academic";

/**
 * "Interne" years are temporarily off-limits (feature not ready yet) — this
 * identifies them by `specialty.name` + `year.level`, NOT by matching on
 * `year.name` strings (verified live: every specialty's years are actually
 * named plainly — "1ère année".."7ème année" — level is the only field that
 * distinguishes them). Live-verified specialty names (via
 * GET /api/curriculum/specialties, confirmed 2026 — NOT the "Dentaire"
 * string a static read of supabase/schema.sql's seed script would suggest,
 * the live table has since diverged from that migration text):
 *  - "Médecine": level 7 is the Internat year (verified live — its years
 *    stop at level 6 for every OTHER specialty, only Médecine has a 7th).
 *  - "Pharmacie" / "Médecine Dentaire": level 6 is their Internat year
 *    (verified live — both specialties' years currently stop exactly at
 *    level 6, so it is their Internat/highest year).
 * Médecine's OWN level 6 ("6ème année") is an entirely ordinary, unlocked
 * year — never conflate the two.
 */
export function isLockedInternYear(specialtyName: string | undefined, year: AcademicYear): boolean {
  if (!specialtyName) return false;
  if (specialtyName === "Médecine") return year.level === 7;
  if (specialtyName === "Pharmacie" || specialtyName === "Médecine Dentaire") return year.level === 6;
  return false;
}

export const INTERN_YEAR_LOCKED_MESSAGE = "Bientôt disponible dans une prochaine mise à jour.";
