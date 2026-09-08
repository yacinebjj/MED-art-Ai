import { NextRequest, NextResponse } from "next/server";

// TEMPORARY DIAGNOSTIC ROUTE — deleted before this fix is finalized. Exists
// only to empirically measure this specific Vercel project's REAL enforced
// serverless duration ceiling (which can be far tighter than any
// `maxDuration` this app's own code declares, depending on plan/Fluid
// Compute settings — never actually confirmed this session despite two
// prior rounds of timeout-tuning on explication-start/-part). Zero cost,
// zero side effects: no AI call, no DB write, just an awaited sleep for a
// caller-controlled duration, timestamped on both ends so the response
// itself proves whether the SERVER actually ran to completion or whether a
// platform-level kill happened first (in which case no JSON body — just
// Vercel's own generic gateway timeout page — ever arrives at all).
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const msParam = request.nextUrl.searchParams.get("ms");
  const ms = Math.min(Math.max(Number(msParam) || 5000, 0), 280_000);
  const start = Date.now();
  await new Promise((resolve) => setTimeout(resolve, ms));
  return NextResponse.json({ success: true, requestedMs: ms, actualMs: Date.now() - start, startedAt: start });
}
