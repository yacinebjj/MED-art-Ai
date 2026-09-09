import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { computeNextReview } from "@/lib/srs";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Records one QCM attempt and reschedules its next review via the Leitner
 * algorithm (lib/srs.ts). One row per (student, course, QCM) — a new
 * attempt UPDATEs that row rather than inserting a new one, so
 * next_review_at always reflects the latest state. Requires the
 * `qcm_attempts` table (see the architecture writeup for the SQL).
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { courseSlug, qcmId, isCorrect } = (body ?? {}) as { courseSlug?: unknown; qcmId?: unknown; isCorrect?: unknown };

  if (typeof courseSlug !== "string" || !courseSlug.trim()) {
    return NextResponse.json({ error: "Le champ 'courseSlug' est requis." }, { status: 400 });
  }
  if (typeof qcmId !== "string" && typeof qcmId !== "number") {
    return NextResponse.json({ error: "Le champ 'qcmId' est requis." }, { status: 400 });
  }
  if (typeof isCorrect !== "boolean") {
    return NextResponse.json({ error: "Le champ 'isCorrect' (booléen) est requis." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const qcmIdStr = String(qcmId);

  const { data: existing, error: fetchError } = await supabase
    .from("qcm_attempts")
    .select("leitner_box")
    .eq("user_id", user.id)
    .eq("course_slug", courseSlug)
    .eq("qcm_id", qcmIdStr)
    .maybeSingle();

  if (fetchError) {
    console.error("[srs/attempt] Échec lecture état existant:", { code: fetchError.code, message: fetchError.message });
    return NextResponse.json({ error: "Impossible de lire l'état actuel de ce QCM." }, { status: 500 });
  }

  const currentBox = existing?.leitner_box ?? 1;
  const { leitnerBox, nextReviewAt } = computeNextReview(currentBox, isCorrect);

  const { data, error } = await supabase
    .from("qcm_attempts")
    .upsert(
      {
        user_id: user.id,
        course_slug: courseSlug,
        qcm_id: qcmIdStr,
        is_correct: isCorrect,
        leitner_box: leitnerBox,
        next_review_at: nextReviewAt.toISOString(),
        attempted_at: new Date().toISOString(),
      },
      { onConflict: "user_id,course_slug,qcm_id" }
    )
    .select("leitner_box, next_review_at")
    .single();

  if (error) {
    console.error("[srs/attempt] Échec enregistrement:", { code: error.code, message: error.message, details: error.details });
    // SECURITY: was echoing the raw SQLSTATE code + Postgres error message to
    // the client — full detail already logged above for real diagnosis.
    return NextResponse.json({ error: "Enregistrement échoué. Réessaie." }, { status: 500 });
  }

  return NextResponse.json({ success: true, leitnerBox: data.leitner_box, nextReviewAt: data.next_review_at });
}
