import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";
import type { FlashcardPoolItem } from "@/types/flashcard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StudioCourseFlashcardRow {
  title: string;
  curriculum_module_id: number;
  flashcard_queue: { id: string; question: string; answer: string }[] | null;
}

/**
 * GET /api/flashcards/card?id= — read-only lookup of ONE of the signed-in
 * student's own served flashcards, by id. Used when a reminder notification
 * is clicked: the deck opens on that exact card (full question + answer)
 * even when it isn't part of the session's current batch. Scoped to the
 * student's own courses — another student's card id simply isn't found.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const cardId = request.nextUrl.searchParams.get("id")?.trim();
  if (!cardId || cardId.length > 200) {
    return NextResponse.json({ success: false, error: "Paramètre 'id' invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("studio_courses")
      .select("title, curriculum_module_id, flashcard_queue")
      .eq("user_id", user.id)
      .not("flashcard_queue", "is", null);
    if (error) throw new Error(error.message);

    for (const course of (data ?? []) as StudioCourseFlashcardRow[]) {
      const card = course.flashcard_queue?.find((c) => c.id === cardId);
      if (card) {
        const item: FlashcardPoolItem = {
          id: card.id,
          question: card.question,
          answer: card.answer,
          courseTitle: course.title,
          moduleId: course.curriculum_module_id,
        };
        return NextResponse.json({ success: true, card: item });
      }
    }
    return NextResponse.json({ success: false, error: "Carte introuvable." }, { status: 404 });
  } catch (error) {
    console.error("[flashcards/card] Erreur:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
