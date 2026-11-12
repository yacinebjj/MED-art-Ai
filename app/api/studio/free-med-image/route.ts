import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { resolveMedicalImage } from "@/lib/medical-image-engine";
import { freeMedImageSearchForms } from "@/lib/free-med-image-search";
import type { MedicalImageResolution } from "@/lib/medical-images";
import { MAX_FREE_MED_IMAGE_QUERY_CHARS } from "@/lib/studio-visuals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A few lookups of a few repositories at once (7 s at most each), bounded by SEARCH_BUDGET_MS: well within 30 s.
export const maxDuration = 30;

/**
 * GET ?q=<the medical term of a <FreeMedImage query="…" /> tag>
 *   200 { images: [{ src, width, height, source, credit, license, title }] }  best first, then fallbacks
 *   404 { images: [] }  no fitting picture: the lesson shows none
 *
 * The Studio Explication's pictures (components/studio/FreeMedImage.tsx).
 * $0: MedArt's repository engine (lib/medical-image-engine.ts — Wikimedia
 * Commons, PubMed Central via Open-i, Wellcome Collection; public APIs, no
 * AI, no paid key), every license that allows commercial reuse (CC BY,
 * CC BY-SA, CC0, public domain…): the picture carries its own discreet credit
 * pill (product order 2026-11-12, "unlock all medical images").
 *
 * Looked for hard — a lesson should rather show a fitting picture than none:
 * every repository at once (`broad`), then simpler forms of the term (its key
 * words alone, then their two most specific), until one fits or the search
 * budget runs out. Every candidate still passes the engine's relevance and
 * caption checks: a wrong picture is worse than none.
 *
 * The browser then loads it from MedArt's own address
 * (/api/assistant/medical-image/view), never from the repository. The answer
 * depends only on the query, never on who asks: browsers and Vercel's edge may
 * keep it; errors are never kept.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const FOUND_CACHE = { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" };
const NOT_FOUND_CACHE = { "Cache-Control": "public, max-age=3600, s-maxage=3600" };
/** No new lookup starts after this — each one can take a repository's full 7 s timeout. */
const SEARCH_BUDGET_MS = 16_000;

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
    const started = Date.now();
    let resolution: MedicalImageResolution | null = null;
    for (const attempt of freeMedImageSearchForms(query)) {
      if (Date.now() - started > SEARCH_BUDGET_MS) break;
      // The term is both the search words and the description each result must agree with.
      resolution = await resolveMedicalImage({ fileName: null, keywords: attempt, alt: attempt }, { broad: true });
      if (resolution) break;
    }
    if (!resolution) return NextResponse.json({ images: [] }, { status: 404, headers: NOT_FOUND_CACHE });
    const images = [resolution.image, ...resolution.alternatives].map((image) => ({
      src: image.src,
      width: image.width,
      height: image.height,
      source: image.source,
      credit: image.credit,
      license: image.license,
      title: image.title,
    }));
    return NextResponse.json({ images }, { status: 200, headers: FOUND_CACHE });
  } catch (error) {
    console.error("[studio-free-med-image] Recherche d'image indisponible:", error instanceof Error ? error.message : error);
    return NextResponse.json({ images: [], error: "Les banques d'images sont momentanément injoignables." }, { status: 502, headers: NO_STORE });
  }
}
