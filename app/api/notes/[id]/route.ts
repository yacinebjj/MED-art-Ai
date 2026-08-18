import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage, sanitizeForPostgres, stripDangerousHtml } from "@/lib/course-generation-shared";

export const runtime = "nodejs";

/**
 * `user_notes` was created by hand in the Supabase SQL editor, so its real
 * primary key column type (bigint vs uuid) was never pinned down anywhere in
 * code. `Number(rawId)` here used to silently turn a uuid id into `NaN`,
 * rejecting every rename/delete with "Identifiant de note invalide" even
 * though the id itself was perfectly valid — treat it as an opaque string
 * instead and let Postgres match it against whatever type the column
 * actually is.
 */
function parseNoteId(rawId: string): string | null {
  const id = rawId?.trim();
  return id ? id : null;
}

/** Edits an existing note from the /dashboard/notes editor — title and/or content, at least one required. */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`notes-update:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const id = parseNoteId(params.id);
  if (id === null) {
    return NextResponse.json({ success: false, error: "Identifiant de note invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { title, content } = (body ?? {}) as { title?: unknown; content?: unknown };
  if (title === undefined && content === undefined) {
    return NextResponse.json({ success: false, error: "'title' ou 'content' est requis." }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  if (typeof title === "string") updates.title = sanitizeForPostgres(title.trim() || "Note sans titre");
  if (typeof content === "string") updates.content = sanitizeForPostgres(stripDangerousHtml(content));

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  // .eq("user_id", ...) on the UPDATE itself (not just a prior SELECT) makes this safe against one student editing another's note by guessing an id.
  const { error, count } = await supabase
    .from("user_notes")
    .update(updates, { count: "exact" })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[notes/[id]:update] Échec update Supabase:", error);
    return NextResponse.json({ success: false, error: `Sauvegarde échouée : ${error.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Note introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`notes-delete:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const id = parseNoteId(params.id);
  if (id === null) {
    return NextResponse.json({ success: false, error: "Identifiant de note invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase.from("user_notes").delete({ count: "exact" }).eq("id", id).eq("user_id", user.id);

  if (error) {
    console.error("[notes/[id]:delete] Échec suppression Supabase:", error);
    return NextResponse.json({ success: false, error: `Suppression échouée : ${error.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Note introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
