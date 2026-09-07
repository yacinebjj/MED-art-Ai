import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { ACCEPTED_DOCUMENT_EXTENSIONS } from "@/lib/document-extraction";
import { ensureSourceFilesBucket, buildSourceFilePath, SOURCE_FILES_BUCKET } from "@/lib/course-source-storage";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Same business-rule ceiling /api/upload (the legacy in-body route) enforced
// — kept for a fast, friendly rejection before even requesting a signed URL.
// NOTE: Supabase Storage itself may enforce a lower hard per-file limit at
// the project level (50 MB by default on some plans) — this app-level check
// can't see or override that; a file under this number can still be
// rejected by Storage itself on a project with a lower configured limit.
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Step 1 of the direct-to-storage upload pipeline (see app/api/upload/finalize
 * for step 2). Returns a short-lived, path-scoped signed upload URL the
 * BROWSER then PUTs the file to directly — the raw file bytes never pass
 * through this (or any) Next.js Route Handler, which is what actually fixes
 * "large files fail to upload": Vercel enforces a hard ~4.5 MB request-body
 * ceiling on every Node.js Function, on every plan, with no config to raise
 * it — the legacy /api/upload route's own 100 MB business-logic check was
 * correct but functionally dead for anything past that ceiling, since
 * Vercel's platform rejects the request before this app's code ever runs.
 * A signed Storage upload goes straight to Supabase's own servers instead.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`upload-sign:${user.id}`, RATE_LIMITS.ai);
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

  const { fileName, fileSize } = (body ?? {}) as { fileName?: unknown; fileSize?: unknown };
  if (typeof fileName !== "string" || !fileName.trim()) {
    return NextResponse.json({ success: false, error: "'fileName' est requis." }, { status: 400 });
  }
  if (typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ success: false, error: "'fileSize' est requis et doit être un nombre positif." }, { status: 400 });
  }

  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPTED_DOCUMENT_EXTENSIONS.includes(extension)) {
    return NextResponse.json(
      { success: false, error: `Format non supporté (reçu : ".${extension}"). Formats acceptés : PDF, DOCX, PPTX, TXT.` },
      { status: 400 }
    );
  }
  if (fileSize > MAX_FILE_BYTES) {
    return NextResponse.json(
      { success: false, error: `Fichier trop volumineux (${(fileSize / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_FILE_BYTES / (1024 * 1024)} Mo).` },
      { status: 413 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  try {
    const supabase = getSupabaseAdmin();
    await ensureSourceFilesBucket(supabase);

    const path = buildSourceFilePath(user.id, fileName);
    const { data, error } = await supabase.storage.from(SOURCE_FILES_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      console.error("[upload/sign] Échec création de l'URL signée:", error);
      return NextResponse.json({ success: false, error: "Impossible de préparer l'envoi du fichier." }, { status: 500 });
    }

    return NextResponse.json({ success: true, path: data.path, token: data.token, bucket: SOURCE_FILES_BUCKET });
  } catch (error) {
    console.error("[upload/sign] Erreur inattendue:", error);
    return NextResponse.json({ success: false, error: "Impossible de préparer l'envoi du fichier." }, { status: 500 });
  }
}
