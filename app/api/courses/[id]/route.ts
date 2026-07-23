import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { deleteUserCourse, getUserCourse } from "@/lib/user-courses";
import { getAllCachedContent } from "@/lib/course-content-cache";

export const runtime = "nodejs";

/** Course metadata + whichever Studio artifacts are already cached (if any). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const course = await getUserCourse(params.id, user.id);
  if (!course) {
    return NextResponse.json({ error: "Cours introuvable." }, { status: 404 });
  }

  const cachedContent = await getAllCachedContent(course.id);

  return NextResponse.json({ course, cachedContent });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const course = await getUserCourse(params.id, user.id);
  if (!course) {
    return NextResponse.json({ error: "Cours introuvable." }, { status: 404 });
  }

  const deleted = await deleteUserCourse(params.id, user.id);
  if (!deleted) {
    return NextResponse.json({ error: "Suppression impossible." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
