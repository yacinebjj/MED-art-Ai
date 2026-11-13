import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { MAX_UPLOAD_FILE_BYTES } from "@/lib/upload-limits";
import { RELAY_BUCKETS, RELAY_CHUNK_BYTES, RELAY_CONTENT_TYPES, isRelayUploadId } from "@/lib/upload-relay";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The upload relay (lib/upload-relay.ts): step 2 of the direct-to-storage
 * pipeline (lib/upload-client.ts), carried by MedArt's own server when the
 * student's browser can't reach Supabase Storage itself (Code Red
 * 2026-11-13, "L'envoi du fichier a échoué : Failed to fetch"). Steps 1
 * (sign) and 3 (finalize — extraction, course row, quota) are unchanged.
 *
 *  - mode=whole: a file that fits one request, uploaded with the browser's
 *    OWN signed token — Storage checks it exactly as for a direct upload, so
 *    this route can only write what /api/upload/sign (or the exam-reference
 *    signer) already authorized.
 *  - mode=part: one ≤3.5 MB part of a larger file, kept in a private bucket
 *    under the student's own folder;
 *  - mode=complete: the parts, assembled and uploaded with the signed token,
 *    then deleted.
 */

/** Private: parts of a large relayed file wait here until assembled, then are deleted. */
const PARTS_BUCKET = "upload-relay-parts";
const MAX_PARTS = Math.ceil(MAX_UPLOAD_FILE_BYTES / RELAY_CHUNK_BYTES);
/** Headroom over a part's size for a request's own overhead. */
const MAX_BODY_BYTES = RELAY_CHUNK_BYTES + 64 * 1024;
const STORAGE_DOWN =
  "Le stockage des fichiers ne répond pas pour le moment (incident chez notre hébergeur) — réessaie dans quelques minutes. Aucun quota n'a été consommé.";

type Admin = ReturnType<typeof getSupabaseAdmin>;

function fail(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

/** The signed paths look like `<userId>/<uuid>-<safe name>` (lib/course-source-storage.ts, lib/exam-reference-storage.ts) — and only the student's own. */
function validTarget(userId: string, bucket: unknown, path: unknown): { bucket: string; path: string } | null {
  if (typeof bucket !== "string" || !RELAY_BUCKETS.includes(bucket)) return null;
  if (typeof path !== "string" || !path.startsWith(`${userId}/`)) return null;
  if (!/^[0-9a-f-]{36}-[A-Za-z0-9._-]{1,255}$/.test(path.slice(userId.length + 1))) return null;
  return { bucket, path };
}

function validToken(token: unknown): token is string {
  return typeof token === "string" && token.length >= 20 && token.length <= 4096 && /^[A-Za-z0-9._-]+$/.test(token);
}

function contentTypeOf(value: unknown): string {
  return typeof value === "string" && RELAY_CONTENT_TYPES.includes(value) ? value : "application/octet-stream";
}

function decodeHeader(value: string | null): string | null {
  if (value === null) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function readBody(request: NextRequest): Promise<Buffer | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const bytes = Buffer.from(await request.arrayBuffer());
  return bytes.length > 0 && bytes.length <= MAX_BODY_BYTES ? bytes : null;
}

/** Uploads the whole file with the student's own signed token. Null when it landed; else the answer to send back. */
async function uploadWithToken(admin: Admin, bucket: string, path: string, token: string, bytes: Buffer, contentType: string) {
  const { error } = await admin.storage.from(bucket).uploadToSignedUrl(path, token, bytes, { contentType, upsert: false });
  if (!error) return null;
  const message = error.message ?? "";
  // A direct attempt that landed although the browser never heard back: the file is already there.
  if (/already exists|duplicate/i.test(message)) return null;
  console.error("[upload/relay] Storage refused the relayed file:", message);
  if (/exceeded|too large|maximum allowed size|payload too large/i.test(message)) {
    return fail(413, "Ce fichier dépasse la taille maximale autorisée par le stockage — essaie un fichier plus léger.");
  }
  if (/mime|content.?type/i.test(message)) return fail(415, "Ce format de fichier est refusé par le stockage.");
  if (/jwt|jws|signature|token|expired/i.test(message)) return fail(400, "L'autorisation d'envoi a expiré — réessaie l'envoi.");
  return fail(503, STORAGE_DOWN);
}

let partsBucketReady: Promise<void> | null = null;

function ensurePartsBucket(admin: Admin): Promise<void> {
  partsBucketReady ??= (async () => {
    const { data: buckets } = await admin.storage.listBuckets();
    if (buckets?.some((bucket: { name: string }) => bucket.name === PARTS_BUCKET)) return;
    const { error } = await admin.storage.createBucket(PARTS_BUCKET, { public: false, fileSizeLimit: MAX_BODY_BYTES });
    // A concurrent relay can win the race to create it — not a real failure.
    if (error && !/already exists/i.test(error.message)) throw error;
  })().catch((error) => {
    partsBucketReady = null;
    throw error;
  });
  return partsBucketReady;
}

async function complete(request: NextRequest, admin: Admin, userId: string) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const target = validTarget(userId, body?.bucket, body?.path);
  if (!target || !validToken(body?.token) || !isRelayUploadId(body?.uploadId)) return fail(400, "Envoi refusé : destination invalide.");
  const parts = Number(body?.parts);
  const size = Number(body?.size);
  if (!Number.isInteger(parts) || parts < 2 || parts > MAX_PARTS || !Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD_FILE_BYTES) {
    return fail(400, "Fichier invalide.");
  }
  const names = Array.from({ length: parts }, (_, index) => `${userId}/${body?.uploadId}/${index}`);
  try {
    const chunks: Buffer[] = [];
    for (const name of names) {
      const { data, error } = await admin.storage.from(PARTS_BUCKET).download(name);
      if (error || !data) {
        console.error("[upload/relay] Missing part", name, error?.message);
        const missing = /not.?found|does not exist|404/i.test(error?.message ?? "");
        return missing ? fail(400, "Une partie du fichier manque — réessaie l'envoi.") : fail(503, STORAGE_DOWN);
      }
      chunks.push(Buffer.from(await data.arrayBuffer()));
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== size) return fail(400, "Le fichier reçu est incomplet — réessaie l'envoi.");
    return (await uploadWithToken(admin, target.bucket, target.path, body?.token as string, bytes, contentTypeOf(body?.contentType))) ?? NextResponse.json({ success: true });
  } finally {
    // Never kept: a failed assembly starts over from fresh parts.
    try {
      await admin.storage.from(PARTS_BUCKET).remove(names);
    } catch (error) {
      console.error("[upload/relay] Parts cleanup failed (non-blocking):", error);
    }
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return fail(401, "Tu dois être connecté(e).");

  const rl = rateLimit(`upload-relay:${user.id}`, RATE_LIMITS.uploadRelay);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop d'envois d'un coup — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }
  if (!isSupabaseConfigured()) return fail(500, "Supabase n'est pas configuré sur le serveur.");

  const mode = request.nextUrl.searchParams.get("mode");
  const admin = getSupabaseAdmin();
  try {
    if (mode === "complete") return await complete(request, admin, user.id);

    if (mode === "whole") {
      const target = validTarget(user.id, request.headers.get("x-upload-bucket"), decodeHeader(request.headers.get("x-upload-path")));
      const token = request.headers.get("x-upload-token");
      if (!target || !validToken(token)) return fail(400, "Envoi refusé : destination invalide.");
      const bytes = await readBody(request);
      if (!bytes) return fail(413, "Ce fichier est trop volumineux pour un seul envoi.");
      return (await uploadWithToken(admin, target.bucket, target.path, token, bytes, contentTypeOf(request.headers.get("x-upload-content-type")))) ?? NextResponse.json({ success: true });
    }

    if (mode === "part") {
      const uploadId = request.headers.get("x-upload-id");
      const index = Number(request.headers.get("x-upload-part"));
      const parts = Number(request.headers.get("x-upload-parts"));
      if (!isRelayUploadId(uploadId) || !Number.isInteger(parts) || parts < 2 || parts > MAX_PARTS || !Number.isInteger(index) || index < 0 || index >= parts) {
        return fail(400, "Partie de fichier invalide.");
      }
      const bytes = await readBody(request);
      if (!bytes) return fail(413, "Partie de fichier invalide.");
      await ensurePartsBucket(admin);
      const { error } = await admin.storage.from(PARTS_BUCKET).upload(`${user.id}/${uploadId}/${index}`, bytes, { contentType: "application/octet-stream", upsert: true });
      if (error) {
        console.error("[upload/relay] Part refused:", error.message);
        return fail(503, STORAGE_DOWN);
      }
      return NextResponse.json({ success: true });
    }

    return fail(400, "Mode d'envoi inconnu.");
  } catch (error) {
    console.error("[upload/relay] Unexpected error:", error);
    return fail(503, STORAGE_DOWN);
  }
}
