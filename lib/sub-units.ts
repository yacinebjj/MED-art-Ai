/**
 * The sub-unit breakdown for the two "chunked" content types. Splitting a
 * tab's content into independent sub-units is what lets the backend
 * generate them concurrently (Promise.all in the streaming route) and lets
 * the frontend render each one the moment it resolves, instead of blocking
 * on the slowest unit — see app/api/courses/[id]/generate-stream/route.ts.
 */

/** The 5 progressive clinical-case archetypes for the "Cas Clinique" tab. */
export const CAS_CLINIQUE_CASES = [
  { subUnitId: "case-1", numero: 1, archetype: "La Forme Typique (le cas d'école)" },
  { subUnitId: "case-2", numero: 2, archetype: "La Forme Atypique (présentation trompeuse, piège classique)" },
  { subUnitId: "case-3", numero: 3, archetype: "Compliquée / Urgence Absolue (choc, décompensation, prise en charge vitale)" },
  { subUnitId: "case-4", numero: 4, archetype: "Terrain Particulier — la grossesse ou l'enfant" },
  { subUnitId: "case-5", numero: 5, archetype: "Terrain Particulier — le sujet âgé ou l'immunodéprimé" },
] as const;

export type CasCliniqueSubUnitId = (typeof CAS_CLINIQUE_CASES)[number]["subUnitId"];

/** 4 batches of 8 QCM = 32 total (comfortably over the "30+" target), each a separate AI call. */
export const QCM_BATCH_SIZE = 8;

export const QCM_BATCHES = [
  { subUnitId: "qcm-batch-1", startIndex: 1 },
  { subUnitId: "qcm-batch-2", startIndex: 9 },
  { subUnitId: "qcm-batch-3", startIndex: 17 },
  { subUnitId: "qcm-batch-4", startIndex: 25 },
] as const;

export const QROC_SUB_UNIT_ID = "qroc";
export const QROC_COUNT = 10;

export const QCM_SUB_UNIT_IDS = [
  ...QCM_BATCHES.map((b) => b.subUnitId),
  QROC_SUB_UNIT_ID,
] as const;

export type QcmSubUnitId = (typeof QCM_SUB_UNIT_IDS)[number];
