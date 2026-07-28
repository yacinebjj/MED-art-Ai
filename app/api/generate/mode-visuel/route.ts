import { NextRequest, NextResponse } from "next/server";
import { errorMessage, generateCourseSection } from "@/lib/course-generation-shared";

export const runtime = "nodejs";

/** Thin wrapper — all pipeline logic lives in generateCourseSection(). */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { slug?: unknown };
    const { slug } = body ?? {};
    if (typeof slug !== "string" || !slug.trim()) {
      return NextResponse.json({ success: false, error: "Le champ 'slug' est requis." }, { status: 400 });
    }
    return await generateCourseSection(slug, "mode_visuel");
  } catch (error) {
    console.error("[generate/mode-visuel] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
