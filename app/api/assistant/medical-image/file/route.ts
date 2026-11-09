import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { imageFileSlug, isAllowedImageUrl, MAX_IMAGE_SRC_CHARS } from "@/lib/medical-images";
import { IMAGE_ENGINE_USER_AGENT } from "@/lib/medical-image-candidates";

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
 * an SVG served from our origin), 15 MB at most.
 */
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;
const RASTER: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let upstream: Response | null = null;
  const stop = (status: number, error: string) => {
    clearTimeout(timer);
    void upstream?.body?.cancel().catch(() => undefined);
    return failure(status, error);
  };
  try {
    let url = src;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      upstream = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": IMAGE_ENGINE_USER_AGENT, Accept: "image/png,image/jpeg,image/webp,image/gif" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (upstream.status < 300 || upstream.status >= 400) break;
      const location = upstream.headers.get("location");
      const next = location ? new URL(location, url).href : "";
      if (!next || !isAllowedImageUrl(next)) return stop(502, "Image indisponible.");
      void upstream.body?.cancel().catch(() => undefined);
      url = next;
      upstream = null;
    }
    if (!upstream || !upstream.ok || !upstream.body) return stop(502, "Image indisponible.");

    const type = (upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const extension = RASTER[type];
    if (!extension) return stop(415, "Format d'image non pris en charge.");
    const declared = Number(upstream.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) return stop(413, "Image trop lourde.");

    let received = 0;
    const capped = upstream.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, stream) {
          received += chunk.byteLength;
          if (received > MAX_BYTES) stream.error(new Error("Image trop lourde."));
          else stream.enqueue(chunk);
        },
        flush() {
          clearTimeout(timer);
        },
      })
    );
    return new NextResponse(capped, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="medart-${name}.${extension}"`,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    clearTimeout(timer);
    console.error("[medical-image/file] Téléchargement impossible:", error instanceof Error ? error.message : error);
    return failure(502, "Image indisponible.");
  }
}
