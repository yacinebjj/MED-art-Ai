import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage, sanitizeForPostgres, stripDangerousHtml } from "@/lib/course-generation-shared";
import type { UserNote } from "@/types/user-notes";

export const runtime = "nodejs";

/**
 * "Mes notes" — free-standing student notes, unrelated to any course/module.
 * Table `user_notes` (id, user_id, title, content, created_at) was created
 * manually in the Supabase SQL editor (see supabase/schema.sql's comment),
 * same convention as `studio_courses`. Read by the /dashboard/notes page and
 * by the Studio's "Add note" panel (which only ever POSTs, never lists).
 */

// `id` is opaque (see types/user-notes.ts's UserNote doc comment) — this
// hand-created table's real primary key type (bigint vs uuid) was never
// pinned down in code, so it's never coerced to a number anywhere below.
interface UserNoteRow {
  id: string;
  title: string;
  content: string;
  created_at: string;
}

function toNote(row: UserNoteRow): UserNote {
  return { id: row.id, title: row.title, content: row.content, createdAt: row.created_at };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Newest first — matches how a personal notes list is normally browsed (most recent note on top). */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_notes")
    .select("id, title, content, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[notes:list] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  const notes: UserNote[] = ((data ?? []) as UserNoteRow[]).map(toNote);
  return NextResponse.json({ success: true, notes });
}

/** Used both by the dedicated /dashboard/notes page ("Nouvelle note") and by the Studio's "Add note" panel's real "Sauvegarder" button. */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`notes-create:${user.id}`, RATE_LIMITS.mutation);
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

  const { title, content, moduleId, courseTitle } = (body ?? {}) as {
    title?: unknown;
    content?: unknown;
    moduleId?: unknown;
    courseTitle?: unknown;
  };

  // Content is intentionally optional here — the dedicated /dashboard/notes
  // page's "Nouvelle note" button creates a blank draft immediately (typed
  // into and saved via PUT afterward, standard notes-app UX). The Studio's
  // "Add note" panel, the other caller, already guards this client-side
  // (its Sauvegarder button is disabled while empty) since that flow only
  // makes sense with real content.
  const finalContent = typeof content === "string" ? sanitizeForPostgres(stripDangerousHtml(content)) : "";
  const finalTitle = typeof title === "string" && title.trim() ? title.trim() : "Note sans titre";
  const finalModuleId = typeof moduleId === "number" && Number.isFinite(moduleId) ? moduleId : null;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  // "Add Note" from inside a module's workspace aggregates into ONE note per
  // module instead of spawning a new note per highlighted excerpt — every
  // subsequent addition is appended, tagged with which course it came from,
  // rather than creating clutter. Only engages when the caller passes a real
  // `moduleId` (today: module/[id]/page.tsx's StudioPanel/ChatDocumentPanel);
  // every other caller (the dedicated notes page, demo pages) keeps the
  // plain "always create a new note" behavior below.
  if (finalModuleId !== null) {
    const { data: existingNote, error: existingError } = await supabase
      .from("user_notes")
      .select("id, title, content, created_at")
      .eq("user_id", user.id)
      .eq("module_id", finalModuleId)
      .maybeSingle();

    if (existingError) {
      console.error("[notes:create] Échec lecture note de module existante:", existingError);
      return NextResponse.json({ success: false, error: `Lecture échouée : ${existingError.message}` }, { status: 500 });
    }

    const sourceLabel = typeof courseTitle === "string" && courseTitle.trim() ? escapeHtml(courseTitle.trim()) : null;
    const taggedContent = sourceLabel
      ? `<br><br><strong>[Source: ${sourceLabel}]</strong><br>${finalContent}`
      : `<br><br>${finalContent}`;

    if (existingNote) {
      const existing = existingNote as UserNoteRow;
      const mergedContent = sanitizeForPostgres(`${existing.content}${taggedContent}`);
      const { data, error } = await supabase
        .from("user_notes")
        .update({ content: mergedContent })
        .eq("id", existing.id)
        .select("id, title, content, created_at")
        .single();

      if (error) {
        console.error("[notes:create] Échec mise à jour note de module:", error);
        return NextResponse.json({ success: false, error: `Mise à jour échouée : ${error.message}` }, { status: 500 });
      }
      return NextResponse.json({ success: true, note: toNote(data as UserNoteRow) });
    }

    const { data: moduleRow } = await supabase.from("curriculum_modules").select("title").eq("id", finalModuleId).maybeSingle();
    const moduleTitle = (moduleRow as { title?: string } | null)?.title ?? finalTitle;

    const { data, error } = await supabase
      .from("user_notes")
      .insert({
        user_id: user.id,
        title: sanitizeForPostgres(moduleTitle),
        content: sanitizeForPostgres(finalContent),
        module_id: finalModuleId,
      })
      .select("id, title, content, created_at")
      .single();

    if (error) {
      console.error("[notes:create] Échec insertion note de module:", error);
      return NextResponse.json({ success: false, error: `Création échouée : ${error.message}` }, { status: 500 });
    }
    return NextResponse.json({ success: true, note: toNote(data as UserNoteRow) });
  }

  const { data, error } = await supabase
    .from("user_notes")
    .insert({
      user_id: user.id,
      title: sanitizeForPostgres(finalTitle),
      content: finalContent,
    })
    .select("id, title, content, created_at")
    .single();

  if (error) {
    console.error("[notes:create] Échec insertion Supabase:", error);
    return NextResponse.json({ success: false, error: `Création échouée : ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, note: toNote(data as UserNoteRow) });
}
