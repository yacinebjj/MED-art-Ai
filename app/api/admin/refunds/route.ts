import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { isBillingAdmin, listRefundRequests, markRefundSent, PoolError } from "@/lib/billing-pools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refund requests created automatically when a pooled Promo / Groupe misses
 * its deadline (or a payment lands on a full pool). Chargily has no refund
 * API: the team sends the money back, then marks the request here.
 * Admins = MEDART_ADMIN_EMAILS.
 */
async function guard(): Promise<{ email: string } | NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  if (!isBillingAdmin(user.email)) return NextResponse.json({ success: false, error: "Accès réservé à l'administration." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ success: false, error: "Supabase n'est pas configuré." }, { status: 500 });
  return { email: user.email ?? "" };
}

function fail(error: unknown): NextResponse {
  const status = error instanceof PoolError ? error.status : 500;
  return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Erreur." }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await guard();
  if (auth instanceof NextResponse) return auth;
  const raw = request.nextUrl.searchParams.get("status");
  const status = raw === "refunded" || raw === "all" ? raw : "pending";
  try {
    return NextResponse.json({ success: true, requests: await listRefundRequests(status) });
  } catch (error) {
    return fail(error);
  }
}

/** POST { id, note? }: the transfer was made — mark the request as refunded. */
export async function POST(request: NextRequest) {
  const auth = await guard();
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as { id?: unknown; note?: unknown } | null;
  if (typeof body?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) {
    return NextResponse.json({ success: false, error: "Demande invalide." }, { status: 400 });
  }
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  try {
    await markRefundSent(body.id, auth.email, note);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
