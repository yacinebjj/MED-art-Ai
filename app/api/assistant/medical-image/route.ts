import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { parseMedicalImageQuery } from "@/lib/medical-images";
import { resolveMedicalImage } from "@/lib/wikimedia-commons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Up to three Wikimedia calls (exact file, then two searches), 6 s each at most.
export const maxDuration = 30;

/**
 * GET ?src=<the image link a Copilot reply wrote>&alt=<its description>
 *   200 { image }        the verified Wikimedia Commons image to show
 *   404 { image: null }  no real image fits: the reply shows none
 * See lib/medical-images.ts. Costs nothing: Wikimedia's public API, no AI.
 * The answer depends only on the query string, never on who asks — browsers
 * and Vercel's edge may keep it; errors are never kept.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const FOUND_CACHE = { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" };
const NOT_FOUND_CACHE = { "Cache-Control": "public, max-age=3600, s-maxage=3600" };

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ image: null, error: "Tu dois être connecté(e)." }, { status: 401, headers: NO_STORE });
  }

  const rl = rateLimit(`medical-image:${user.id}`, RATE_LIMITS.medicalImage);
  if (!rl.allowed) {
    return NextResponse.json(
      { image: null, error: "Trop d'images demandées d'un coup — réessaie dans un instant." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const query = parseMedicalImageQuery(request.nextUrl.searchParams.get("src"), request.nextUrl.searchParams.get("alt"));
  if (!query) {
    return NextResponse.json({ image: null, error: "Lien d'image invalide." }, { status: 400, headers: NO_STORE });
  }

  try {
    const image = await resolveMedicalImage(query);
    return image
      ? NextResponse.json({ image }, { status: 200, headers: FOUND_CACHE })
      : NextResponse.json({ image: null }, { status: 404, headers: NOT_FOUND_CACHE });
  } catch (error) {
    console.error("[medical-image] Wikimedia Commons indisponible:", error instanceof Error ? error.message : error);
    return NextResponse.json({ image: null, error: "Wikimedia Commons est momentanément injoignable." }, { status: 502, headers: NO_STORE });
  }
}
