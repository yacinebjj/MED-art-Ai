import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
// Without this, Next.js treats this GET Route Handler as static and caches
// its response per-path — a freshly-generated section would keep showing
// as null after a page refresh until the cache happened to invalidate.
export const dynamic = "force-dynamic";

/**
 * Parses a jsonb-or-text Supabase column defensively: some environments
 * store these as native jsonb (already an object when read back), others
 * as plain text (a JSON string) — this works for either.
 */
function parseJsonColumn(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value ?? null;
}

/**
 * Public, unauthenticated lookup of a hand-authored showcase course (e.g.
 * "gastrite") by slug, from the `courses` table — distinct from the
 * per-user `user_courses` table. Powers app/dashboard/demo/[slug]/page.tsx's
 * Mode Visuel / Résumé / Cas Clinique / QCM Studio tabs.
 */
export async function GET(request: NextRequest, { params }: { params: { slug: string } }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n'est pas configuré." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  interface RawCourseRow {
    slug: string;
    title: string;
    explication: string;
    mode_visuel: unknown;
    resume: unknown;
    cas_clinique: unknown;
    qcms: unknown;
  }

  // The DB column is named "resumé" (with the French accent) and aliased to
  // "resume" here so the JSON response and frontend types can use plain
  // ASCII. supabase-js's compile-time select-string parser can't statically
  // parse the accented column name, so the query result is cast by hand.
  const selectColumns = "slug, title, explication, mode_visuel, resume:resumé, cas_clinique, qcms";

  const { data, error } = (await supabase
    .from("courses")
    .select(selectColumns)
    .eq("slug", params.slug)
    .maybeSingle()) as unknown as { data: RawCourseRow | null; error: unknown };

  if (error || !data) {
    return NextResponse.json({ error: "Cours introuvable." }, { status: 404 });
  }

  return NextResponse.json({
    slug: data.slug,
    title: data.title,
    explication: data.explication,
    mode_visuel: parseJsonColumn(data.mode_visuel),
    resume: parseJsonColumn(data.resume),
    cas_clinique: parseJsonColumn(data.cas_clinique),
    qcms: parseJsonColumn(data.qcms),
  });
}

/**
 * Renames a course and/or moves it to a different module (or unassigns it
 * with `module_id: null`). Body: { title?: string, module_id?: number | null }.
 * Powers the dashboard's kebab menu ("Renommer" / "Ajouter à un module").
 */
export async function PATCH(request: NextRequest, { params }: { params: { slug: string } }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { title, module_id } = (body ?? {}) as { title?: unknown; module_id?: unknown };

  const patch: Record<string, unknown> = {};
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ success: false, error: "Le titre ne peut pas être vide." }, { status: 400 });
    }
    patch.title = sanitizeForPostgres(title.trim());
  }
  if (module_id !== undefined) {
    if (module_id !== null && !Number.isInteger(module_id)) {
      return NextResponse.json({ success: false, error: "module_id doit être un entier ou null." }, { status: 400 });
    }
    patch.module_id = module_id;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ success: false, error: "Aucun champ à mettre à jour (title ou module_id attendu)." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("courses")
    .update(patch)
    .eq("slug", params.slug)
    .select("id, slug, title, module_id")
    .maybeSingle();

  if (error) {
    console.error("[courses/slug PATCH] Échec update — détail complet:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      slug: params.slug,
      patch,
    });
    return NextResponse.json(
      { success: false, error: `Mise à jour échouée [${error.code ?? "??"}] : ${error.message}` },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true, course: data });
}

/** Deletes a course by slug — powers the dashboard's kebab menu "Supprimer" action. */
export async function DELETE(_request: NextRequest, { params }: { params: { slug: string } }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("courses").delete().eq("slug", params.slug);

  if (error) {
    console.error("[courses/slug DELETE] Échec suppression — détail complet:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      slug: params.slug,
    });
    return NextResponse.json(
      { success: false, error: `Suppression échouée [${error.code ?? "??"}] : ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
