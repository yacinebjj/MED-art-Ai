import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Profile avatar — GET reads `profiles.avatar_url`, POST uploads a new photo
 * (multipart form, field "file") and updates it. Kept as its own route
 * rather than folded into app/api/profile/route.ts (which only ever PATCHes
 * specialty_id/academic_year_id) to avoid touching that route's scope. GET
 * exists purely so providers/AuthProvider.tsx can bootstrap
 * `profile.avatarUrl` on load without depending on that other route's
 * response shape — see supabase/schema.sql's "Point 13" comment for the
 * bucket/security rationale.
 */

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function ensureAvatarBucket(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((bucket: { name: string }) => bucket.name === AVATAR_BUCKET)) return;

  const { error } = await supabase.storage.createBucket(AVATAR_BUCKET, { public: true });
  // A concurrent request can win the race and create it first — that's not
  // a real failure, just the same idempotent "already there" outcome.
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
}

/** GET — current avatar URL for the signed-in student, or null if none set yet. */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .maybeSingle<{ avatar_url: string | null }>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ avatarUrl: data?.avatar_url ?? null });
}

/** POST — uploads one new avatar image, stores it in Supabase Storage, and updates `profiles.avatar_url`. */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`profile-avatar:${user.id}`, RATE_LIMITS.mutation);
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

  const extension = EXTENSION_BY_MIME[file.type];
  if (!extension) {
    return NextResponse.json(
      { success: false, error: `Format d'image non supporté : "${file.type || "inconnu"}". Utilise une image JPG, PNG, WEBP ou GIF.` },
      { status: 400 }
    );
  }

  if (file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      {
        success: false,
        error: `Image trop volumineuse (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_AVATAR_BYTES / (1024 * 1024)} Mo).`,
      },
      { status: 413 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  let avatarUrl: string;
  try {
    await ensureAvatarBucket(supabase);
    // Scoped under the owner's own id (never client-suppliable) — every
    // upload gets a fresh unique filename rather than overwriting the same
    // path, same convention as the other 3 upload routes in this project;
    // the previous file simply becomes an orphaned blob in the public
    // bucket once `profiles.avatar_url` below stops pointing at it.
    const path = `${user.id}/${randomUUID()}.${extension}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, buffer, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    avatarUrl = data.publicUrl;
  } catch (error) {
    console.error("[profile/avatar] Échec de l'upload vers Supabase Storage:", error);
    return NextResponse.json({ success: false, error: "L'envoi de la photo a échoué. Réessaie." }, { status: 500 });
  }

  const { error: updateError } = await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("id", user.id);
  if (updateError) {
    console.error("[profile/avatar] Photo uploadée mais mise à jour du profil échouée:", updateError);
    return NextResponse.json(
      { success: false, error: "La photo a été envoyée mais le profil n'a pas pu être mis à jour." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, avatarUrl });
}
