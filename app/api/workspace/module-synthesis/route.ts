import { NextRequest, NextResponse } from "next/server";
import { requirePaidPlan } from "@/lib/subscription";
import { quotaBlockedResponse } from "@/lib/quota-response";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { runModuleSynthesis, type ModuleSynthesisType } from "@/lib/module-synthesis";
import { verifySynthesisRunToken } from "@/lib/synthesis-run-token";
import { callOpenRouter, STUDIO_MODEL, type ChatMessageInput } from "@/lib/ai/openrouter";
import { modelCallKey, runThroughLedger } from "@/lib/ai/generation-ledger";
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
    const messages: ChatMessageInput[] = [
      { role: "system", content: buildSynthesisTransformPrompt(options) },
      { role: "user", content: markdown },
    ];
    // STUDIO_MODEL (Qwen3-235B) since 2026-10-07; 180s because it decodes
    // slower than Gemini Flash did — still well under maxDuration.
    const callOptions = { model: STUDIO_MODEL, maxTokens: 8000, bypassMock: true, timeoutMs: 180_000, providerSort: "throughput" as const };
    // Same stitched summary + same options → replayed from the generation
    // ledger (0 tokens) instead of a new call. Quota was already reserved by
    // /plan, so this changes the bill only, never what the student pays.
    const raw = await runThroughLedger(
      {
        namespace: "module-synthesis:personalize",
        key: modelCallKey(messages, callOptions),
        peerWaitMs: 60_000,
        leaseMs: 200_000,
        isValid: (value) => typeof value === "string" && value.trim().length > 40,
      },
      () => callOpenRouter(messages, callOptions)
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
  const paidGate = await requirePaidPlan(user.id);
  if (!paidGate.allowed) return quotaBlockedResponse(paidGate);

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

  const { moduleId, courseIds, type, options: rawOptions, runToken } = (body ?? {}) as { moduleId?: unknown; courseIds?: unknown; type?: unknown; options?: unknown; runToken?: unknown };

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

  // runToken = final ASSEMBLE step of a client-driven run (plan → micro-batches
  // → assemble): quota was reserved by /plan and the per-course chunks were
  // generated by /batch, so this request only stitches and adds the
  // cross-course synthesis — seconds, not minutes.
  const prereserved = runToken !== undefined && verifySynthesisRunToken(runToken, user.id, moduleId, type);
  if (runToken !== undefined && !prereserved) {
    return NextResponse.json({ success: false, error: "Session de génération expirée — relance la synthèse." }, { status: 403 });
  }
  const outcome = await runModuleSynthesis(user, moduleId, courseIds, type, { prereserved });
  if (!outcome.ok) {
    return ("paywall" in outcome && outcome.paywall ? quotaBlockedResponse({ reason: outcome.error, paywall: outcome.paywall }, outcome.status) : NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status }));
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
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    return await handlePost(request);
  } catch (error) {
    console.error("[workspace/module-synthesis] Exception non interceptée:", error);
    return NextResponse.json({ success: false, error: "Une erreur inattendue est survenue. Réessaie." }, { status: 500 });
  }
}
