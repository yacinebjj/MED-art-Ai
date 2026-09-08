import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { refundGeneration } from "@/lib/subscription";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Called by the browser (lib/studio-explication-client.ts) EXACTLY ONCE per
 * generation attempt — ONLY after explication-start/route.ts confirmed
 * `reserved: true` AND the subsequent part loop / finalize ultimately failed
 * for good. Refunds the ONE quota unit explication-start reserved.
 *
 * This is a real, internet-reachable, authenticated endpoint, so it cannot
 * simply trust "the client says refund me" — a well-behaved client only ever
 * calls this when it has definitive proof of a reservation (see
 * lib/studio-explication-client.ts's own contract), but nothing stops a
 * request crafted OUTSIDE that client from hitting this route directly to
 * claim a refund it never earned. An earlier version of this route defended
 * against that with a check that turned out to be BYPASSABLE — "refuse to
 * refund if this course's `explication` column is already populated" is
 * true of every course that simply hasn't had Explication generated yet
 * (explication IS NULL until a first successful generation), so ANY of a
 * caller's own never-generated courses (or even a nonexistent courseId)
 * passed it, letting a direct call refund a unit that was never reserved at
 * all — confirmed by an adversarial code review of this exact route.
 *
 * The real fix (see supabase/schema.sql's own comment on
 * `explication_reservation_pending`): this route now atomically checks AND
 * clears a PER-COURSE flag that only ever gets set to true by
 * explication-start immediately after a genuine reservation succeeds. A
 * courseId with no outstanding reservation — whether never reserved at all,
 * already fulfilled, or already refunded once — has this flag false (or the
 * row doesn't exist/isn't owned by this user), and the conditioned UPDATE
 * below simply matches zero rows, so nothing is refunded. This also makes
 * a duplicate/concurrent abandon call for the same generation safely
 * idempotent (the second call finds the flag already cleared).
 *
 * Still rate-limited like every other AI-adjacent route, as defense in
 * depth, though the flag check alone is now sufficient to close the
 * exploit — a rate limit is no longer load-bearing for correctness here.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-generate-explication-abandon:${user.id}`, RATE_LIMITS.ai);
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
    return NextResponse.json({ success: false, error: "'courseId' est requis et doit être un nombre." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  // The WHERE clause IS the security check: this only matches (and only
  // then clears the flag) for a courseId this user owns AND that currently
  // has a genuinely outstanding reservation. Zero matches -> zero rows
  // updated -> no refund, regardless of what the caller claims.
  const { count, error } = await supabase
    .from("studio_courses")
    .update({ explication_reservation_pending: false }, { count: "exact" })
    .eq("id", courseId)
    .eq("user_id", user.id)
    .eq("explication_reservation_pending", true);

  if (error) {
    console.error("[explication-abandon] Échec vérification/nettoyage de la réservation:", error.message);
    return NextResponse.json({ success: false, error: `Vérification échouée : ${error.message}` }, { status: 500 });
  }
  if (!count) {
    // No outstanding reservation for this course — nothing to refund. Not
    // an error: an honest client can legitimately reach this state (e.g. a
    // slow finalize succeeding server-side just as the client's own timeout
    // independently fires abandon), and should not see a scary failure for
    // what is, from the student's perspective, actually a successful
    // generation.
    return NextResponse.json({ success: true, refunded: false });
  }

  await refundGeneration(user.id);
  return NextResponse.json({ success: true, refunded: true });
}
