import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

// Same class of cap as app/api/courses/chat/route.ts's MAX_HIGHLIGHT_CHARS
// for the same kind of "selected text from a course" data — this route had
// no cap at all before, letting a script grow course_highlights unbounded.
const MAX_SELECTED_TEXT_CHARS = 800;

// `course_highlights` (id, user_id, course_slug, selected_text, color,
// start_offset, end_offset, created_at) — like `studio_courses`/
// `user_notes`, this table was created by hand in the Supabase SQL editor;
// start_offset/end_offset were added to supabase/schema.sql to let
// highlights rehydrate by real position instead of a fragile whole-page
// substring search — run that migration against the live table if the
// columns aren't there yet.

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

  const { slug, selectedText, color, startOffset, endOffset } = (body ?? {}) as {
    slug?: unknown;
    selectedText?: unknown;
    color?: unknown;
    startOffset?: unknown;
    endOffset?: unknown;
  };

  if (typeof slug !== "string" || !slug || typeof selectedText !== "string" || !selectedText) {
    return NextResponse.json({ error: "Données incomplètes" }, { status: 400 });
  }
  if (selectedText.length > MAX_SELECTED_TEXT_CHARS) {
    return NextResponse.json(
      { error: `Le passage sélectionné est trop long (${selectedText.length} caractères, max ${MAX_SELECTED_TEXT_CHARS}).` },
      { status: 413 }
    );
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const rl = rateLimit(`highlights-create:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
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
        start_offset: typeof startOffset === "number" && Number.isFinite(startOffset) ? startOffset : null,
        end_offset: typeof endOffset === "number" && Number.isFinite(endOffset) ? endOffset : null,
      },
    ])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, highlight: data });
}

/** DELETE — removes one highlight by id (?id=123). Scoped to the caller's own rows, same as every other user-owned delete in this app. */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "'id' est requis." }, { status: 400 });
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const rl = rateLimit(`highlights-delete:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase.from("course_highlights").delete({ count: "exact" }).eq("id", id).eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ error: "Surlignage introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
