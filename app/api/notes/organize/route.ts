import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { callOpenRouter, CHEAP_MODEL, OpenRouterError } from "@/lib/ai/openrouter";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
// Was 60 — fine for a short note, but a long output (see MAX_OUTPUT_TOKENS
// below) genuinely needs more wall-clock room to generate.
export const maxDuration = 180;

// The output cap used to be a flat 4096 tokens no matter how much a student
// wrote — a real problem reported directly: students who fill a long note
// then click "Organiser avec l'IA" got a cut-off reorganization, because the
// HTML output (headings, tables, inline styles) runs noticeably LARGER in
// tokens than the plain-text input it restructures. Scaled to the actual
// input size instead: ~1 token per 3.2 characters (a reasonable French-text
// estimate) plus a 1.7x allowance for HTML markup overhead, floored at the
// old 4096 (a short note shouldn't get a smaller budget than before) and
// capped safely under CHEAP_MODEL's (deepseek-v3.2) real 65,536-token
// completion ceiling, confirmed live against
// GET https://openrouter.ai/api/v1/models — re-verify if CHEAP_MODEL changes.
const MIN_OUTPUT_TOKENS = 4_096;
const MAX_OUTPUT_TOKENS = 32_000;
const CHARS_PER_TOKEN_ESTIMATE = 3.2;
const HTML_MARKUP_OVERHEAD = 1.7;

function computeOrganizeMaxTokens(inputLength: number): number {
  const estimated = Math.ceil((inputLength / CHARS_PER_TOKEN_ESTIMATE) * HTML_MARKUP_OVERHEAD);
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, estimated));
}

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
6. Ne renvoie AUCUN texte en dehors du code HTML. Ne mets pas de balise de bloc de code (pas de \`\`\`html au début ou à la fin). Donne juste le HTML directement.
7. FRAGMENT UNIQUEMENT, JAMAIS UN DOCUMENT COMPLET : ta réponse est insérée TELLE QUELLE à l'intérieur d'une page existante. Ne génère JAMAIS <!DOCTYPE>, <html>, <head>, <title>, <style>, ni <body> — ces balises casseraient la mise en page de l'éditeur. Ne définis AUCUNE règle CSS dans une balise <style> et n'utilise AUCUNE classe CSS (pas de class="...") : la SEULE façon de styliser un élément est l'attribut "style" en ligne directement sur cet élément, exactement comme dans l'exemple de la règle 4. Commence directement par le premier <h2> ou <p> du contenu, sans aucune balise englobante avant.`;

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
      // CHEAP_MODEL — see its own extensive comment in lib/ai/openrouter.ts.
      // Personalized, per-student, UNCACHED. Tested with one real call
      // AFTER hardening ORGANIZE_SYSTEM_PROMPT's rule 7 (a real defect
      // found here first: returned a full HTML document instead of a
      // fragment) — confirmed fixed, clean fragment output, medically
      // accurate reorganization — a knowingly-accepted tradeoff on a small
      // sample, per the product owner's own explicit "runway over accuracy
      // margin" decision.
      { maxTokens: computeOrganizeMaxTokens(content.length), model: CHEAP_MODEL }
    );

    const organizedContent = raw.replace(/^```html\s*/i, "").replace(/```\s*$/i, "");
    return NextResponse.json({ organizedContent });
  } catch (error) {
    const status = error instanceof OpenRouterError ? error.status : 500;
    console.error("[notes:organize] Échec de l'organisation par l'IA:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status });
  }
}
