import { NextRequest, NextResponse } from "next/server";
import { dispatchFlashcardPushToAllUsers } from "@/lib/push/dispatch";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The REAL hourly dispatch — meant to be called by an external trigger you
 * configure once you deploy, not by anything inside this app:
 *   - Vercel Cron: add to vercel.json —
 *     { "crons": [{ "path": "/api/push/dispatch", "schedule": "0 * * * *" }] }
 *     (Vercel automatically sends `Authorization: Bearer $CRON_SECRET` when
 *     CRON_SECRET is set as an env var — check your plan's minimum cron
 *     interval before assuming hourly is available.)
 *   - Any other host: an external cron/uptime service (GitHub Actions
 *     scheduled workflow, cron-job.org, etc.) hitting this URL once an hour
 *     with that same header.
 * No code here can make this fire on a schedule by itself — a client-side
 * timer literally cannot substitute for this (Web Push's whole point is
 * delivery without a browser tab open); see app/api/push/dispatch-self for
 * the narrower, session-scoped fallback this app also offers.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: "CRON_SECRET n'est pas configurée sur le serveur." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Non autorisé." }, { status: 401 });
  }

  try {
    const result = await dispatchFlashcardPushToAllUsers();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[push/dispatch] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
