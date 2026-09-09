import { NextRequest, NextResponse } from "next/server";

// TEMPORARY DIAGNOSTIC ROUTE — deleted after use. Zero cost, zero side
// effects (no AI call, no DB write).
//
// Investigates a real production failure: explication-part/route.ts (which
// declares maxDuration=280, and internally aborts its own OpenRouter call at
// EXPLICATION_PART_TIMEOUT_MS=260_000, leaving a nominal 20s margin) was
// observed to fail with "flux terminé sans résultat après 281s" — the
// stream ended cleanly with zero result line ever written, meaning
// something killed the whole function before its own catch/finally could
// run and flush an error line.
//
// The EARLIER diagnostic (app/api/diagsleep, deleted) tested sleeps up to
// 280s but declared maxDuration=300 — a 20s buffer baked into THAT test
// itself. It never tested the scenario that actually matters: a route whose
// maxDuration is set to EXACTLY 280 (like the real route), running a sleep
// that approaches or exceeds that same number. This route mirrors the real
// route's exact maxDuration to get an apples-to-apples answer: does Vercel
// kill this account's functions with more precision/margin than the
// previous test assumed, and is 260s of actual work + normal overhead
// genuinely safe under a maxDuration=280 ceiling?
export const runtime = "nodejs";
export const maxDuration = 280;

export async function GET(request: NextRequest) {
  const msParam = request.nextUrl.searchParams.get("ms");
  const ms = Math.min(Math.max(Number(msParam) || 5000, 0), 295_000);
  const start = Date.now();
  await new Promise((resolve) => setTimeout(resolve, ms));
  return NextResponse.json({ success: true, requestedMs: ms, actualMs: Date.now() - start, startedAt: start });
}
