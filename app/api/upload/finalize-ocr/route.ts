import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { SOURCE_FILES_BUCKET } from "@/lib/course-source-storage";
import { createStudioCourse } from "@/lib/studio-course-create";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { extractPdfTextViaOcr, OpenRouterError } from "@/lib/ai/openrouter";

export const runtime = "nodejs";
// Generous but bounded — OCR processing time is OpenRouter's own
// server-side mistral-ocr engine, not something this route controls
// directly; see extractPdfTextViaOcr's own timeoutMs (240s) for the actual
// abort point. This just needs enough headroom above that for the Storage
// lookup, DB write, and response serialization.
export const maxDuration = 280;

/**
 * OCR fallback for a PDF that /api/upload/finalize already rejected as
 * having no real text layer (`suggestOcr: true` in that response — see its
 * own comment). Explicitly a SEPARATE, user-initiated step, not an automatic
 * retry: this is a real, billed OpenRouter call (mistral-ocr, ~$0.0002/page
 * — see extractPdfTextViaOcr's own header comment for why this approach was
 * chosen over building local PDF-rasterization + Tesseract), so the student
 * must explicitly opt in via a UI action rather than this firing silently
 * every time normal extraction comes up short.
 *
 * Body: `{ path, fileName, moduleId? }` — the SAME path/fileName finalize's
 * own response already returned; the file is already sitting in Storage
 * from the original upload, so this never needs the file re-uploaded.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`upload-finalize-ocr:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Corps de requête JSON invalide." }, { status: 400 });
  }

  const { path, fileName, moduleId } = (body ?? {}) as { path?: unknown; fileName?: unknown; moduleId?: unknown };
  if (typeof path !== "string" || !path.trim()) {
    return NextResponse.json({ success: false, error: "'path' est requis." }, { status: 400 });
  }
  if (typeof fileName !== "string" || !fileName.trim()) {
    return NextResponse.json({ success: false, error: "'fileName' est requis." }, { status: 400 });
  }
  if (moduleId !== undefined && (typeof moduleId !== "number" || !Number.isFinite(moduleId))) {
    return NextResponse.json({ success: false, error: "'moduleId' doit être un nombre." }, { status: 400 });
  }
  if (!path.startsWith(`${user.id}/`)) {
    return NextResponse.json({ success: false, error: "Chemin de fichier invalide." }, { status: 403 });
  }
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ success: false, error: "L'extraction OCR n'est disponible que pour les fichiers PDF." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  // Only need the public URL, not the file bytes — OpenRouter's file-parser
  // plugin fetches the PDF itself server-side (see extractPdfTextViaOcr's
  // own comment on why fileUrl must be public). The file is already
  // confirmed to exist from the original /api/upload/finalize call that
  // suggested this OCR retry.
  const { data: publicUrlData } = supabase.storage.from(SOURCE_FILES_BUCKET).getPublicUrl(path);
  const fileUrl = publicUrlData.publicUrl;

  let text: string;
  try {
    const result = await extractPdfTextViaOcr(fileUrl, fileName);
    text = sanitizeForPostgres(result.text);
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[upload/finalize-ocr] Échec extraction OCR:", error);
    return NextResponse.json({ success: false, error: `Extraction OCR échouée : ${errorMessage(error)}` }, { status: 502 });
  }

  if (text.length < 50) {
    return NextResponse.json(
      {
        success: false,
        error: "L'extraction OCR n'a pas trouvé de texte exploitable non plus — ce document est peut-être illisible ou vide. Essaie un autre fichier.",
      },
      { status: 422 }
    );
  }

  if (typeof moduleId === "number") {
    try {
      const course = await createStudioCourse({ userId: user.id, moduleId, title: fileName, rawText: text, sourceFileUrl: fileUrl });
      return NextResponse.json({ success: true, course, text, fileName, fileUrl });
    } catch (error) {
      console.error("[upload/finalize-ocr] Échec création du cours:", error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, text, fileName, fileUrl });
}
