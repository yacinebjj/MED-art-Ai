import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSubscription, isSubscriptionActive, resolveEffectivePlan } from "@/lib/subscription";
import { getProfile, getTrialDaysRemaining, isTrialActive } from "@/lib/trial";
import { PLANS } from "@/lib/pricing";
import type { DashboardOverview } from "@/types/dashboard-overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How far back activity timestamps are read for the streak / weekly widgets. */
const ACTIVITY_WINDOW_DAYS = 60;
const STUDIO_SLUG_PREFIX = "studio-course-";

interface CourseRow {
  id: number;
  title: string;
  curriculum_module_id: number;
  created_at: string;
  updated_at: string | null;
}

interface MasteryRow {
  course_slug: string;
  total_attempts: number;
  correct_attempts: number;
  mastery_pct: number;
}

/**
 * GET /api/dashboard/overview — everything the Medical OS dashboard, its
 * Topbar and its Sidebar show, in ONE round trip, computed from the real
 * tables (no fabricated numbers; a figure with no data behind it comes back
 * null/empty and the UI shows an empty state):
 *  - courses (id, title, module) for the Ctrl+K Spotlight and per-module progress,
 *  - QCM activity (qcm_attempts — latest attempt per QCM) and exam attempts,
 *  - activity timestamps from every table that records one, for the streak,
 *  - nearest exam date from the student's study plans,
 *  - Lab history (last patient case / matrix / mind map opened),
 *  - plan + monthly quota usage,
 *  - notes titles (Spotlight).
 * No AI call, no credit. Each block degrades independently: a failing table
 * yields its empty value instead of failing the whole dashboard.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 86_400_000).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const [
    coursesRes,
    masteryRes,
    qcmRes,
    examRes,
    tasksRes,
    plansRes,
    labRes,
    notesRes,
    lectureRes,
    flashcardProfileRes,
    sub,
    profile,
  ] = await Promise.all([
    supabase
      .from("studio_courses")
      .select("id, title, curriculum_module_id, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(500),
    supabase.rpc("course_mastery", { p_user_id: user.id }),
    supabase.from("qcm_attempts").select("is_correct, attempted_at, next_review_at").eq("user_id", user.id).limit(5000),
    supabase
      .from("user_exam_attempts")
      .select("curriculum_module_id, score, total_questions, created_at")
      .eq("user_id", user.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("study_plan_tasks").select("completed_at").eq("user_id", user.id).gte("completed_at", since).limit(500),
    supabase
      .from("study_plans")
      .select("id, exam_date, status, created_at, module_ids")
      .eq("user_id", user.id)
      .neq("status", "completed")
      .gte("exam_date", today)
      .order("exam_date", { ascending: true })
      .limit(1),
    supabase
      .from("user_lab_history")
      .select("tool_type, course_id, title, last_opened_at")
      .eq("user_id", user.id)
      .order("last_opened_at", { ascending: false })
      .limit(30),
    supabase.from("user_notes").select("id, title, module_id, updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(200),
    supabase.from("lecture_notes_jobs").select("id, title, status, updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(50),
    supabase.from("profiles").select("flashcard_active_module_ids").eq("id", user.id).maybeSingle<{ flashcard_active_module_ids: number[] | null }>(),
    getSubscription(user.id),
    getProfile(user.id),
  ]);

  for (const [label, res] of [
    ["studio_courses", coursesRes],
    ["course_mastery", masteryRes],
    ["qcm_attempts", qcmRes],
    ["user_exam_attempts", examRes],
    ["study_plan_tasks", tasksRes],
    ["study_plans", plansRes],
    ["user_lab_history", labRes],
    ["user_notes", notesRes],
    ["lecture_notes_jobs", lectureRes],
    ["profiles", flashcardProfileRes],
  ] as const) {
    if (res.error) console.error(`[dashboard/overview] Lecture ${label} impossible — bloc vide :`, res.error.message);
  }

  const courses = ((coursesRes.data ?? []) as CourseRow[]).filter((row) => row.curriculum_module_id != null);
  const courseById = new Map(courses.map((course) => [course.id, course]));

  // ---- Module titles (courses can live in modules outside the current curriculum year).
  const moduleIds = Array.from(new Set(courses.map((course) => course.curriculum_module_id)));
  const moduleTitleById = new Map<number, string>();
  if (moduleIds.length > 0) {
    const { data: moduleRows, error: moduleError } = await supabase.from("curriculum_modules").select("id, title").in("id", moduleIds);
    if (moduleError) console.error("[dashboard/overview] Lecture curriculum_modules impossible :", moduleError.message);
    for (const row of (moduleRows ?? []) as { id: number; title: string }[]) moduleTitleById.set(row.id, row.title);
  }

  // ---- QCM mastery per course → per module.
  const masteryByCourse = new Map<number, MasteryRow>();
  for (const row of (masteryRes.data ?? []) as MasteryRow[]) {
    if (!row.course_slug?.startsWith(STUDIO_SLUG_PREFIX)) continue;
    const id = Number(row.course_slug.slice(STUDIO_SLUG_PREFIX.length));
    if (courseById.has(id)) masteryByCourse.set(id, row);
  }

  const moduleStats = new Map<number, { courseCount: number; trainedCourses: number; masterySum: number; attempts: number; correct: number; lastActivityAt: string | null }>();
  for (const course of courses) {
    const stats = moduleStats.get(course.curriculum_module_id) ?? { courseCount: 0, trainedCourses: 0, masterySum: 0, attempts: 0, correct: 0, lastActivityAt: null };
    stats.courseCount += 1;
    const mastery = masteryByCourse.get(course.id);
    if (mastery && mastery.total_attempts > 0) {
      stats.trainedCourses += 1;
      stats.masterySum += Number(mastery.mastery_pct) || 0;
      stats.attempts += mastery.total_attempts;
      stats.correct += mastery.correct_attempts;
    }
    const touched = course.updated_at ?? course.created_at;
    if (!stats.lastActivityAt || touched > stats.lastActivityAt) stats.lastActivityAt = touched;
    moduleStats.set(course.curriculum_module_id, stats);
  }

  // ---- QCM activity (qcm_attempts keeps the LATEST attempt per QCM: "answered this week" = QCMs last answered this week).
  const weekAgo = Date.now() - 7 * 86_400_000;
  const qcmRows = (qcmRes.data ?? []) as { is_correct: boolean; attempted_at: string; next_review_at: string }[];
  const qcmThisWeek = qcmRows.filter((row) => new Date(row.attempted_at).getTime() >= weekAgo);
  const now = Date.now();

  const examRows = (examRes.data ?? []) as { curriculum_module_id: number; score: number; total_questions: number; created_at: string }[];
  const examThisWeek = examRows.filter((row) => new Date(row.created_at).getTime() >= weekAgo);

  // ---- Activity timestamps (client buckets them into LOCAL days for the streak).
  const activity: string[] = [];
  const pushActivity = (value: string | null | undefined) => {
    if (value && value >= since) activity.push(value);
  };
  qcmRows.forEach((row) => pushActivity(row.attempted_at));
  examRows.forEach((row) => pushActivity(row.created_at));
  ((tasksRes.data ?? []) as { completed_at: string | null }[]).forEach((row) => pushActivity(row.completed_at));
  const labRows = (labRes.data ?? []) as { tool_type: string; course_id: number | null; title: string | null; last_opened_at: string }[];
  labRows.forEach((row) => pushActivity(row.last_opened_at));
  courses.forEach((course) => pushActivity(course.updated_at ?? course.created_at));
  const noteRows = (notesRes.data ?? []) as { id: number; title: string; module_id: number | null; updated_at: string }[];
  noteRows.forEach((row) => pushActivity(row.updated_at));

  // ---- Next exam.
  const planRow = ((plansRes.data ?? []) as { id: number; exam_date: string; status: string; created_at: string; module_ids: number[] | null }[])[0] ?? null;

  // ---- Lab: last opened tool per course (most recent first), with the course's module for the deep link.
  const lab = labRows
    .filter((row) => row.course_id !== null && courseById.has(row.course_id))
    .slice(0, 6)
    .map((row) => {
      const course = courseById.get(row.course_id!)!;
      return {
        toolType: row.tool_type,
        title: row.title,
        lastOpenedAt: row.last_opened_at,
        courseId: course.id,
        courseTitle: course.title,
        moduleId: course.curriculum_module_id,
      };
    });

  // ---- Plan / quota.
  const trialing = isTrialActive(profile, user.created_at);
  const effectivePlanId = resolveEffectivePlan(sub);
  const effectivePlan = PLANS[effectivePlanId];

  const overview: DashboardOverview = {
    generatedAt: new Date().toISOString(),
    courses: courses.map((course) => ({
      id: course.id,
      title: course.title,
      moduleId: course.curriculum_module_id,
      moduleTitle: moduleTitleById.get(course.curriculum_module_id) ?? null,
      updatedAt: course.updated_at ?? course.created_at,
      qcmMasteryPct: masteryByCourse.has(course.id) ? Math.round(Number(masteryByCourse.get(course.id)!.mastery_pct) || 0) : null,
    })),
    modules: Array.from(moduleStats.entries()).map(([moduleId, stats]) => ({
      moduleId,
      title: moduleTitleById.get(moduleId) ?? null,
      courseCount: stats.courseCount,
      trainedCourses: stats.trainedCourses,
      // Mean QCM mastery over ALL the module's courses (an untrained course counts 0): a real "how far along" figure.
      progressPct: stats.courseCount > 0 ? Math.round(stats.masterySum / stats.courseCount) : 0,
      qcmAccuracyPct: stats.attempts > 0 ? Math.round((stats.correct / stats.attempts) * 100) : null,
      lastActivityAt: stats.lastActivityAt,
    })),
    qcm: {
      answeredThisWeek: qcmThisWeek.length,
      correctThisWeek: qcmThisWeek.filter((row) => row.is_correct).length,
      answeredTotal: qcmRows.length,
      correctTotal: qcmRows.filter((row) => row.is_correct).length,
      dueForReview: qcmRows.filter((row) => new Date(row.next_review_at).getTime() <= now).length,
    },
    exams: {
      attemptsThisWeek: examThisWeek.length,
      avgScorePctThisWeek:
        examThisWeek.length > 0
          ? Math.round(
              (examThisWeek.reduce((sum, row) => sum + (row.total_questions > 0 ? row.score / row.total_questions : 0), 0) / examThisWeek.length) * 100
            )
          : null,
    },
    activity,
    nextExam: planRow ? { planId: planRow.id, examDate: planRow.exam_date, planCreatedAt: planRow.created_at, moduleIds: planRow.module_ids ?? [] } : null,
    lab,
    notes: noteRows.map((row) => ({ id: row.id, title: row.title, moduleId: row.module_id, updatedAt: row.updated_at })),
    lectureNotes: ((lectureRes.data ?? []) as { id: number; title: string; status: string; updated_at: string }[])
      .filter((row) => row.status === "done")
      .map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at })),
    flashcardActiveModuleIds: flashcardProfileRes.data?.flashcard_active_module_ids ?? [],
    plan: {
      id: effectivePlanId,
      label: effectivePlan.label,
      paidActive: isSubscriptionActive(sub),
      trialActive: trialing,
      trialDaysRemaining: getTrialDaysRemaining(profile, user.created_at),
      unlimitedThisPeriod: trialing,
      generationsUsed: sub?.generations_used ?? 0,
      generationsCap: effectivePlan.courseCap,
      chatUsed: sub?.chat_messages_used ?? 0,
      chatCap: effectivePlan.chatMessageCap,
    },
  };

  return NextResponse.json({ success: true, overview });
}
