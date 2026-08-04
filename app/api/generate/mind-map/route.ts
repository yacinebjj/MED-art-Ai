import { NextRequest, NextResponse } from "next/server";
import { errorMessage, generateCourseSection } from "@/lib/course-generation-shared";

export const runtime = "nodejs";

/** Thin wrapper — all pipeline logic lives in generateCourseSection(). Requires the `mind_map` jsonb column on `courses` — see the SQL in the AI Mind Map section of the architecture writeup. */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { slug?: unknown };
    const { slug } = body ?? {};
    if (typeof slug !== "string" || !slug.trim()) {
      return NextResponse.json({ success: false, error: "Le champ 'slug' est requis." }, { status: 400 });
    }
    return await generateCourseSection(slug, "mind_map");
  } catch (error) {
    console.error("[generate/mind-map] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
