import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { callOpenRouter, CHEAP_MODEL, OpenRouterError, type ChatMessageInput } from "@/lib/ai/openrouter";
import { modelCallKey, runThroughLedger } from "@/lib/ai/generation-ledger";
import { errorMessage, parseJsonResponse } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
// Raised with the 2026-10 timeout pass: the model call may now run up to the value below, so maxDuration leaves headroom for one fast transient retry.
export const maxDuration = 120;

const CONNECTIONS_SYSTEM_PROMPT = `Tu es un médecin enseignant qui aide un étudiant en médecine à construire une carte mentale clinique entre les cours de son module.

On te donne le titre + un extrait du cours actuellement ouvert, et la liste des titres des AUTRES cours déjà présents dans ce même module (peut être vide).

Génère 2 à 4 "connexions cliniques" courtes et concrètes — chacune une phrase reliant ce cours à un autre cours du module (physiopathologie partagée, diagnostic différentiel, complication croisée, traitement commun...), OU si la liste des autres cours est vide, 2 à 4 connexions vers la pratique clinique générale de cette pathologie.

Consignes STRICTES :
1. Réponds UNIQUEMENT avec un JSON valide de la forme exacte {"connections": ["...", "..."]} — aucun texte autour, aucun markdown.
2. Chaque connexion fait une phrase, en français, concrète et médicalement exacte — jamais une généralité vague.
3. Si un autre cours du module est cité dans une connexion, utilise son titre exact tel que fourni.
4. Ne fabrique jamais un lien qui n'a pas de sens médical réel — mieux vaut une connexion de moins qu'une connexion fausse.`;

interface StudioCourseRow {
  id: number;
  title: string;
  raw_text: string;
  curriculum_module_id: number;
}

/**
 * On-demand, ephemeral "clinical connections" insight — click-only (the
 * sparkle button on the Explication tile), nothing persisted (no new
 * column, no cache table). Given a course, looks up its real sibling
 * courses in the same module (title only) and asks a cheap model for a few
 * short, real clinical links between them. Mirrors app/api/notes/organize
 * and app/api/notes/summarize's own pattern: rate-limit only, no quota
 * reservation, same CHEAP_MODEL tier.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-clinical-connections:${user.id}`, RATE_LIMITS.ai);
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

  const { courseId } = (body ?? {}) as { courseId?: unknown };
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis (nombre)." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: courseRow, error: courseError } = await supabase
    .from("studio_courses")
    .select("id, title, raw_text, curriculum_module_id")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (courseError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${courseError.message}` }, { status: 500 });
  }
  if (!courseRow) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  const course = courseRow as StudioCourseRow;

  let siblingTitles: string[] = [];
  const { data: siblingRows, error: siblingError } = await supabase
    .from("studio_courses")
    .select("title")
    .eq("user_id", user.id)
    .eq("curriculum_module_id", course.curriculum_module_id)
    .neq("id", course.id)
    .limit(10);
  if (siblingError) {
    console.error("[studio:clinical-connections] Échec lecture des cours du module (non bloquant):", siblingError.message);
  } else {
    siblingTitles = ((siblingRows ?? []) as { title: string }[]).map((r) => r.title);
  }

  const userPrompt = [
    `Cours actuel : "${course.title}"`,
    `Extrait du cours actuel :\n${course.raw_text.slice(0, 6000)}`,
    siblingTitles.length > 0
      ? `Autres cours déjà dans ce module :\n${siblingTitles.map((t) => `- ${t}`).join("\n")}`
      : "Aucun autre cours dans ce module pour l'instant.",
  ].join("\n\n");

  const messages: ChatMessageInput[] = [
    { role: "system", content: CONNECTIONS_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
  const callOptions = { model: CHEAP_MODEL, maxTokens: 500, timeoutMs: 75_000 };

  try {
    // Generation ledger: the same course (same excerpt, same sibling titles)
    // clicked again — later, or by another student with the same module
    // layout — replays the validated connections instead of a new call.
    // Adding a course to the module changes the sibling list, hence the key.
    const connections = await runThroughLedger(
      { namespace: "clinical-connections", key: modelCallKey(messages, callOptions), ttlDays: 60, peerWaitMs: 20_000, leaseMs: 90_000 },
      async () => {
        const raw = await callOpenRouter(messages, callOptions);
        const parsed = parseJsonResponse(raw);
        const value = (parsed as { connections?: unknown }).connections;
        if (!Array.isArray(value) || value.length === 0 || !value.every((c) => typeof c === "string")) {
          throw new Error("Réponse IA invalide.");
        }
        return value as string[];
      }
    );

    return NextResponse.json({ success: true, connections: connections.slice(0, 4) });
  } catch (error) {
    const status = error instanceof OpenRouterError ? error.status : 500;
    console.error("[studio:clinical-connections] Échec:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}
