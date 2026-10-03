/** Response of GET /api/dashboard/overview (see that route for where each field comes from). */
export interface DashboardOverview {
  generatedAt: string;
  courses: DashboardCourse[];
  modules: DashboardModuleStats[];
  qcm: {
    /** QCMs whose latest attempt was in the last 7 days (qcm_attempts keeps one row per QCM). */
    answeredThisWeek: number;
    correctThisWeek: number;
    answeredTotal: number;
    correctTotal: number;
    /** Leitner reviews already due. */
    dueForReview: number;
  };
  exams: { attemptsThisWeek: number; avgScorePctThisWeek: number | null };
  /** ISO timestamps of real study activity in the last 60 days (bucketed into local days client-side). */
  activity: string[];
  nextExam: { planId: number; examDate: string; planCreatedAt: string; moduleIds: number[] } | null;
  lab: DashboardLabItem[];
  notes: { id: number; title: string; moduleId: number | null; updatedAt: string }[];
  lectureNotes: { id: number; title: string; updatedAt: string }[];
  flashcardActiveModuleIds: number[];
  plan: {
    id: string;
    label: string;
    paidActive: boolean;
    trialActive: boolean;
    trialDaysRemaining: number;
    unlimitedThisPeriod: boolean;
    generationsUsed: number;
    generationsCap: number;
    chatUsed: number;
    chatCap: number;
  };
}

export interface DashboardCourse {
  id: number;
  title: string;
  moduleId: number;
  moduleTitle: string | null;
  updatedAt: string;
  qcmMasteryPct: number | null;
}

export interface DashboardModuleStats {
  moduleId: number;
  title: string | null;
  courseCount: number;
  trainedCourses: number;
  progressPct: number;
  qcmAccuracyPct: number | null;
  lastActivityAt: string | null;
}

export interface DashboardLabItem {
  toolType: string;
  title: string | null;
  lastOpenedAt: string;
  courseId: number;
  courseTitle: string;
  moduleId: number;
}
