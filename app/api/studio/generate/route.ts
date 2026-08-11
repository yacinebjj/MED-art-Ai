import { NextRequest, NextResponse } from "next/server";
import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import { callGemini, GeminiError } from "@/lib/ai/gemini";
import { generateIdeogramImage, IdeogramError } from "@/lib/ai/ideogram";
import { STUDIO_MODEL, STUDIO_BYPASS_MOCK, STUDIO_PROMPT_CONFIG, STUDIO_SECTION_KEYS, buildStudioSystemPrompt } from "@/lib/ai/studio-prompts";
import { STUDIO_SCHEMAS } from "@/lib/ai/studio-schemas";
import { errorMessage, MAX_SOURCE_CHARS, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import type { DemoSectionId } from "@/lib/demo-content";

export const runtime = "nodejs";
// Explication/QCM/exemples_analogies routinely run 1-3+ minutes at
// maxTokens=32000. Only relevant if/when this is deployed to Vercel — its
// serverless functions are killed at a per-plan duration cap (as low as 10s
// on Hobby) regardless of anything in this file, which would otherwise cut
// these off well before OpenRouter responds. No effect on `next dev` or
// other hosts, which have no such cap.
export const maxDuration = 300;

const VALID_ACTION_TYPES = Object.keys(STUDIO_PROMPT_CONFIG) as DemoSectionId[];

function isValidActionType(value: unknown): value is DemoSectionId {
  return typeof value === "string" && (VALID_ACTION_TYPES as string[]).includes(value);
}

/**
 * Generates one Studio tile's content for the generic curriculum module
 * workspace (app/dashboard/module/[id]/page.tsx), from whatever text
 * /api/upload just extracted. Stateless and unauthenticated-to-Supabase on
 * purpose — see lib/ai/studio-prompts.ts's header comment. Returns the
 * validated, structured JSON for that tile (never Markdown) — the caller
 * renders it directly with the exact same components Pleurésie/Gastrite use
 * (GastriteResumeStudio, GastriteCasCliniqueStudio, GastriteQcmsStudio in
 * preview mode) for résumé/cas clinique/QCM. Mind Map is a Golden Standard
 * hybrid (v7, the restored v5): the {nodes, links} graph is always
 * returned and rendered as HTML by DynamicMindMapStudio (never dependent on
 * an external service); a real Ideogram image is ADDITIONALLY generated
 * from the model's own text-free "ideogram_prompt" and attached as
 * `ideogramImageUrl` — but that call fails OPEN (see below), so a flaky or
 * erroring Ideogram request never blocks the reliable board. A v6 attempt
 * at baking the whole poster's text into one Ideogram image was tried for
 * real and reverted after producing garbled, unreadable output — see
 * lib/ai/studio-prompts.ts's header comment for the full history.
 *
 * Parsing/validation mirrors lib/course-generation-shared.ts's proven
 * production pipeline (strip Markdown fences → JSON.parse → extract the
 * section's own key → strip Postgres-unsafe control chars) and adds a zod
 * pass on top (lib/ai/studio-schemas.ts) — deep structural validation the
 * production pipeline doesn't have, since a malformed shape here would
 * otherwise reach a real React component instead of a database column.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-generate:${user.id}`, RATE_LIMITS.ai);
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

  const { actionType, documentContext } = (body ?? {}) as { actionType?: unknown; documentContext?: unknown };

  if (!isValidActionType(actionType)) {
    return NextResponse.json(
      { success: false, error: `'actionType' invalide. Valeurs acceptées : ${VALID_ACTION_TYPES.join(", ")}.` },
      { status: 400 }
    );
  }
  if (typeof documentContext !== "string" || documentContext.trim().length < 50) {
    return NextResponse.json({ success: false, error: "'documentContext' est requis (texte extrait d'un PDF, ≥ 50 caractères)." }, { status: 400 });
  }

  const truncatedContext = documentContext.slice(0, MAX_SOURCE_CHARS);
  const { maxTokens } = STUDIO_PROMPT_CONFIG[actionType];
  const sectionKey = STUDIO_SECTION_KEYS[actionType];

  // Architecture voulue par le client : le texte intégral du cours est
  // injecté DANS le system prompt (pas dans un message user séparé) — voir
  // buildStudioSystemPrompt. Le message user reste minimal, juste le
  // déclencheur final de génération.
  // Mind Map structuring runs on Gemini instead of OpenRouter/Claude (client
  // request, GEMINI_API_KEY) — every other tile is untouched, still Claude
  // via OpenRouter. buildStudioSystemPrompt already bakes the course text
  // into ONE system-prompt string (this app's established architecture, see
  // that function's own comment), so it's passed straight through as
  // Gemini's systemInstruction with the same minimal trigger user message.
  let raw: string;
  try {
    if (actionType === "mind_map") {
      raw = await callGemini(buildStudioSystemPrompt(actionType, truncatedContext), "Génère le contenu demandé.", { maxTokens });
    } else {
      raw = await callOpenRouter(
        [
          { role: "system", content: buildStudioSystemPrompt(actionType, truncatedContext) },
          { role: "user", content: "Génère le contenu demandé." },
        ],
        { model: STUDIO_MODEL, maxTokens, bypassMock: STUDIO_BYPASS_MOCK }
      );
    }
  } catch (error) {
    if (error instanceof OpenRouterError || error instanceof GeminiError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error(`[studio/generate:${actionType}] Échec appel IA:`, error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }

  try {
    const parsed = parseJsonResponse(raw);
    const value = parsed[sectionKey];
    if (value === undefined || value === null) {
      console.error(`[studio/generate:${actionType}] Clé "${sectionKey}" absente. Clés reçues :`, Object.keys(parsed));
      throw new Error(`La réponse de l'IA ne contient pas la clé "${sectionKey}".`);
    }

    const sanitized = sanitizeForPostgres(value);
    const schema = STUDIO_SCHEMAS[actionType];
    const result = schema.safeParse(sanitized);
    if (!result.success) {
      console.error(`[studio/generate:${actionType}] Validation zod échouée :`, result.error.flatten());
      throw new Error(`La réponse de l'IA pour "${actionType}" ne respecte pas le schéma attendu.`);
    }

    let data: unknown = result.data;
    if (actionType === "mind_map") {
      // Fails OPEN: the {nodes, links} graph above is already valid and
      // renderable on its own. An Ideogram outage/error must never turn a
      // perfectly good graph into a 502 for the whole tile — it just means
      // no bonus illustration this time (ideogramImageUrl stays null).
      const mindMap = result.data as { ideogram_prompt: string };
      let ideogramImageUrl: string | null = null;
      try {
        ideogramImageUrl = await generateIdeogramImage(mindMap.ideogram_prompt);
      } catch (error) {
        if (error instanceof IdeogramError) {
          console.error(`[studio/generate:mind_map] Ideogram a échoué (${error.status}) — graphe conservé sans image :`, error.message);
        } else {
          console.error("[studio/generate:mind_map] Ideogram a échoué (exception) — graphe conservé sans image :", errorMessage(error));
        }
      }
      data = { ...mindMap, ideogramImageUrl };
    }

    return NextResponse.json({ success: true, actionType, data });
  } catch (error) {
    console.error(`[studio/generate:${actionType}] Parsing/validation échoué :`, error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }
}
