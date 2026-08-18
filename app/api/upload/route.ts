import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { ACCEPTED_DOCUMENT_EXTENSIONS, extractDocumentText } from "@/lib/document-extraction";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs"; // officeparser needs the Node runtime, not edge.

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 Mo — same cap as /api/generate-course.

const SOURCE_FILES_BUCKET = "course-sources";

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
};

async function ensureSourceFilesBucket(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((bucket: { name: string }) => bucket.name === SOURCE_FILES_BUCKET)) return;

  const { error } = await supabase.storage.createBucket(SOURCE_FILES_BUCKET, { public: true });
  // A concurrent upload can win the race to create the bucket between the
  // listBuckets check above and this call — not a real failure.
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
}

/**
 * Uploads the ORIGINAL file bytes to Supabase Storage so "Afficher le cours"
 * can later render the real PDF/DOCX/PPTX instead of just its extracted text
 * (see components/course/workspace/FileViewerModal.tsx). Fails open: any
 * error here is logged and swallowed — text extraction (this route's actual
 * purpose) must never fail just because Storage is unreachable or
 * misconfigured; the workspace simply falls back to the raw-text view for
 * that course.
 */
async function uploadSourceFile(userId: string, buffer: Buffer, fileName: string, extension: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabaseAdmin();
    await ensureSourceFilesBucket(supabase);

    const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = `${userId}/${randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from(SOURCE_FILES_BUCKET)
      .upload(path, buffer, { contentType: MIME_TYPES[extension] ?? "application/octet-stream", upsert: false });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(SOURCE_FILES_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch (error) {
    console.error("[upload] Échec de l'upload du fichier original vers Supabase Storage (non bloquant):", error);
    return null;
  }
}

/**
 * Extracts a document's raw text for the generic Studio workspace
 * (app/dashboard/module/[id]/page.tsx). Deliberately does NOT create any
 * Supabase row — unlike /api/generate-course (the real per-course pipeline),
 * this is the lightweight, ephemeral flow: the extracted text is handed back
 * to the client, which holds it in memory (`documentContext`) and resends it
 * with every /api/studio/generate call. It DOES, however, best-effort upload
 * the original file to Storage (see uploadSourceFile above) purely so
 * "Afficher le cours" can render the real file later — that upload is
 * unrelated to and independent from the ephemeral text-extraction flow.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`upload:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "Aucun fichier reçu." }, { status: 400 });
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPTED_DOCUMENT_EXTENSIONS.includes(extension)) {
    return NextResponse.json(
      { success: false, error: `Format non supporté (reçu : ".${extension}"). Formats acceptés : PDF, DOCX, PPTX, TXT.` },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { success: false, error: `Fichier trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_FILE_BYTES / (1024 * 1024)} Mo).` },
      { status: 413 }
    );
  }

  let text: string;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
    text = sanitizeForPostgres(await extractDocumentText(buffer, extension));
  } catch (error) {
    console.error(`[upload] Échec de l'extraction ${extension}:`, error);
    return NextResponse.json({ success: false, error: `Extraction échouée : ${errorMessage(error)}` }, { status: 422 });
  }

  if (text.length < 50) {
    return NextResponse.json(
      { success: false, error: "Le contenu est trop court ou illisible (pas assez de texte exploitable)." },
      { status: 422 }
    );
  }

  const fileUrl = await uploadSourceFile(user.id, buffer, file.name, extension);

  return NextResponse.json({ success: true, text, fileName: file.name, fileUrl });
}
