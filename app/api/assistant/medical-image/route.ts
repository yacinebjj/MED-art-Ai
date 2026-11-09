import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { parseMedicalImageQuery } from "@/lib/medical-images";
import { resolveMedicalImage } from "@/lib/medical-image-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The exact file, then the repositories searched at once (7 s at most each), then the description: well within 30 s.
export const maxDuration = 30;

/**
 * GET ?src=<the image link a Copilot reply wrote>&alt=<its description>
 *   200 { image, alternatives }  the best verified picture and up to 3 others
 *   404 { image: null }          no real picture fits: the reply shows none
 * See lib/medical-images.ts and lib/medical-image-engine.ts. Costs nothing:
 * the repositories' public APIs, no AI. The answer depends only on the query
 * string, never on who asks — browsers and Vercel's edge may keep it; errors
 * are never kept.
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
    const resolution = await resolveMedicalImage(query);
    return resolution
      ? NextResponse.json(resolution, { status: 200, headers: FOUND_CACHE })
      : NextResponse.json({ image: null, alternatives: [] }, { status: 404, headers: NOT_FOUND_CACHE });
  } catch (error) {
    console.error("[medical-image] Recherche d'image indisponible:", error instanceof Error ? error.message : error);
    return NextResponse.json({ image: null, error: "Les banques d'images sont momentanément injoignables." }, { status: 502, headers: NO_STORE });
  }
}
