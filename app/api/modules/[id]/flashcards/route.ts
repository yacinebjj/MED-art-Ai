import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";

function parseModuleId(rawId: string): number | null {
  const id = Number(rawId);
  return Number.isFinite(id) ? id : null;
}

/**
 * Toggles "Activer/Désactiver les Flashcards" for one course/module — per
 * student, stored as `profiles.flashcard_active_module_ids` (a plain integer
 * array), not a dedicated join table (a fresh table's PostgREST schema-cache
 * entry never picked up in this project, while `profiles` already works).
 * Body: { active: boolean }.
 *
 * ADDITIVE, by design: a student can activate flashcards for several
 * modules/courses at once — `/api/flashcards/pool` and
 * `/api/flashcards/generate` both aggregate across every id in this array
 * (and, within each module, across every course it contains), fully
 * shuffled, so the study deck is a rich blended mix rather than being
 * limited to a single course.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`modules-flashcards-toggle:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const moduleId = parseModuleId(params.id);
  if (moduleId === null) {
    return NextResponse.json({ success: false, error: "Identifiant de module invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { active } = (body ?? {}) as { active?: unknown };
  if (typeof active !== "boolean") {
    return NextResponse.json({ success: false, error: "'active' est requis et doit être un booléen." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: profile, error: readError } = await supabase
    .from("profiles")
    .select("flashcard_active_module_ids")
    .eq("id", user.id)
    .maybeSingle<{ flashcard_active_module_ids: number[] | null }>();

  if (readError) {
    console.error("[modules/[id]/flashcards:patch] Échec lecture Supabase:", readError);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${readError.message}` }, { status: 500 });
  }

  const current = profile?.flashcard_active_module_ids ?? [];
  const nextIds = active ? Array.from(new Set([...current, moduleId])) : current.filter((id) => id !== moduleId);

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ flashcard_active_module_ids: nextIds })
    .eq("id", user.id);

  if (updateError) {
    console.error("[modules/[id]/flashcards:patch] Échec écriture Supabase:", updateError);
    return NextResponse.json({ success: false, error: `Sauvegarde échouée : ${updateError.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, active });
}
