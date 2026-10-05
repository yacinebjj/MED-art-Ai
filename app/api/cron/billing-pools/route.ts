import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { expireOverduePools } from "@/lib/billing-pools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Closes pooled purchases past their 7-day deadline and creates their
 * refund requests. Expiry also runs lazily on every pool read, so this
 * cron (Vercel: GET with `Authorization: Bearer $CRON_SECRET`) only makes
 * the refund requests appear without waiting for someone to open a page.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ success: false, error: "CRON_SECRET n'est pas configurée sur le serveur." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ success: false, error: "Non autorisé." }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ success: false, error: "Supabase n'est pas configuré." }, { status: 500 });
  return NextResponse.json({ success: true, expired: await expireOverduePools() });
}
