/**
 * The "To-Do List & AI Study Planner" module — backed by `study_plans` /
 * `study_plan_tasks` (see supabase/schema.sql). A plan starts as a `draft`
 * (module selection + config, no schedule yet), becomes `active` the moment
 * the student hits "Start" (its `generated_plan` has been exploded into real
 * `study_plan_tasks` rows), and `completed` once the exam date has passed.
 */

export type StudyPlanStatus = "draft" | "active" | "completed";

export interface StudyPlanChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** One item the student needs to study on a given day — the unit the Timeline/refinement chat actually edits. */
export interface GeneratedPlanItem {
  moduleId: number | null;
  title: string;
  hours: number;
  note?: string;
}

export interface GeneratedPlanDay {
  /** ISO date, "YYYY-MM-DD". */
  date: string;
  items: GeneratedPlanItem[];
}

export interface StudyPlan {
  id: number;
  moduleIds: number[];
  hoursPerDay: number;
  /** Rest days per week (0-6) — a count, not specific weekdays. */
  restDays: number;
  /** ISO date, "YYYY-MM-DD". */
  examDate: string;
  status: StudyPlanStatus;
  generatedPlan: GeneratedPlanDay[] | null;
  refinementChat: StudyPlanChatMessage[];
  sourceFileUrl: string | null;
  createdAt: string;
}

/** The flat, checkable to-do row — exploded from `generatedPlan` once the student hits "Start". */
export interface StudyPlanTask {
  id: number;
  planId: number;
  moduleId: number | null;
  title: string;
  /** ISO date, "YYYY-MM-DD". */
  dateScheduled: string;
  hours: number | null;
  isCompleted: boolean;
  completedAt: string | null;
  sortOrder: number;
}

/** Body for POST /api/study-planner/plans — creates a fresh draft. */
export interface CreateStudyPlanInput {
  moduleIds: number[];
  hoursPerDay: number;
  restDays: number;
  /** ISO date, "YYYY-MM-DD". */
  examDate: string;
  sourceFileUrl?: string | null;
  /** Manual course list when no programme file was uploaded (one title per line/entry). */
  manualCourseTitles?: string[];
}
