import type { GastriteCasCliniqueData, GastriteQcmsData, GastriteResumeData, StudioClinicalRelevanceData } from "@/lib/course-slug-content";

/** Lightweight row for the sidebar list — GET /api/studio/courses?moduleId=X. */
export interface StudioCourseSummary {
  id: number;
  title: string;
  createdAt: string;
}

/**
 * Full row for the active course — GET /api/studio/courses/[id], and what
 * POST /api/studio/courses returns for a freshly created one (with every
 * section null). resume/casClinique omit "slug"/"section" for the same
 * reason as the ephemeral Option A pipeline: the AI JSON never produces
 * those two fields, they're filled in with a synthetic id only at render
 * time (see app/dashboard/module/[id]/page.tsx).
 */
export interface StudioCourseFull {
  id: number;
  title: string;
  rawText: string;
  explication: string | null;
  resume: Omit<GastriteResumeData, "slug" | "section"> | null;
  /**
   * A union, not just the standard case shape — 1ère année stores a
   * StudioClinicalRelevanceData essay instead (same jsonb column, no schema
   * migration: see STUDIO_SECTION_KEYS/resolveStudioSchema). The rendering
   * site (app/dashboard/module/[id]/page.tsx) tells them apart at runtime by
   * checking which shape actually came back, never by trusting the
   * student's CURRENT study year (which may have changed since this was
   * generated).
   */
  casClinique: (Omit<GastriteCasCliniqueData, "slug" | "section"> | StudioClinicalRelevanceData) | null;
  qcms: GastriteQcmsData | null;
  exemplesAnalogies: string | null;
  /** Public Supabase Storage URL of the originally uploaded file (see app/api/upload/route.ts's uploadSourceFile) — null for courses created from pasted text, or uploaded before this column existed. Powers FileViewerModal's "Afficher le cours". */
  sourceFileUrl: string | null;
  /** ISO timestamp, bumped by /api/studio/generate and /api/studio/regenerate on every section save (row-level, not per-section — see StudioPanel's "Récemment généré" list, the only current consumer). Powers a relative "il y a 5 minutes" label instead of the previous, per-row-identical "{sourceCount} source(s)" text. */
  updatedAt: string | null;
  /**
   * Public Supabase Storage URL of this course's generated Mindmap
   * infographie, or `null` if none exists yet. NOT a studio_courses column —
   * derived on every GET /api/studio/courses/[id] by hashing `explication`
   * and checking the shared, cross-student studio_infographic_cache table
   * (see that table's own comment in supabase/schema.sql). Never written via
   * the generic PATCH /api/studio/courses/[id] section-save endpoint —
   * app/api/studio/infographic/route.ts owns writing this cache directly.
   */
  infographicUrl: string | null;
  /**
   * Public Supabase Storage URL of this course's generated "Podcast Audio"
   * episode (.mp3), or `null` if none exists yet. Same derived-not-stored
   * pattern as infographicUrl above, backed by studio_podcast_cache —
   * app/api/studio/podcast/route.ts owns writing it.
   */
  audioUrl: string | null;
}
