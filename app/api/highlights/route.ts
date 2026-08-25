import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

// `course_highlights` (id, user_id, course_slug, selected_text, color,
// created_at) — like `studio_courses`/`user_notes`, this table was created
// by hand in the Supabase SQL editor and was never added to
// supabase/schema.sql; its real column types are unverified against a
// generated schema. Flagged for the schema audit, not fixed here.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");

  if (!slug) {
    return NextResponse.json({ error: "Slug manquant" }, { status: 400 });
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("course_highlights")
    .select("*")
    .eq("user_id", user.id)
    .eq("course_slug", slug);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ highlights: data });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête JSON invalide." }, { status: 400 });
  }

  const { slug, selectedText, color } = (body ?? {}) as {
    slug?: unknown;
    selectedText?: unknown;
    color?: unknown;
  };

  if (typeof slug !== "string" || !slug || typeof selectedText !== "string" || !selectedText) {
    return NextResponse.json({ error: "Données incomplètes" }, { status: 400 });
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("course_highlights")
    .insert([
      {
        user_id: user.id,
        course_slug: slug,
        selected_text: selectedText,
        color: typeof color === "string" && color ? color : "yellow",
      },
    ])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, highlight: data });
}
