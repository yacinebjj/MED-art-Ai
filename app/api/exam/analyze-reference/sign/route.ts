import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { EXAM_REFERENCE_MIME_TO_KIND, EXAM_REFERENCES_BUCKET, buildExamReferencePath, ensureExamReferencesBucket } from "@/lib/exam-reference-storage";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { MAX_UPLOAD_FILE_BYTES } from "@/lib/upload-limits";

export const runtime = "nodejs";

/**
 * Step 1 of the reference-exam analysis: returns a short-lived signed upload
 * URL so the browser PUTs the file straight to Supabase Storage — same
 * pipeline as app/api/upload/sign, for the same reason (Vercel's ~4.5 MB
 * request-body ceiling). Step 2 is POST /api/exam/analyze-reference with the
 * returned `path`.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`exam-reference-sign:${user.id}`, RATE_LIMITS.ai);
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

  const { fileName, fileSize, mimeType } = (body ?? {}) as { fileName?: unknown; fileSize?: unknown; mimeType?: unknown };
  if (typeof fileName !== "string" || !fileName.trim()) {
    return NextResponse.json({ success: false, error: "'fileName' est requis." }, { status: 400 });
  }
  if (typeof mimeType !== "string" || !EXAM_REFERENCE_MIME_TO_KIND[mimeType]) {
    return NextResponse.json({ success: false, error: "Format non supporté — dépose un fichier PDF, PNG ou JPG." }, { status: 400 });
  }
  if (typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ success: false, error: "'fileSize' est requis et doit être un nombre positif." }, { status: 400 });
  }
  if (fileSize > MAX_UPLOAD_FILE_BYTES) {
    return NextResponse.json(
      { success: false, error: `Fichier trop volumineux (${(fileSize / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024)} Mo).` },
      { status: 413 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  try {
    const supabase = getSupabaseAdmin();
    await ensureExamReferencesBucket(supabase);

    const path = buildExamReferencePath(user.id, fileName);
    const { data, error } = await supabase.storage.from(EXAM_REFERENCES_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      console.error("[exam/analyze-reference/sign] Échec création de l'URL signée:", error);
      return NextResponse.json({ success: false, error: "Impossible de préparer l'envoi du fichier." }, { status: 500 });
    }

    return NextResponse.json({ success: true, path: data.path, token: data.token, bucket: EXAM_REFERENCES_BUCKET });
  } catch (error) {
    console.error("[exam/analyze-reference/sign] Erreur inattendue:", error);
    return NextResponse.json({ success: false, error: "Impossible de préparer l'envoi du fichier." }, { status: 500 });
  }
}
