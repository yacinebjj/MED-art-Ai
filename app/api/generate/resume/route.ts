import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { errorMessage, generateCourseSection } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Thin wrapper — all pipeline logic lives in generateCourseSection(). Auth required: this triggers a real, billed OpenRouter call. */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
    }

    const rl = rateLimit(`generate-resume:${user.id}`, RATE_LIMITS.ai);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
      );
    }

    const body = (await request.json()) as { slug?: unknown };
    const { slug } = body ?? {};
    if (typeof slug !== "string" || !slug.trim()) {
      return NextResponse.json({ success: false, error: "Le champ 'slug' est requis." }, { status: 400 });
    }
    return await generateCourseSection(slug, "resume");
  } catch (error) {
    console.error("[generate/resume] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
