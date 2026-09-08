import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { STUDIO_PROMPT_CONFIG } from "@/lib/ai/studio-prompts";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { computeExplicationSlices, generateExplicationPart } from "@/lib/studio-explication-delta";

export const runtime = "nodejs";
// 280s — comfortably inside this project's REAL enforced ceiling, which an
// empirical, zero-cost test (an awaited sleep, no AI call — see
// app/api/diagsleep, deleted after use) confirmed exceeds 250 seconds live.
// The previous value here (60s) was a DEFENSIVE GUESS against a possible
// tight platform ceiling that turned out not to apply to this project —
// see lib/studio-explication-delta.ts's EXPLICATION_PART_MAX_TOKENS HISTORY
// comment for the full incident: that guess, not a platform kill, was the
// actual cause of the repeated 504 (this route's OWN
// EXPLICATION_PART_TIMEOUT_MS aborting a genuinely-still-in-progress
// generation early). 280s gives generateExplicationPart's own 260s
// OpenRouter timeout real margin for JSON parsing / response serialization.
export const maxDuration = 280;

/**
 * Generation-only step of the client-driven, multi-request Explication
 * pipeline — see explication-start/route.ts for the reservation/cache/
 * cross-university-delta step that MUST run first, and
 * lib/studio-explication-delta.ts's ARCHITECTURE comment for the overall
 * design. This route touches NO quota (reserveGeneration/refundGeneration)
 * at all — deliberately: a real code-review-caught bug in an earlier version
 * had reservation happen HERE, inside the same request as the slow AI call,
 * which let the client's freely-repeated per-part retries silently reserve
 * quota multiple times for one delivered generation. Quota is reserved
 * exactly once, in explication-start, before this route is ever called.
 *
 * lib/studio-explication-client.ts calls this once per part, sequentially,
 * `partIndex = 0..totalParts-1`, retrying any individual part on a clean,
 * retryable failure (never re-running an already-succeeded part) — this is
 * now completely safe from a quota standpoint since this route never
 * reserves or refunds anything.
 *
 * Body: `{ courseId, partIndex, language?, customPrompt? }` — language/
 * customPrompt are re-sent on every part (not just part 0) since each part
 * is its own independent generation call needing the full system prompt.
 *
 * Response: `{ success: true, partIndex, totalParts, isLastPart, partMarkdown }`
 * on success, or `{ success: false, error }` on a clean, retryable failure —
 * never an unhandled crash or a silent hang.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-generate-explication-part:${user.id}`, RATE_LIMITS.ai);
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

  const { courseId, partIndex, language: languageRaw, customPrompt: customPromptRaw } = (body ?? {}) as {
    courseId?: unknown;
    partIndex?: unknown;
    language?: unknown;
    customPrompt?: unknown;
  };
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis et doit être un nombre." }, { status: 400 });
  }
  if (typeof partIndex !== "number" || !Number.isInteger(partIndex) || partIndex < 0) {
    return NextResponse.json({ success: false, error: "'partIndex' est requis et doit être un entier ≥ 0." }, { status: 400 });
  }

  const language: "fr" | "en" = languageRaw === "en" ? "en" : "fr";
  const customPrompt = typeof customPromptRaw === "string" ? customPromptRaw.trim().slice(0, 2000) : "";
  const languageInstruction =
    language === "en"
      ? "\n\nINSTRUCTION DE LANGUE OBLIGATOIRE (remplace toute langue de sortie précédemment implicite) : rédige l'INTÉGRALITÉ de ta réponse — tous les champs textuels du JSON, sans exception — en ANGLAIS, jamais en français, en conservant strictement le même niveau de rigueur médicale, la même structure JSON et le même format exact déjà exigés ci-dessus."
      : "";
  const customPromptInstruction = customPrompt
    ? `\n\nCONSIGNE PERSONNALISÉE DE L'ÉTUDIANT (à respecter en plus de tout ce qui précède, sans jamais sacrifier la rigueur médicale ni le format JSON exact déjà exigé) : ${customPrompt}`
    : "";

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data: courseRow, error: courseRowError } = await supabase
    .from("studio_courses")
    .select("raw_text")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle<{ raw_text: string | null }>();
  if (courseRowError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${courseRowError.message}` }, { status: 500 });
  }
  const resolvedSourceText = courseRow?.raw_text ?? null;
  if (!resolvedSourceText || resolvedSourceText.trim().length < 50) {
    return NextResponse.json(
      { success: false, error: "Impossible de retrouver le texte source de ce cours (≥ 50 caractères requis)." },
      { status: 400 }
    );
  }

  const slices = computeExplicationSlices(resolvedSourceText);
  const totalParts = slices.length;
  if (partIndex >= totalParts) {
    return NextResponse.json({ success: false, error: "'partIndex' hors limites." }, { status: 400 });
  }

  const systemPrompt = STUDIO_PROMPT_CONFIG.explication.systemPrompt + languageInstruction + customPromptInstruction;
  try {
    const partMarkdown = await generateExplicationPart(slices[partIndex], systemPrompt, partIndex + 1, totalParts);
    const isLastPart = partIndex === totalParts - 1;
    return NextResponse.json({ success: true, partIndex, totalParts, isLastPart, partMarkdown });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error(`[explication-part] Échec génération partie ${partIndex + 1}/${totalParts}:`, error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }
}
