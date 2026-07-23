import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getUserCourse, getUserCourseSourceText } from "@/lib/user-courses";
import { canGenerate, recordGeneration } from "@/lib/subscription";
import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";

export const runtime = "nodejs";

const MAX_CONTEXT_CHARS = 20_000;

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

function buildSystemPrompt(sourceText: string | null): string {
  const base =
    "Tu es MedArt, un assistant pédagogique pour des étudiants en Médecine, Pharmacie et Médecine Dentaire en Algérie. " +
    "Réponds de manière claire, précise et bienveillante, comme un tuteur patient.";

  if (!sourceText) return base;

  return `${base}\n\nVoici le cours sur lequel l'étudiant travaille actuellement (utilise-le comme contexte quand c'est pertinent) :\n"""\n${sourceText.slice(0, MAX_CONTEXT_CHARS)}\n"""`;
}

/** Chat about a specific course — powers both the free chat input and the tooltip's "Ask MedArt" / "Translate" quick actions. Never cached (conversational, not an artifact); still gated like any real AI call. */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const courseId = typeof body?.courseId === "string" ? body.courseId : "";
  const messages: IncomingMessage[] = Array.isArray(body?.messages) ? body.messages : [];

  if (!courseId || messages.length === 0) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const course = await getUserCourse(courseId, user.id);
  if (!course) {
    return NextResponse.json({ error: "Cours introuvable." }, { status: 404 });
  }

  const gate = await canGenerate(user);
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 402 });
  }

  const sourceText = await getUserCourseSourceText(courseId, user.id);

  try {
    const reply = await callOpenRouter([
      { role: "system", content: buildSystemPrompt(sourceText) },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ]);

    await recordGeneration(user.id);

    return NextResponse.json({ reply });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unexpected chat error", error);
    return NextResponse.json({ error: "Une erreur inattendue est survenue." }, { status: 500 });
  }
}
