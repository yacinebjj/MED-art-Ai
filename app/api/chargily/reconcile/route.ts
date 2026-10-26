import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reconcileUserPayments } from "@/lib/chargily-settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A few parallel Chargily lookups (10 s timeout each) plus the activation.
export const maxDuration = 30;

/** The billing page asks every ~5 s for 2 minutes after a payment: ~25 calls, with room for a reload. */
const RECONCILE_RATE_LIMIT = { limit: 40, windowMs: 5 * 60 * 1000 };

/**
 * POST — confirms the signed-in student's pending payments directly with
 * Chargily and activates the paid ones (lib/chargily-settlement.ts), so a
 * payment never waits on its webhook alone. Safe to call any number of times:
 * activation goes through the webhook's own once-only claim.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e) pour continuer." }, { status: 401 });
  }

  const rl = rateLimit(`chargily-reconcile:${user.id}`, RECONCILE_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  // The origin is only used for the links in a thank-you email (APP_URL wins when set).
  const result = await reconcileUserPayments(user.id, request.nextUrl.origin);
  return NextResponse.json({ success: true, ...result });
}
