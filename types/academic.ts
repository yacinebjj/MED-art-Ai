/**
 * The official Algerian medical/pharmacy/dental curriculum structure —
 * specialty -> academic year -> teaching unit (UE/Uei) -> module.
 *
 * Backed by the `curriculum_specialties` / `curriculum_academic_years` /
 * `curriculum_teaching_units` / `curriculum_modules` tables (see
 * supabase/schema.sql). Deliberately unrelated to `ModuleSummary`
 * (lib/dashboard-modules.ts) — that type describes a student's own ad-hoc
 * "Ajouter à un module" folder, not the real program structure these types
 * model.
 */

export interface Specialty {
  id: number;
  name: string;
}

export interface AcademicYear {
  id: number;
  specialtyId: number;
  level: number;
  name: string;
}

export interface TeachingUnit {
  id: number;
  yearId: number;
  title: string;
  displayOrder: number;
}

/**
 * `teachingUnitId === null` marks an independent module (Module Transversal
 * / Hors-UE) — it belongs to the year directly, with no parent teaching
 * unit. Any other value means it is a sous-module of that unit.
 */
export interface CurriculumModule {
  id: number;
  yearId: number;
  teachingUnitId: number | null;
  title: string;
  displayOrder: number;
}

/** A teaching unit with its resolved sub-modules attached — the shape the accordion UI actually consumes. */
export interface TeachingUnitWithModules extends TeachingUnit {
  modules: CurriculumModule[];
}

/** Everything needed to render one academic year's curriculum in one shot: its UE (with sub-modules) plus its independent modules. */
export interface CurriculumYearData {
  year: AcademicYear;
  teachingUnits: TeachingUnitWithModules[];
  independentModules: CurriculumModule[];
}

/**
 * The student's own choice of filière + année, resolved from `profiles`
 * (see app/api/profile/route.ts) — both ids are `null` until the student has
 * saved a choice on the Settings page (e.g. right after sign-up).
 */
export interface StudentCurriculumProfile {
  specialtyId: number | null;
  academicYearId: number | null;
  specialty: Specialty | null;
  academicYear: AcademicYear | null;
}
