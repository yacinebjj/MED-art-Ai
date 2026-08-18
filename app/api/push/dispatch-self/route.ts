import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { dispatchFlashcardPushToUser } from "@/lib/push/dispatch";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";

/**
 * The "client interval fallback" for whoever doesn't have a real cron
 * wired to app/api/push/dispatch yet — a signed-in student's own open tab
 * can call this on an hourly client-side timer (see
 * lib/push/client-fallback.ts) to send THEMSELVES a push, no shared secret
 * involved (auth comes from the student's own session cookie, exactly like
 * every other authenticated route in this app). This can never substitute
 * for the real cron: it only fires while that student happens to have a
 * tab open, which defeats half the point of push (delivery with the
 * browser closed) — it's a best-effort stand-in, not the real mechanism.
 */
export async function POST(_request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`push-dispatch-self:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  try {
    const sent = await dispatchFlashcardPushToUser(user.id);
    return NextResponse.json({ success: true, sent });
  } catch (error) {
    console.error("[push/dispatch-self] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
