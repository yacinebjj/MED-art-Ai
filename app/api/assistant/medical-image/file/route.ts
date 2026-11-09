import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { imageFileSlug, isAllowedImageUrl, MAX_IMAGE_SRC_CHARS } from "@/lib/medical-images";
import { fetchRepositoryImage } from "@/lib/medical-image-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET ?src=<a verified picture's link>&name=<its caption>
 * "Télécharger" in the Copilot's full-screen image view: the picture, saved
 * from MedArt's own address — the student never leaves for the repository's
 * site, and the browser's same-origin download works (a cross-origin one
 * would just open the picture). Only the repositories' image hosts
 * (lib/medical-images.ts, redirects re-checked), only raster images (never
 * an SVG served from our origin), 15 MB at most (lib/medical-image-proxy.ts).
 */
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

function failure(status: number, error: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return failure(401, "Tu dois être connecté(e).");

  const rl = rateLimit(`medical-image-file:${user.id}`, RATE_LIMITS.medicalImage);
  if (!rl.allowed) return failure(429, "Trop de téléchargements d'un coup — réessaie dans un instant.", { "Retry-After": String(retryAfterSeconds(rl)) });

  const src = request.nextUrl.searchParams.get("src") ?? "";
  if (!src || src.length > MAX_IMAGE_SRC_CHARS || !isAllowedImageUrl(src)) return failure(400, "Image invalide.");
  const name = imageFileSlug(request.nextUrl.searchParams.get("name") ?? "");

  try {
    const picture = await fetchRepositoryImage(src, { timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
    if (!picture.ok) return failure(picture.status, picture.error);
    return new NextResponse(picture.body, {
      status: 200,
      headers: {
        "Content-Type": picture.type,
        "Content-Disposition": `attachment; filename="medart-${name}.${picture.extension}"`,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[medical-image/file] Téléchargement impossible:", error instanceof Error ? error.message : error);
    return failure(502, "Image indisponible.");
  }
}
