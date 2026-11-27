import { NextRequest, NextResponse } from "next/server";
import { raiseDbError } from "@/lib/exam-genome/db";
import { genomeContext, genomeErrorResponse } from "@/lib/exam-genome/http";
import { GENOME_PAPER_STATUSES } from "@/lib/exam-genome/scope";

export const runtime = "nodejs";

/**
 * EXAM GENOME — the team's review queue: papers by status (default
 * needs_review), newest first, optionally for one unit or one year.
 * Query: ?status=needs_review&unit=Y3-UEI1&year=3&limit=50&offset=0
 */
export async function GET(request: NextRequest) {
  const ctx = await genomeContext({ adminOnly: true });
  if (ctx instanceof NextResponse) return ctx;
  const params = request.nextUrl.searchParams;
  const status = params.get("status") ?? "needs_review";
  const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50));
  const offset = Math.max(0, Number(params.get("offset")) || 0);

  try {
    let query = ctx.supabase
      .from("eg_papers")
      .select("id, unit_code, year_level, academic_year, session, sitting, rotation, variant, provenance, status, duplicate_of, scope_verdict, legacy_programme, question_count, parse_confidence, parse_warnings, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if ((GENOME_PAPER_STATUSES as readonly string[]).includes(status)) query = query.eq("status", status);
    const unit = params.get("unit");
    if (unit && /^Y[1-6]-[A-Z0-9-]+$/.test(unit)) query = query.eq("unit_code", unit);
    const year = Number(params.get("year"));
    if (year >= 1 && year <= 6) query = query.eq("year_level", year);
    const { data, error, count } = await query;
    if (error) raiseDbError(error, "lecture de la file de relecture");
    return NextResponse.json({ success: true, total: count ?? 0, papers: data ?? [] });
  } catch (error) {
    return genomeErrorResponse(error, "papers");
  }
}
