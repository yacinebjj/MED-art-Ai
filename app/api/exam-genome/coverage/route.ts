import { NextRequest, NextResponse } from "next/server";
import { BLIDA_PROGRAMMES } from "@/lib/exam-genome/blida-catalog";
import { buildCoverage, completedAcademicYears, type CoveragePaper } from "@/lib/exam-genome/coverage";
import { selectAll } from "@/lib/exam-genome/db";
import { genomeContext, genomeErrorResponse } from "@/lib/exam-genome/http";

export const runtime = "nodejs";

interface CoverageRow {
  unit_code: string;
  academic_year: string;
  session: CoveragePaper["session"];
  sitting: CoveragePaper["sitting"];
  status: CoveragePaper["status"];
  question_count: number;
  keyed: number;
  verified: number;
}

/**
 * EXAM GENOME — Blida 1 Médecine coverage: for every exam unit of years 1-6,
 * the last `years` completed academic years (default 5) and every expected
 * paper (EMD1/EMD2 or the single paper, then the rattrapage), what the bank
 * holds, per year and per unit, and the gaps in the order contributions
 * should fill them. Signed-in students see it too: it is the "wanted" list
 * of what to bring. Query: ?years=5 (1-8), ?gaps=60 (max 500), ?year=3.
 */
export async function GET(request: NextRequest) {
  const ctx = await genomeContext();
  if (ctx instanceof NextResponse) return ctx;
  const params = request.nextUrl.searchParams;
  const yearsBack = Math.min(8, Math.max(1, Number(params.get("years")) || 5));
  const gapLimit = Math.min(500, Math.max(1, Number(params.get("gaps")) || 60));
  const onlyYear = Number(params.get("year")) || null;

  try {
    const rows = await selectAll<CoverageRow>(
      (from, to) => ctx.supabase.from("eg_paper_coverage").select("unit_code, academic_year, session, sitting, status, question_count, keyed, verified").range(from, to),
      "lecture de la couverture"
    );
    const papers: CoveragePaper[] = rows.map((r) => ({
      unitCode: r.unit_code,
      academicYear: r.academic_year,
      session: r.session,
      sitting: r.sitting,
      status: r.status,
      questionCount: r.question_count,
      keyedShare: r.question_count ? r.keyed / r.question_count : 0,
      verifiedShare: r.question_count ? r.verified / r.question_count : 0,
    }));
    const report = buildCoverage(papers, completedAcademicYears(new Date(), yearsBack));
    const inYear = <T extends { year: number }>(items: T[]) => (onlyYear ? items.filter((x) => x.year === onlyYear) : items);
    return NextResponse.json({
      success: true,
      scope: { faculty: "Faculté de Médecine — Université Saad Dahlab Blida 1", track: "Médecine", years: [1, 2, 3, 4, 5, 6] },
      academicYears: report.academicYears,
      totals: report.totals,
      byYear: inYear(report.byYear),
      byUnit: inYear(report.byUnit),
      gaps: report.gaps.filter((g) => !onlyYear || g.cell.year === onlyYear).slice(0, gapLimit),
      programmes: BLIDA_PROGRAMMES.map((p) => ({ year: p.year, legalReference: p.legalReference, validFrom: p.validFrom, programmeUrl: p.programmeUrl })),
      // The full matrix (≈ 490 cells) for the team's dashboard.
      ...(ctx.isAdmin ? { cells: report.cells.filter((c) => !onlyYear || c.year === onlyYear) } : {}),
    });
  } catch (error) {
    return genomeErrorResponse(error, "coverage");
  }
}
