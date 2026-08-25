import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { ACCEPTED_DOCUMENT_EXTENSIONS, extractDocumentText } from "@/lib/document-extraction";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs"; // officeparser needs the Node runtime, not edge.
export const maxDuration = 60;

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 Mo — same cap as /api/upload.
const STUDY_PLAN_SOURCES_BUCKET = "study-plan-sources";
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const ACCEPTED_EXTENSIONS = [...ACCEPTED_DOCUMENT_EXTENSIONS, ...IMAGE_EXTENSIONS];

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((bucket: { name: string }) => bucket.name === STUDY_PLAN_SOURCES_BUCKET)) return;

  const { error } = await supabase.storage.createBucket(STUDY_PLAN_SOURCES_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
}

async function uploadSourceFile(userId: string, buffer: Buffer, fileName: string, extension: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabaseAdmin();
    await ensureBucket(supabase);

    const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = `${userId}/${randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from(STUDY_PLAN_SOURCES_BUCKET)
      .upload(path, buffer, { contentType: MIME_TYPES[extension] ?? "application/octet-stream", upsert: false });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(STUDY_PLAN_SOURCES_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch (error) {
    console.error("[study-planner/upload] Échec de l'upload vers Supabase Storage (non bloquant):", error);
    return null;
  }
}

/**
 * Upload for the Study Planner's "Programme officiel (Optionnel)" dropzone.
 * PDF/DOCX/PPTX/TXT go through the same text-extraction pipeline as
 * /api/upload (kept as a separate route/bucket rather than reused directly,
 * so this feature's storage lifecycle never gets coupled to the Studio's).
 * Images (jpg/png/webp) are accepted and stored, but NOT parsed — there is
 * no OCR pipeline anywhere in this app today, so pretending to extract text
 * from an image would silently hand the AI generator empty/garbage context.
 * `imageOnly: true` tells the frontend to show an honest notice instead of
 * claiming the program was read.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`study-planner-upload:${user.id}`, RATE_LIMITS.mutation);
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
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    return NextResponse.json(
      { success: false, error: `Format non supporté (reçu : ".${extension}"). Formats acceptés : PDF, DOCX, PPTX, TXT, JPG, PNG, WEBP.` },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { success: false, error: `Fichier trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_FILE_BYTES / (1024 * 1024)} Mo).` },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const isImage = IMAGE_EXTENSIONS.includes(extension);

  let text = "";
  if (!isImage) {
    try {
      text = sanitizeForPostgres(await extractDocumentText(buffer, extension));
    } catch (error) {
      console.error(`[study-planner/upload] Échec de l'extraction ${extension}:`, error);
      return NextResponse.json({ success: false, error: `Extraction échouée : ${errorMessage(error)}` }, { status: 422 });
    }
  }

  const fileUrl = await uploadSourceFile(user.id, buffer, file.name, extension);

  return NextResponse.json({ success: true, text, fileName: file.name, fileUrl, imageOnly: isImage });
}
