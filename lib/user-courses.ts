import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Course, CourseStatus, SourceFileType } from "@/lib/types";

interface UserCourseRow {
  id: string;
  user_id: string;
  title: string;
  subject: string;
  file_type: SourceFileType;
  file_size_label: string;
  status: CourseStatus;
  source_text: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function rowToCourse(row: UserCourseRow): Course {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    fileType: row.file_type,
    fileSizeLabel: row.file_size_label,
    status: row.status,
    uploadedAt: new Date(row.created_at).toLocaleDateString("fr-FR"),
    errorMessage: row.error_message ?? undefined,
  };
}

/** All courses owned by this user, most recent first. */
export async function listUserCourses(userId: string): Promise<Course[]> {
  if (!userId || !isSupabaseConfigured()) return [];

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("user_courses")
      .select("id, user_id, title, subject, file_type, file_size_label, status, error_message, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase user_courses list failed", error);
      return [];
    }

    return (data as UserCourseRow[]).map(rowToCourse);
  } catch (error) {
    console.error("Supabase user_courses list threw", error);
    return [];
  }
}

/** A single course, scoped to its owner — never returns another user's row. */
export async function getUserCourse(courseId: string, userId: string): Promise<Course | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("user_courses")
      .select("id, user_id, title, subject, file_type, file_size_label, status, error_message, created_at, updated_at")
      .eq("id", courseId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) return null;
    return rowToCourse(data as UserCourseRow);
  } catch (error) {
    console.error("Supabase user_courses get threw", error);
    return null;
  }
}

/** The raw extracted text for a course, scoped to its owner — needed to generate any Studio artifact. */
export async function getUserCourseSourceText(
  courseId: string,
  userId: string
): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("user_courses")
      .select("source_text")
      .eq("id", courseId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) return null;
    return (data.source_text as string | null) ?? null;
  } catch (error) {
    console.error("Supabase user_courses source_text lookup threw", error);
    return null;
  }
}

export async function insertUserCourse(params: {
  userId: string;
  title: string;
  subject: string;
  fileType: SourceFileType;
  fileSizeLabel: string;
  status: CourseStatus;
  sourceText?: string;
  errorMessage?: string;
}): Promise<Course | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("user_courses")
      .insert({
        user_id: params.userId,
        title: params.title,
        subject: params.subject,
        file_type: params.fileType,
        file_size_label: params.fileSizeLabel,
        status: params.status,
        source_text: params.sourceText ?? null,
        error_message: params.errorMessage ?? null,
      })
      .select("id, user_id, title, subject, file_type, file_size_label, status, error_message, created_at, updated_at")
      .single();

    if (error) {
      console.error("Supabase user_courses insert failed", error);
      return null;
    }

    return rowToCourse(data as UserCourseRow);
  } catch (error) {
    console.error("Supabase user_courses insert threw", error);
    return null;
  }
}

export async function deleteUserCourse(courseId: string, userId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("user_courses")
      .delete()
      .eq("id", courseId)
      .eq("user_id", userId);

    if (error) {
      console.error("Supabase user_courses delete failed", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Supabase user_courses delete threw", error);
    return false;
  }
}
