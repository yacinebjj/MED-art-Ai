import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { callOpenRouter, CHEAP_MODEL, OpenRouterError } from "@/lib/ai/openrouter";
import { errorMessage, parseJsonResponse } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const maxDuration = 60;

const INSIGHTS_SYSTEM_PROMPT = `Tu es un assistant médical qui aide un étudiant à réviser à partir de ses Smart Notes (déjà structurées à partir d'un cours audio).

Génère deux choses à partir de ces notes :
1. "keywords" : 5 à 8 mots-clés ou termes médicaux courts, exactement comme ils apparaissent dans les notes (jamais inventés).
2. "quiz" : 3 à 5 questions à choix multiples (QCM) courtes pour tester la compréhension du cours, basées UNIQUEMENT sur le contenu réel des notes fournies.

Consignes STRICTES :
1. Réponds UNIQUEMENT avec un JSON valide de la forme exacte {"keywords": ["...", ...], "quiz": [{"question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "explanation": "..."}]} — aucun texte autour, aucun markdown.
2. Chaque question a exactement 4 options, une seule correcte (correctIndex, 0-indexé).
3. "explanation" est une phrase courte justifiant la bonne réponse, basée sur les notes.
4. Ne fabrique JAMAIS un fait médical absent des notes fournies — une question doit être vérifiable directement dans le texte donné.`;

/**
 * On-demand, ephemeral "QCM Éclair + mots-clés" for a just-generated (or
 * reopened) Smart Notes result — click only, nothing persisted (no new
 * table/column, no SRS/Leitner tracking — this is throwaway practice, never
 * routed through the real qcm_attempts pipeline). Mirrors this app's other
 * light on-demand AI add-ons (notes summarize, Studio clinical-connections):
 * rate-limit only, no quota reservation, CHEAP_MODEL tier.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`lecture-notes-insights:${user.id}`, RATE_LIMITS.ai);
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

  const { smartNotes } = (body ?? {}) as { smartNotes?: unknown };
  if (typeof smartNotes !== "string" || !smartNotes.trim()) {
    return NextResponse.json({ success: false, error: "'smartNotes' est requis." }, { status: 400 });
  }

  try {
    const raw = await callOpenRouter(
      [
        { role: "system", content: INSIGHTS_SYSTEM_PROMPT },
        { role: "user", content: smartNotes.slice(0, 12_000) },
      ],
      { model: CHEAP_MODEL, maxTokens: 1500, timeoutMs: 30_000 }
    );

    const parsed = parseJsonResponse(raw) as { keywords?: unknown; quiz?: unknown };
    const keywords = parsed.keywords;
    const quiz = parsed.quiz;

    if (!Array.isArray(keywords) || !keywords.every((k) => typeof k === "string")) {
      throw new Error("Réponse IA invalide (mots-clés).");
    }
    if (
      !Array.isArray(quiz) ||
      quiz.length === 0 ||
      !quiz.every(
        (q) =>
          q &&
          typeof q.question === "string" &&
          Array.isArray(q.options) &&
          q.options.length === 4 &&
          q.options.every((o: unknown) => typeof o === "string") &&
          typeof q.correctIndex === "number" &&
          q.correctIndex >= 0 &&
          q.correctIndex <= 3 &&
          typeof q.explanation === "string"
      )
    ) {
      throw new Error("Réponse IA invalide (quiz).");
    }

    return NextResponse.json({ success: true, keywords: keywords.slice(0, 8), quiz: quiz.slice(0, 5) });
  } catch (error) {
    const status = error instanceof OpenRouterError ? error.status : 500;
    console.error("[lecture-notes:insights] Échec:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}
