import { NextResponse } from "next/server";
import { generateExplicationPart, computeExplicationSlices } from "@/lib/studio-explication-delta";
import { STUDIO_PROMPT_CONFIG } from "@/lib/ai/studio-prompts";

// TEMPORARY DIAGNOSTIC ROUTE — deleted before this fix is finalized. Calls
// the REAL generateExplicationPart (real prompt, real slicing, real
// callOpenRouter config) with SYNTHETIC source text, live inside this
// Vercel project's actual serverless environment, and returns detailed
// timing at every stage. Exists to isolate whether a Vercel function
// calling OpenRouter behaves differently than either (a) a bare Vercel
// function doing nothing but sleeping (already tested live, fine up to
// 250s+) or (b) a direct OpenRouter call from OUTSIDE Vercel entirely
// (already tested, ~7s) — the one combination neither prior test covered.
// No auth required — deliberately, since this is temporary/diagnostic-only
// and reads no real user data (synthetic content only, no DB access at all).
export const runtime = "nodejs";
export const maxDuration = 280;

const sourceParagraph =
  "Le muscle cardiaque, ou myocarde, est un tissu musculaire strié involontaire qui assure la fonction de pompe du cœur. Il se distingue du muscle squelettique par la présence de disques intercalaires et par son caractère syncytial fonctionnel. La contraction cardiaque est initiée par le nœud sinusal, qui génère un potentiel d'action se propageant à travers le système de conduction cardiaque, incluant le nœud auriculo-ventriculaire, le faisceau de His et les fibres de Purkinje. ";

export async function GET() {
  const t0 = Date.now();
  let sourceText = "";
  while (sourceText.length < 50_000) sourceText += sourceParagraph;
  sourceText = sourceText.slice(0, 50_000);

  const slices = computeExplicationSlices(sourceText);
  const t1 = Date.now();

  try {
    const partMarkdown = await generateExplicationPart(slices[0], STUDIO_PROMPT_CONFIG.explication.systemPrompt, 1, slices.length);
    const t2 = Date.now();
    return NextResponse.json({
      success: true,
      totalParts: slices.length,
      partMarkdownLength: partMarkdown.length,
      partMarkdownStart: partMarkdown.slice(0, 200),
      timings: { sliceComputeMs: t1 - t0, generateExplicationPartMs: t2 - t1, totalMs: t2 - t0 },
    });
  } catch (error) {
    const t2 = Date.now();
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
        errorStatus: (error as { status?: number })?.status,
        timings: { sliceComputeMs: t1 - t0, failedAfterMs: t2 - t1, totalMs: t2 - t0 },
      },
      { status: 500 }
    );
  }
}
