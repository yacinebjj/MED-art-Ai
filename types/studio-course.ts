import type { GastriteCasCliniqueData, GastriteQcmsData, GastriteResumeData } from "@/lib/course-slug-content";
import type { DynamicMindMapData } from "@/components/course/workspace/DynamicMindMapStudio";

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
  casClinique: Omit<GastriteCasCliniqueData, "slug" | "section"> | null;
  qcms: GastriteQcmsData | null;
  mindMap: DynamicMindMapData | null;
  exemplesAnalogies: string | null;
}
