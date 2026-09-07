import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { callOpenRouter, CHEAP_MODEL, OpenRouterError } from "@/lib/ai/openrouter";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUMMARIZE_SYSTEM_PROMPT = `Tu es un assistant médical expert pour les étudiants en médecine.
On te donne une note brute écrite par un étudiant. Génère un résumé "TL;DR" très court de cette note.

Consignes STRICTES :
1. Réponds UNIQUEMENT avec un JSON valide de la forme exacte {"summary": "..."} — aucun texte autour, aucun markdown.
2. Le résumé fait 3 à 5 lignes maximum, en texte brut (pas de HTML, pas de Markdown), phrases courtes.
3. Garde uniquement l'essentiel médical — ce qu'un étudiant doit retenir en un coup d'œil avant un examen.
4. Garde l'exactitude médicale stricte. Si la note ne contient rien de médical, résume-la telle quelle.`;

/**
 * On-demand, ephemeral TL;DR for the note currently open in the editor —
 * click-only (the "Résumé" sparkle button in the editor toolbar), never
 * persisted (no new column on user_notes, nothing cached server-side).
 * Mirrors app/api/notes/organize/route.ts's exact pattern (stateless: takes
 * `content` directly, no note lookup by id needed) — same rate-limit-only
 * gating, no quota reservation, matching that sibling feature's own choice.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`notes-summarize:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { content } = (body ?? {}) as { content?: unknown };
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Le contenu est vide." }, { status: 400 });
  }

  try {
    const raw = await callOpenRouter(
      [
        { role: "system", content: SUMMARIZE_SYSTEM_PROMPT },
        { role: "user", content: content.slice(0, 12_000) },
      ],
      { maxTokens: 400, model: CHEAP_MODEL, timeoutMs: 30_000 }
    );

    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(cleaned) as { summary?: unknown };
    if (typeof parsed.summary !== "string" || !parsed.summary.trim()) {
      throw new Error("Réponse IA invalide.");
    }

    return NextResponse.json({ summary: parsed.summary.trim() });
  } catch (error) {
    const status = error instanceof OpenRouterError ? error.status : 500;
    console.error("[notes:summarize] Échec du résumé IA:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status });
  }
}
