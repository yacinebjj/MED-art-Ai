import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage, MAX_SOURCE_CHARS } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { storeStudioContentCache } from "@/lib/studio-content-cache";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { persistExplicationChapters } from "@/lib/studio-explication-delta";
import { dispatchStudioGenerationPush } from "@/lib/push/dispatch";

export const runtime = "nodejs";
export const maxDuration = 60; // one Supabase write + chapter split — never a slow AI call, no reason for a long budget.

/**
 * Last step of the client-driven, multi-request Explication pipeline — see
 * lib/studio-explication-delta.ts's ARCHITECTURE comment. Called exactly
 * once, ONLY when explication-part's final response carried
 * `needsFinalize: true` (a genuine fresh generation, never a cache/
 * cross-university-delta shortcut, which already self-persist). Assembles
 * every part's markdown in order, splits it into chapters, persists both the
 * assembled result and the chapter map, stores it in the cross-student
 * cache, and fires the "content is ready" push — the same persistence this
 * route's now-retired single-request predecessor
 * (app/api/studio/generate/route.ts) used to do inline.
 *
 * Body: `{ courseId, parts: string[], language?, customPrompt? }` — `parts`
 * must be every part's `partMarkdown`, in order, exactly as returned by
 * explication-part.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-generate-explication-finalize:${user.id}`, RATE_LIMITS.ai);
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

  const { courseId, parts, language: languageRaw, customPrompt: customPromptRaw } = (body ?? {}) as {
    courseId?: unknown;
    parts?: unknown;
    language?: unknown;
    customPrompt?: unknown;
  };
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis et doit être un nombre." }, { status: 400 });
  }
  if (!Array.isArray(parts) || parts.length === 0 || !parts.every((p) => typeof p === "string" && p.trim().length > 0)) {
    return NextResponse.json({ success: false, error: "'parts' est requis (liste non vide de chaînes)." }, { status: 400 });
  }

  const language: "fr" | "en" = languageRaw === "en" ? "en" : "fr";
  const customPrompt = typeof customPromptRaw === "string" ? customPromptRaw.trim().slice(0, 2000) : "";
  const isPersonalizedVariant = language !== "fr" || customPrompt.length > 0;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data: courseRow, error: courseRowError } = await supabase
    .from("studio_courses")
    .select("raw_text, title, curriculum_module_id")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle<{ raw_text: string | null; title: string | null; curriculum_module_id: number | null }>();
  if (courseRowError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${courseRowError.message}` }, { status: 500 });
  }
  if (!courseRow) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  const explicationMarkdown = (parts as string[]).join("\n\n");
  // Same content_hash the cross-student cache and studio_courses.content_hash
  // are keyed on everywhere else — recomputed from the resolved source text
  // exactly like explication-part/route.ts did at partIndex 0, so a later
  // cache lookup for THIS exact course text lines up.
  const truncatedContext = (courseRow.raw_text ?? "").slice(0, MAX_SOURCE_CHARS);
  const contentHash = sha256(normalizeText(truncatedContext));

  // explication_reservation_pending cleared here too — see
  // supabase/schema.sql's own comment on that column: this is the success
  // path for the reservation explication-start made, so tracking for it ends
  // here, same as the two shortcut paths inside explication-start itself.
  const { error: saveError, count } = await supabase
    .from("studio_courses")
    .update(
      { explication: explicationMarkdown, content_hash: contentHash, explication_reservation_pending: false, updated_at: new Date().toISOString() },
      { count: "exact" }
    )
    .eq("id", courseId)
    .eq("user_id", user.id);
  if (saveError) {
    return NextResponse.json({ success: false, error: `Sauvegarde échouée : ${saveError.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  await persistExplicationChapters(courseId, explicationMarkdown);

  if (!isPersonalizedVariant) {
    await storeStudioContentCache("explication", truncatedContext, explicationMarkdown);
  }

  if (courseRow.title && courseRow.curriculum_module_id) {
    try {
      await dispatchStudioGenerationPush(user.id, courseRow.title, "explication", `/dashboard/module/${courseRow.curriculum_module_id}`);
    } catch (error) {
      console.error("[explication-finalize] Échec envoi push (non bloquant):", error);
    }
  }

  return NextResponse.json({ success: true, actionType: "explication", data: explicationMarkdown, cached: false, cacheMode: "generated" });
}
