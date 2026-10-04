import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { PLANS, type PlanId } from "@/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PaymentRow {
  id: string;
  plan: string;
  amount: number;
  currency: string;
  chargily_checkout_id: string;
  status: "pending" | "paid" | "failed" | "canceled";
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/billing/invoices — the signed-in student's own Chargily payments
 * (the `payments` table written at checkout and confirmed by the webhook),
 * newest first. Read-only; never exposes raw_payload.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: true, invoices: [] });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("payments")
    .select("id, plan, amount, currency, chargily_checkout_id, status, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[billing/invoices] Lecture échouée:", error.message);
    return NextResponse.json({ success: false, error: "Historique indisponible pour le moment." }, { status: 500 });
  }

  const invoices = ((data ?? []) as PaymentRow[]).map((row) => ({
    id: row.id,
    reference: row.chargily_checkout_id,
    planId: row.plan,
    planLabel: row.plan in PLANS ? PLANS[row.plan as PlanId].label : row.plan,
    amount: row.amount,
    currency: row.currency.toUpperCase(),
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.status === "paid" ? row.updated_at : null,
  }));

  return NextResponse.json({ success: true, invoices });
}
