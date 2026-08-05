import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public list of every module (id, name) — powers the dashboard's "Mes modules" section and the module picker in the move-course dialog. */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ modules: [] });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("modules").select("id, name").order("name", { ascending: true });

  if (error || !data) {
    return NextResponse.json({ modules: [] });
  }

  return NextResponse.json({ modules: data });
}

/** Creates a new module. Body: { name: string }. Returns the created row, or the existing one if the name already exists (unique constraint). Auth required — module creation is a write, not part of the public showcase read surface. */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`modules-create:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { name: rawName } = (body ?? {}) as { name?: unknown };
  if (typeof rawName !== "string" || !rawName.trim()) {
    return NextResponse.json({ success: false, error: "Le nom du module est requis." }, { status: 400 });
  }
  const name = sanitizeForPostgres(rawName.trim());

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("modules").insert({ name }).select("id, name").single();

  if (error) {
    // Unique violation: the module already exists — return it instead of failing the whole action.
    if (error.code === "23505") {
      const { data: existing } = await supabase.from("modules").select("id, name").eq("name", name).maybeSingle();
      if (existing) {
        return NextResponse.json({ success: true, module: existing });
      }
    }
    console.error("[modules] Échec création module — détail complet:", { code: error.code, message: error.message, details: error.details, hint: error.hint });
    return NextResponse.json(
      { success: false, error: `Création du module échouée [${error.code ?? "??"}] : ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, module: data });
}
