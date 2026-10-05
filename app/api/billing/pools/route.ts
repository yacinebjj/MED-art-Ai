import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { isBillingCycle } from "@/lib/pricing";
import { createPooledPurchase, listMyPools, PoolError } from "@/lib/billing-pools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: the student's pooled purchases / group seats. POST { kind, cycle }: starts a pooled Promo or Groupe and returns its invite code. */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ success: false, error: "Supabase n'est pas configuré." }, { status: 500 });
  try {
    return NextResponse.json({ success: true, pools: await listMyPools(user.id) });
  } catch (error) {
    if (error instanceof PoolError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    console.error("[billing/pools] list failed:", error);
    return NextResponse.json({ success: false, error: "Lecture impossible pour le moment." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ success: false, error: "Supabase n'est pas configuré." }, { status: 500 });
  const rl = rateLimit(`billing-pools:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) return NextResponse.json({ success: false, error: "Trop de requêtes — réessaie dans quelques minutes." }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { kind?: unknown; cycle?: unknown } | null;
  const kind = body?.kind;
  const cycle = body?.cycle;
  if ((kind !== "promo" && kind !== "group") || !isBillingCycle(cycle)) {
    return NextResponse.json({ success: false, error: "Formule invalide." }, { status: 400 });
  }
  try {
    const code = await createPooledPurchase(user.id, kind, cycle);
    return NextResponse.json({ success: true, code });
  } catch (error) {
    if (error instanceof PoolError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    console.error("[billing/pools] create failed:", error);
    return NextResponse.json({ success: false, error: "Impossible de créer le groupe pour le moment." }, { status: 500 });
  }
}
