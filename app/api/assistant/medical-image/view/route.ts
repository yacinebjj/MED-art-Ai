import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { isAllowedImageUrl, MAX_IMAGE_SRC_CHARS } from "@/lib/medical-images";
import { fetchRepositoryImage } from "@/lib/medical-image-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET ?src=<a verified picture's link>&v=<address version>
 * A Copilot reply's picture, SHOWN from MedArt's own address
 * (components/assistant/MedicalFigure.tsx).
 *
 * Why (diagnosed 2026-11-09 — "the image never renders, only its caption and
 * credit"): from a student's connection, every Wikimedia host timed out at
 * the connection itself — no answer and no error, while DNS resolved and our
 * server found the picture without trouble. The browser's request to the
 * repository hung, so the picture never arrived and never failed either.
 * Served from here, a picture needs nothing but MedArt itself to be
 * reachable (and the student's address is never sent to another site).
 *
 * Same guards as the download (lib/medical-image-proxy.ts). The bytes are the
 * repository's own picture, identical for every student: the browser keeps
 * it a week and Vercel's CDN a month — `v`, part of the address, renews them
 * all if that is ever needed.
 */
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

function failure(status: number, error: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return failure(401, "Tu dois être connecté(e).");

  const rl = rateLimit(`medical-image-view:${user.id}`, RATE_LIMITS.medicalImageView);
  if (!rl.allowed) return failure(429, "Trop d'images d'un coup — réessaie dans un instant.", { "Retry-After": String(retryAfterSeconds(rl)) });

  const src = request.nextUrl.searchParams.get("src") ?? "";
  if (!src || src.length > MAX_IMAGE_SRC_CHARS || !isAllowedImageUrl(src)) return failure(400, "Image invalide.");

  try {
    const picture = await fetchRepositoryImage(src, { timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
    if (!picture.ok) return failure(picture.status, picture.error);
    return new NextResponse(picture.body, {
      status: 200,
      headers: {
        "Content-Type": picture.type,
        "Content-Disposition": "inline",
        "Cache-Control": "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[medical-image/view] Image indisponible:", error instanceof Error ? error.message : error);
    return failure(502, "Image indisponible.");
  }
}
