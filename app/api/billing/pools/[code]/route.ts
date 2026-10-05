import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { getPoolView, joinLeaderSeat, normalizeInviteCode, PoolError, startPoolCheckout } from "@/lib/billing-pools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(error: unknown): NextResponse {
  if (error instanceof PoolError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  console.error("[billing/pools/code] failed:", error);
  return NextResponse.json({ success: false, error: "Une erreur est survenue. Réessaie dans un instant." }, { status: 500 });
}

/** GET: live tracker of one pooled purchase / group (by invite code). */
export async function GET(_request: NextRequest, { params }: { params: { code: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ success: false, error: "Supabase n'est pas configuré." }, { status: 500 });
  const code = normalizeInviteCode(params.code);
  if (!code) return NextResponse.json({ success: false, error: "Code d'invitation invalide." }, { status: 400 });
  try {
    return NextResponse.json({ success: true, pool: await getPoolView(code, user.id) });
  } catch (error) {
    return fail(error);
  }
}

/** POST { action: "checkout" } → Chargily URL for the student's share; { action: "join" } → takes a seat paid by a Groupe leader. */
export async function POST(request: NextRequest, { params }: { params: { code: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ success: false, error: "Supabase n'est pas configuré." }, { status: 500 });
  const rl = rateLimit(`billing-pool-action:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) return NextResponse.json({ success: false, error: "Trop de requêtes — réessaie dans quelques minutes." }, { status: 429 });
  const code = normalizeInviteCode(params.code);
  if (!code) return NextResponse.json({ success: false, error: "Code d'invitation invalide." }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  try {
    if (body?.action === "checkout") {
      const appUrl = process.env.APP_URL || request.nextUrl.origin;
      return NextResponse.json({ success: true, checkoutUrl: await startPoolCheckout(code, user, appUrl) });
    }
    if (body?.action === "join") {
      return NextResponse.json({ success: true, pool: await joinLeaderSeat(code, user.id) });
    }
    return NextResponse.json({ success: false, error: "Action inconnue." }, { status: 400 });
  } catch (error) {
    return fail(error);
  }
}
