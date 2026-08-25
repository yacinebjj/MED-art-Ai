import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { callOpenRouter, HAIKU_MODEL, OpenRouterError } from "@/lib/ai/openrouter";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Reformats a student's free-form note into structured HTML (headings,
 * lists, tables, inline color highlights) via the standard OpenRouter
 * wrapper. Called from the /dashboard/notes editor's "Organiser avec l'IA"
 * action — this route was previously reachable as
 * app/api/notes/organize/route.ts/route.ts (a directory literally named
 * "route.ts" containing the real file), which Next.js never resolved to
 * POST /api/notes/organize.
 */
const ORGANIZE_SYSTEM_PROMPT = `Tu es un assistant médical expert pour les étudiants en médecine.
Ton rôle est de restructurer et d'organiser les notes de brouillon fournies par l'étudiant.

Consignes STRICTES :
1. Tu dois retourner UNIQUEMENT du code HTML pur. N'utilise JAMAIS de Markdown (pas de ##, pas de **).
2. Utilise les balises HTML sémantiques : <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em>.
3. Si tu vois des comparaisons ou des listes de symptômes/traitements, crée des tableaux HTML propres (<table>, <thead>, <tr>, <th>, <tbody>, <td>).
4. Ajoute des couleurs discrètes et professionnelles en utilisant des styles inline pour mettre en évidence ce qui est important (ex: <span style="color: #059669; font-weight: bold;"> pour le traitement, <span style="color: #e11d48; font-weight: bold;"> pour les alertes/symptômes graves).
5. Garde l'exactitude médicale stricte.
6. Ne renvoie AUCUN texte en dehors du code HTML. Ne mets pas de balise de bloc de code (pas de \`\`\`html au début ou à la fin). Donne juste le HTML directement.`;

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`notes-organize:${user.id}`, RATE_LIMITS.ai);
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
        { role: "system", content: ORGANIZE_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      { maxTokens: 4096, model: HAIKU_MODEL }
    );

    const organizedContent = raw.replace(/^```html\s*/i, "").replace(/```\s*$/i, "");
    return NextResponse.json({ organizedContent });
  } catch (error) {
    const status = error instanceof OpenRouterError ? error.status : 500;
    console.error("[notes:organize] Échec de l'organisation par l'IA:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status });
  }
}
