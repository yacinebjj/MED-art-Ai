import { NextRequest, NextResponse } from "next/server";
import { fail, genomeContext, genomeErrorResponse, readJson } from "@/lib/exam-genome/http";
import { GENOME_BUCKET, buildGenomePath, ensureGenomeBucket, isGenomeMimeType } from "@/lib/exam-genome/storage";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { MAX_UPLOAD_FILE_BYTES } from "@/lib/upload-limits";

export const runtime = "nodejs";

/**
 * EXAM GENOME, step 1 of a contribution: a short-lived signed upload URL to
 * the private exam-genome bucket, so the browser PUTs the paper (PDF, or a
 * photo) straight to Storage — never through a Route Handler body (Vercel's
 * ~4.5 MB ceiling). Step 2 is POST /api/exam-genome/ingest with the `path`.
 * Any signed-in student can contribute: every paper lands as needs_review.
 */
export async function POST(request: NextRequest) {
  const ctx = await genomeContext();
  if (ctx instanceof NextResponse) return ctx;

  const rl = rateLimit(`exam-genome-sign:${ctx.user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) return NextResponse.json({ success: false, error: "Trop d'envois — réessaie dans quelques minutes." }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } });

  const body = await readJson(request);
  if (!body) return fail(400, "Corps de requête JSON invalide.");
  const { fileName, fileSize, mimeType } = body;
  if (typeof fileName !== "string" || !fileName.trim()) return fail(400, "'fileName' est requis.");
  if (!isGenomeMimeType(mimeType)) return fail(400, "Format non supporté — envoie un PDF, ou une photo PNG ou JPG.");
  if (typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) return fail(400, "'fileSize' est requis et doit être un nombre positif.");
  if (fileSize > MAX_UPLOAD_FILE_BYTES) return fail(413, `Fichier trop volumineux (max ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024)} Mo).`);

  try {
    await ensureGenomeBucket(ctx.supabase);
    const path = buildGenomePath(ctx.user.id, fileName);
    const { data, error } = await ctx.supabase.storage.from(GENOME_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      console.error("[exam-genome/ingest/sign] URL signée impossible :", error);
      return fail(500, "Impossible de préparer l'envoi du fichier.");
    }
    return NextResponse.json({ success: true, path: data.path, token: data.token, bucket: GENOME_BUCKET });
  } catch (error) {
    return genomeErrorResponse(error, "ingest/sign");
  }
}
