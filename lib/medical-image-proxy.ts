import { isAllowedImageUrl } from "@/lib/medical-images";
import { IMAGE_ENGINE_USER_AGENT } from "@/lib/medical-image-candidates";

/**
 * A verified picture's bytes, fetched by MedArt from the repository that
 * hosts it, for the two routes that serve a Copilot picture from MedArt's own
 * address: showing it in a reply (app/api/assistant/medical-image/view) and
 * saving it (app/api/assistant/medical-image/file). Same guards for both:
 *  - only the repositories' image hosts (lib/medical-images.ts), every
 *    redirect followed by hand and checked again;
 *  - only raster images — never an SVG served from our origin, where its
 *    scripts would run;
 *  - at most `maxBytes`: a larger declared length is refused up front, a
 *    stream that runs past it is cut;
 *  - given up after `timeoutMs`, the transfer of the body included.
 * Server only. Throws on a network failure (the caller answers 502).
 */
const MAX_REDIRECTS = 3;
const RASTER_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export type RepositoryImage =
  | { ok: true; body: ReadableStream<Uint8Array>; type: string; extension: string }
  | { ok: false; status: 413 | 415 | 502; error: string };

export async function fetchRepositoryImage(src: string, { timeoutMs, maxBytes }: { timeoutMs: number; maxBytes: number }): Promise<RepositoryImage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let upstream: Response | null = null;
  const stop = (status: 413 | 415 | 502, error: string): RepositoryImage => {
    clearTimeout(timer);
    void upstream?.body?.cancel().catch(() => undefined);
    return { ok: false, status, error };
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
    const extension = RASTER_EXTENSIONS[type];
    if (!extension) return stop(415, "Format d'image non pris en charge.");
    const declared = Number(upstream.headers.get("content-length") ?? "0");
    if (declared > maxBytes) return stop(413, "Image trop lourde.");

    let received = 0;
    const body = upstream.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, stream) {
          received += chunk.byteLength;
          if (received > maxBytes) stream.error(new Error("Image trop lourde."));
          else stream.enqueue(chunk);
        },
        flush() {
          clearTimeout(timer);
        },
      })
    );
    return { ok: true, body, type, extension };
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}
