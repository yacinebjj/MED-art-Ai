import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import {
  STUDIO_MODEL,
  STUDIO_BYPASS_MOCK,
  STUDIO_PROMPT_CONFIG,
  STUDIO_SECTION_KEYS,
  buildStudioRegeneratePrompt,
} from "@/lib/ai/studio-prompts";
import { STUDIO_SCHEMAS } from "@/lib/ai/studio-schemas";
import { errorMessage, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import type { DemoSectionId } from "@/lib/demo-content";

export const runtime = "nodejs";
export const maxDuration = 300; // same headroom as /api/studio/generate — a regenerate call is a full AI generation too.

const VALID_SECTIONS = Object.keys(STUDIO_PROMPT_CONFIG) as DemoSectionId[];

function isValidSection(value: unknown): value is DemoSectionId {
  return typeof value === "string" && (VALID_SECTIONS as string[]).includes(value);
}

/**
 * "Regénérer" — mirrors app/api/studio/generate/route.ts's call/parse/validate
 * flow, but with a deliberately cheaper input: it fetches ONLY the section's
 * own already-generated column from studio_courses (never raw_text, never
 * the original source document) and sends that back to the model with a
 * rewrite/regenerate instruction (see buildStudioRegeneratePrompt) — the
 * whole point being to never re-spend tokens resending the full source
 * document just to tweak one already-generated tile. Persists straight to
 * the same column (no new row), mirroring
 * app/api/studio/courses/[id]/route.ts's PATCH.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-regenerate:${user.id}`, RATE_LIMITS.ai);
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

  const { courseId, section } = (body ?? {}) as { courseId?: unknown; section?: unknown };

  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis et doit être un nombre." }, { status: 400 });
  }
  if (!isValidSection(section)) {
    return NextResponse.json(
      { success: false, error: `'section' invalide. Valeurs acceptées : ${VALID_SECTIONS.join(", ")}.` },
      { status: 400 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  // "qcm" -> "qcms" is the one mismatch, identity otherwise — same column
  // names as studio_courses (see STUDIO_SECTION_KEYS's own doc comment).
  const column = STUDIO_SECTION_KEYS[section];
  const supabase = getSupabaseAdmin();

  const { data: courseRow, error: fetchError } = await supabase
    .from("studio_courses")
    .select(column)
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    console.error("[studio/regenerate] Échec lecture Supabase:", fetchError);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${fetchError.message}` }, { status: 500 });
  }
  if (!courseRow) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  const existingValue = (courseRow as unknown as Record<string, unknown>)[column];
  if (existingValue === null || existingValue === undefined) {
    return NextResponse.json(
      { success: false, error: "Rien à régénérer — génère d'abord ce contenu une première fois." },
      { status: 400 }
    );
  }

  const existingContentText = typeof existingValue === "string" ? existingValue : JSON.stringify(existingValue);
  const { maxTokens } = STUDIO_PROMPT_CONFIG[section];
  const sectionKey = STUDIO_SECTION_KEYS[section];

  let raw: string;
  try {
    raw = await callOpenRouter(
      [
        { role: "system", content: buildStudioRegeneratePrompt(section, existingContentText) },
        { role: "user", content: "Génère le contenu régénéré demandé." },
      ],
      { model: STUDIO_MODEL, maxTokens, bypassMock: STUDIO_BYPASS_MOCK }
    );
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error(`[studio/regenerate:${section}] Échec appel IA:`, error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }

  let sanitized: unknown;
  try {
    const parsed = parseJsonResponse(raw);
    const value = parsed[sectionKey];
    if (value === undefined || value === null) {
      console.error(`[studio/regenerate:${section}] Clé "${sectionKey}" absente. Clés reçues :`, Object.keys(parsed));
      throw new Error(`La réponse de l'IA ne contient pas la clé "${sectionKey}".`);
    }

    const schema = STUDIO_SCHEMAS[section];
    const result = schema.safeParse(sanitizeForPostgres(value));
    if (!result.success) {
      console.error(`[studio/regenerate:${section}] Validation zod échouée :`, result.error.flatten());
      throw new Error(`La réponse de l'IA pour "${section}" ne respecte pas le schéma attendu.`);
    }
    sanitized = result.data;
  } catch (error) {
    console.error(`[studio/regenerate:${section}] Parsing/validation échoué :`, error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }

  const { error: updateError, count } = await supabase
    .from("studio_courses")
    .update({ [column]: sanitized, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", courseId)
    .eq("user_id", user.id);

  if (updateError) {
    console.error("[studio/regenerate] Échec update Supabase:", updateError);
    return NextResponse.json({ success: false, error: `Sauvegarde échouée : ${updateError.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true, section, data: sanitized });
}
