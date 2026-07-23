import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { listUserCourses } from "@/lib/user-courses";

export const runtime = "nodejs";

/** The authenticated student's own course list — powers the dashboard. */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const courses = await listUserCourses(user.id);
  return NextResponse.json({ courses });
}
