import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { resolveMedicalImage } from "@/lib/medical-image-engine";
import { MAX_FREE_MED_IMAGE_QUERY_CHARS } from "@/lib/studio-visuals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The repositories searched at once (7 s at most each), twice at worst: well within 30 s.
export const maxDuration = 30;

/**
 * GET ?q=<the medical term of a <FreeMedImage query="…" /> tag>
 *   200 { images: [{ src, width, height }] }  the best picture first, then fallbacks
 *   404 { images: [] }                        no fitting picture: the lesson shows none
 *
 * The Studio Explication's pictures (components/studio/FreeMedImage.tsx).
 * $0: MedArt's repository engine (lib/medical-image-engine.ts — Wikimedia
 * Commons, PubMed Central via Open-i, Wellcome Collection; public APIs, no
 * AI, no paid key). Only CC0 / public-domain pictures: the lesson shows a
 * picture alone, with no caption, credit or link, which other licenses would
 * not allow. The browser then loads it from MedArt's own address
 * (/api/assistant/medical-image/view), never from the repository.
 *
 * The answer depends only on the query, never on who asks: browsers and
 * Vercel's edge may keep it; errors are never kept.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const FOUND_CACHE = { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" };
const NOT_FOUND_CACHE = { "Cache-Control": "public, max-age=3600, s-maxage=3600" };

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ images: [], error: "Tu dois être connecté(e)." }, { status: 401, headers: NO_STORE });
  }

  const rl = rateLimit(`studio-free-med-image:${user.id}`, RATE_LIMITS.medicalImage);
  if (!rl.allowed) {
    return NextResponse.json(
      { images: [], error: "Trop d'images demandées d'un coup — réessaie dans un instant." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const query = (request.nextUrl.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_FREE_MED_IMAGE_QUERY_CHARS).trim();
  if (query.length < 2) {
    return NextResponse.json({ images: [], error: "Terme d'image manquant." }, { status: 400, headers: NO_STORE });
  }

  try {
    // The term is both the search words and the description each result must agree with.
    const resolution = await resolveMedicalImage({ fileName: null, keywords: query, alt: query }, { attributionFree: true });
    if (!resolution) return NextResponse.json({ images: [] }, { status: 404, headers: NOT_FOUND_CACHE });
    const images = [resolution.image, ...resolution.alternatives].map((image) => ({ src: image.src, width: image.width, height: image.height }));
    return NextResponse.json({ images }, { status: 200, headers: FOUND_CACHE });
  } catch (error) {
    console.error("[studio-free-med-image] Recherche d'image indisponible:", error instanceof Error ? error.message : error);
    return NextResponse.json({ images: [], error: "Les banques d'images sont momentanément injoignables." }, { status: 502, headers: NO_STORE });
  }
}
