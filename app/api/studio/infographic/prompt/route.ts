import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { buildFicheSynthesePrompt, extractFicheOutline, ficheContentHash } from "@/lib/ai/infographic-sheet";
import { ficheSourceText } from "@/lib/infographic-fiche-key";

export const runtime = "nodejs";
// Free Omni (≤ 45 s) then two cheap fallbacks (≤ 25 s each), after at most
// 60 s waiting on an identical extraction already running elsewhere.
export const maxDuration = 180;

interface CourseRow {
  id: number;
  title: string;
  explication: string | null;
  raw_text: string | null;
}

/**
 * STEP 1 of the Studio "Infographie / Fiche de Synthèse" (lib/ai/infographic-sheet.ts):
 * reads the student's course and returns the sheet's plan — title, core
 * topic, six key sub-topics — and the strict image prompt built from it.
 *
 * A text model does the reading: the free PRIMARY_FREE_OMNI first, then the
 * ultra-cheap fallbacks, then the course's own headings — it always answers
 * with a plan. Not charged to the student: the sheet's unit is reserved by
 * step 2 (app/api/studio/infographic), which reuses this plan from the
 * generation ledger and generates the image.
 *
 * Lives under /api/studio/infographic/ on purpose: the feature's kill switch
 * (middleware, lib/feature-flags.ts INFOGRAPHIC_API) covers it.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-infographic-prompt:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { courseId } = (body ?? {}) as { courseId?: unknown };
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  try {
    const { data: course, error: courseError } = await getSupabaseAdmin()
      .from("studio_courses")
      .select("id, title, explication, raw_text")
      .eq("id", courseId)
      .eq("user_id", user.id)
      .maybeSingle<CourseRow>();

    if (courseError) {
      return NextResponse.json({ success: false, error: `Lecture échouée : ${courseError.message}` }, { status: 500 });
    }
    if (!course) {
      return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
    }

    const sourceText = ficheSourceText(course);
    if (!sourceText) {
      return NextResponse.json({ success: false, error: "Ce cours n'a pas assez de contenu source pour générer une fiche de synthèse." }, { status: 400 });
    }

    const { outline, source } = await extractFicheOutline({ courseTitle: course.title, sourceText, contentHash: ficheContentHash(sourceText) });
    return NextResponse.json({ success: true, outline, source, prompt: buildFicheSynthesePrompt(outline) });
  } catch (error) {
    console.error("[studio/infographic/prompt] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
