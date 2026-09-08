import { NextRequest, NextResponse } from "next/server";
import { generateExplicationPart, computeExplicationSlices } from "@/lib/studio-explication-delta";
import { STUDIO_PROMPT_CONFIG } from "@/lib/ai/studio-prompts";

// TEMPORARY DIAGNOSTIC ROUTE — deleted before this fix is finalized.
// ?mode=real (default) calls the REAL generateExplicationPart (real prompt,
// real slicing, real callOpenRouter — including its custom OPENROUTER_DISPATCHER
// undici Agent), live inside this Vercel project's actual serverless
// environment. Confirmed live: this mode hung for the FULL 260s timeout and
// failed, even though the exact same request (same model, same prompt, same
// token budget) completed in ~7s when sent directly from outside Vercel.
// ?mode=plain bypasses callOpenRouter entirely and uses a bare, unmodified
// fetch() with no custom dispatcher/Agent — isolates whether
// OPENROUTER_DISPATCHER (a custom undici Agent, module-scoped, reused
// across invocations — a known failure class in serverless: a pooled
// connection going stale across a function freeze/thaw can hang instead of
// erroring) is the actual cause.
// No auth required — deliberately, since this is temporary/diagnostic-only
// and reads no real user data (synthetic content only, no DB access at all).
export const runtime = "nodejs";
export const maxDuration = 280;
// Without this, Next.js tries to STATICALLY PRE-RENDER this GET route at
// BUILD TIME — confirmed live, this fails the whole Vercel build (Next's
// OWN build-worker has a fixed 60s timeout, unrelated to Vercel runtime
// duration limits entirely).
export const dynamic = "force-dynamic";

const sourceParagraph =
  "Le muscle cardiaque, ou myocarde, est un tissu musculaire strié involontaire qui assure la fonction de pompe du cœur. Il se distingue du muscle squelettique par la présence de disques intercalaires et par son caractère syncytial fonctionnel. La contraction cardiaque est initiée par le nœud sinusal, qui génère un potentiel d'action se propageant à travers le système de conduction cardiaque, incluant le nœud auriculo-ventriculaire, le faisceau de His et les fibres de Purkinje. ";

function buildSourceText(): string {
  let sourceText = "";
  while (sourceText.length < 50_000) sourceText += sourceParagraph;
  return sourceText.slice(0, 50_000);
}

async function runPlainFetch(sourceText: string) {
  const slices = computeExplicationSlices(sourceText);
  const chunks: string[] = [];
  for (let i = 0; i < slices[0].length; i += 2200) chunks.push(slices[0].slice(i, i + 2200));
  const numberedExtraits = chunks.map((c, j) => `Extrait ${j + 1}:\n${c}`).join("\n\n");
  const userMessage = `Voici le contenu source, découpé en extraits numérotés :\n"""\n${numberedExtraits}\n"""\n\nGénère le JSON demandé.`;

  const apiKey = process.env.OPENROUTER_API_KEY;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 260_000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek/deepseek-v3.2",
        messages: [
          { role: "system", content: STUDIO_PROMPT_CONFIG.explication.systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 20000,
        reasoning: { effort: "low" },
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, bodyLength: text.length, bodyStart: text.slice(0, 200) };
  } finally {
    clearTimeout(timeoutId);
  }
}

const DIAG_VERSION = "v4-ping-marker";

export async function GET(request: NextRequest) {
  const modeParam = request.nextUrl.searchParams.get("mode");
  // Instant, zero-cost freshness check — no OpenRouter call at all. Confirms
  // the LATEST deployed code (with mode=plain support) is actually live
  // before spending another real, ~260s+billed test cycle — a real,
  // repeated risk this session given Vercel deployment propagation has been
  // unexpectedly slow/inconsistent for this specific route.
  if (modeParam === "ping") {
    return NextResponse.json({ success: true, version: DIAG_VERSION, now: Date.now() });
  }
  const mode = modeParam === "plain" ? "plain" : "real";
  const t0 = Date.now();
  const sourceText = buildSourceText();
  const slices = computeExplicationSlices(sourceText);
  const t1 = Date.now();

  try {
    if (mode === "plain") {
      const result = await runPlainFetch(sourceText);
      const t2 = Date.now();
      return NextResponse.json({ success: true, mode, result, timings: { sliceComputeMs: t1 - t0, callMs: t2 - t1, totalMs: t2 - t0 } });
    }
    const partMarkdown = await generateExplicationPart(slices[0], STUDIO_PROMPT_CONFIG.explication.systemPrompt, 1, slices.length);
    const t2 = Date.now();
    return NextResponse.json({
      success: true,
      mode,
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
        mode,
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
        errorStatus: (error as { status?: number })?.status,
        timings: { sliceComputeMs: t1 - t0, failedAfterMs: t2 - t1, totalMs: t2 - t0 },
      },
      { status: 500 }
    );
  }
}
