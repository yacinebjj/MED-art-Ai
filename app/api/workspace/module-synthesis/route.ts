import { withHeartbeat } from "@/lib/heartbeat-route";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { runModuleSynthesis, type ModuleSynthesisType } from "@/lib/module-synthesis";
import { callOpenRouter, STUDIO_FAST_MODEL } from "@/lib/ai/openrouter";
import { SynthesisOptionsSchema, buildSynthesisTransformPrompt, needsSynthesisTransform, type SynthesisOptions } from "@/lib/synthesis-options";

/**
 * Personalizes a finished "Résumé Global" (format / focus / mnemonics) in ONE
 * extra pass over the stitched summary — the per-course chunks themselves
 * stay shared in the cross-student cache. Never fails the request: on any
 * error the full summary is returned and the client is told the
 * personalization was skipped.
 */
async function personalizeSummary(markdown: string, options: SynthesisOptions): Promise<{ content: string; personalized: boolean }> {
  try {
    const raw = await callOpenRouter(
      [
        { role: "system", content: buildSynthesisTransformPrompt(options) },
        { role: "user", content: markdown },
      ],
      // Markdown rewrite of an existing summary — Flash-Lite (fast, -60% output price), reasoning minimal.
      { model: STUDIO_FAST_MODEL, maxTokens: 8000, bypassMock: true, reasoning: { effort: "minimal" }, timeoutMs: 120_000 }
    );
    const cleaned = raw.replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/i, "").trim();
    return cleaned.length > 40 ? { content: cleaned, personalized: true } : { content: markdown, personalized: false };
  } catch (error) {
    console.warn("[workspace/module-synthesis] Personnalisation ignorée:", error instanceof Error ? error.message : error);
    return { content: markdown, personalized: false };
  }
}

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_TYPES: ModuleSynthesisType[] = ["global_summary", "keywords_table", "medical_dictionary"];
function isValidType(value: unknown): value is ModuleSynthesisType {
  return typeof value === "string" && (VALID_TYPES as string[]).includes(value);
}

/**
 * Thin wrapper — the real MODULAR CHUNK PIPELINE (Fetch All -> Isolate
 * Missing -> Generate Missing -> Save Missing -> Stitch All -> Cross-Course
 * Synthesis) now lives in lib/module-synthesis.ts, shared with
 * app/api/modules/[id]/global-summary's own POST handler (the simpler
 * "Résumé global" quick modal) so both entry points benefit from the same
 * per-course, cross-student cache. Body: { moduleId: number, courseIds:
 * number[], type: ModuleSynthesisType }.
 */
async function handlePost(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`workspace-module-synthesis:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { moduleId, courseIds, type, options: rawOptions } = (body ?? {}) as { moduleId?: unknown; courseIds?: unknown; type?: unknown; options?: unknown };

  // Résumé Global customization (format / focus / mnemonics) — optional.
  let options: SynthesisOptions | undefined;
  if (rawOptions !== undefined) {
    const parsed = SynthesisOptionsSchema.safeParse(rawOptions);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "'options' est invalide." }, { status: 400 });
    }
    options = parsed.data;
  }

  if (typeof moduleId !== "number" || !Number.isFinite(moduleId)) {
    return NextResponse.json({ success: false, error: "'moduleId' est requis et doit être un nombre." }, { status: 400 });
  }
  if (!Array.isArray(courseIds) || courseIds.length === 0 || !courseIds.every((id) => typeof id === "number")) {
    return NextResponse.json({ success: false, error: "'courseIds' est requis (tableau d'identifiants non vide)." }, { status: 400 });
  }
  if (!isValidType(type)) {
    return NextResponse.json({ success: false, error: `'type' invalide. Valeurs acceptées : ${VALID_TYPES.join(", ")}.` }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const outcome = await runModuleSynthesis(user, moduleId, courseIds, type);
  if (!outcome.ok) {
    return NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status });
  }

  if (type === "global_summary" && options && needsSynthesisTransform(options)) {
    const { content, personalized } = await personalizeSummary(outcome.result.content, options);
    return NextResponse.json({ success: true, ...outcome.result, content, personalized, personalizationSkipped: !personalized });
  }

  return NextResponse.json({ success: true, ...outcome.result });
}

/**
 * Defensive top-level backstop — runModuleSynthesis already returns a
 * discriminated union (never throws for an anticipated failure), but an
 * unexpected exception anywhere in this handler (auth, body parsing, the
 * validation checks above) would otherwise escape as an unhandled rejection
 * and surface as an opaque framework crash instead of this app's own
 * `{success:false, error}` JSON shape.
 */
async function guardedPost(request: NextRequest): Promise<NextResponse> {
  try {
    return await handlePost(request);
  } catch (error) {
    console.error("[workspace/module-synthesis] Exception non interceptée:", error);
    return NextResponse.json({ success: false, error: "Une erreur inattendue est survenue. Réessaie." }, { status: 500 });
  }
}

// Long-running: answers as a heartbeat NDJSON stream when the client asks for it (lib/heartbeat-route.ts).
export const POST = withHeartbeat(guardedPost);
