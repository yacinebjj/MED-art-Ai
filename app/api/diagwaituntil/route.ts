import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { claimJob, completeJob, readJob } from "@/lib/studio-job-store";

// TEMPORARY DIAGNOSTIC ROUTE — deleted after use. Zero AI cost (pure sleep,
// no OpenRouter call at all).
//
// Tests a specific, previously UNVERIFIED assumption: that `waitUntil`
// background work on this exact Vercel account/plan actually gets the full
// `maxDuration` a route declares, the same as ordinary foreground work. This
// was never independently confirmed — only the FOREGROUND ceiling was ever
// empirically tested (app/api/diagsleep, earlier this session, confirmed
// 250s+ foreground). Two consecutive rounds of shrinking real Explication
// work (CHUNKED_SLICE_CHARS 30,000 -> 15,000, then a prompt fix removing an
// unconditional 8000+-word-per-part instruction) failed to stop the
// background job from timing out at ~280-330s — consistent with `waitUntil`
// having a REAL ceiling shorter than the declared maxDuration=280, not with
// the actual work still being too big.
//
// Mirrors the EXACT production mechanism (claimJob/waitUntil/completeJob
// from lib/studio-job-store.ts) with a plain sleep() as the "work" instead
// of a real generateExplicationPart call — true apples-to-apples, not a
// synthetic approximation.
export const runtime = "nodejs";
export const maxDuration = 280;
export const dynamic = "force-dynamic";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const supabase = getSupabaseAdmin();
  const sleepMs = Number(request.nextUrl.searchParams.get("sleepMs") ?? "60000");
  const jobId = request.nextUrl.searchParams.get("jobId") ?? `test-${sleepMs}`;
  const jobPath = `diag/waituntil/${jobId}.json`;

  const claim = await claimJob<{ ok: true; sleptMs: number }>(supabase, jobPath);
  if (!claim.claimed) {
    return NextResponse.json({ jobId, sleepMs, claimed: false, existing: claim.existing });
  }

  const startedAt = Date.now();
  waitUntil(
    sleep(sleepMs).then(() => completeJob(supabase, jobPath, { ok: true, sleptMs: Date.now() - startedAt }))
  );

  return NextResponse.json({ jobId, sleepMs, claimed: true, status: "pending" });
}

export async function POST(request: NextRequest) {
  // Poll-only variant — just reads the job, no claim/restart. Lets the
  // caller check status repeatedly without racing claimJob's own staleness
  // logic against a genuinely still-running test.
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const supabase = getSupabaseAdmin();
  const { jobId } = (await request.json().catch(() => ({}))) as { jobId?: string };
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });
  const jobPath = `diag/waituntil/${jobId}.json`;
  const job = await readJob(supabase, jobPath);
  return NextResponse.json({ jobId, job });
}
