"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { medicalImageViewHref } from "@/lib/medical-image-client";
import { MAX_FREE_MED_IMAGE_QUERY_CHARS } from "@/lib/studio-visuals";
import { cn } from "@/lib/utils";

/**
 * <FreeMedImage query="…" /> — a picture inside a Studio Explication
 * (lib/studio-visuals.ts). $0: app/api/studio/free-med-image searches MedArt's
 * free repository engine (Wikimedia Commons, PubMed Central, Wellcome — public
 * APIs, no AI, no key) for a CC0 / public-domain picture of `query`, and the
 * browser loads it from MedArt's own address, never from the repository.
 *
 * Shows ONLY the picture — no caption, source, credit or link (product order
 * 2026-11-12) — in a rounded glass frame, with a glass skeleton until it
 * arrives. Nothing at all when no picture fits or none loads.
 *
 * The search starts only when the picture comes near the screen (a long
 * lesson's pictures never all ask at once), each term is asked once per page
 * session, and a picture that fails to load gives way to the next result.
 * Markup is spans only, so it stays valid inside a paragraph, and the frame is
 * skipped by the reading surface's text index (data-reading-skip).
 */

interface FreeImage {
  src: string;
  width: number | null;
  height: number | null;
}

const API = "/api/studio/free-med-image";
/** Searched ahead of the scroll, so the picture is usually there when the student reaches it. */
const NEAR_SCREEN_MARGIN = "900px 0px";
/** A picture that hasn't arrived by then gives way to the next result. */
const LOAD_TIMEOUT_MS = 30_000;
/** Frame proportions while nothing is known yet. */
const DEFAULT_RATIO = 16 / 10;

const lookups = new Map<string, Promise<FreeImage[]>>();

function isFreeImage(value: unknown): value is FreeImage {
  const image = value as Partial<FreeImage> | null;
  return Boolean(image) && typeof image?.src === "string" && image.src.startsWith("https://");
}

/** The pictures for `query`, best first — asked once per term; a failed lookup (network, rate limit) may be asked again later. */
function findImages(query: string): Promise<FreeImage[]> {
  const known = lookups.get(query);
  if (known) return known;
  const lookup = fetch(`${API}?${new URLSearchParams({ q: query }).toString()}`, { credentials: "same-origin" })
    .then(async (response) => {
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { images?: unknown };
      return Array.isArray(body.images) ? body.images.filter(isFreeImage) : [];
    })
    .catch(() => {
      lookups.delete(query);
      return [] as FreeImage[];
    });
  lookups.set(query, lookup);
  return lookup;
}

function cleanQuery(query: unknown): string {
  return typeof query === "string" ? query.replace(/\s+/g, " ").trim().slice(0, MAX_FREE_MED_IMAGE_QUERY_CHARS).trim() : "";
}

export function FreeMedImage({ query }: { query?: string }) {
  const term = cleanQuery(query);
  const frameRef = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [images, setImages] = useState<FreeImage[] | null>(null);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // Start once the frame is near the screen.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || near) return;
    if (typeof IntersectionObserver !== "function") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: NEAR_SCREEN_MARGIN }
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near || !term) return;
    let cancelled = false;
    setImages(null);
    setIndex(0);
    setLoaded(false);
    findImages(term).then((found) => {
      if (!cancelled) setImages(found);
    });
    return () => {
      cancelled = true;
    };
  }, [near, term]);

  const current = images?.[index] ?? null;

  // A picture that never arrives gives way to the next one.
  useEffect(() => {
    if (!current || loaded) return;
    const timer = window.setTimeout(() => setIndex((value) => value + 1), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [current, loaded]);

  if (!term) return null;
  // Searched, and nothing (left) to show.
  if (images !== null && !current) return null;

  const ratio = current?.width && current?.height ? current.width / current.height : DEFAULT_RATIO;
  const frameStyle: CSSProperties = { aspectRatio: String(ratio) };

  return (
    <span ref={frameRef} data-reading-skip="" className="free-med-image not-prose my-[1.4em] block">
      <span className="free-med-image-frame">
        <span className="relative block w-full overflow-hidden rounded-[0.9em]" style={loaded ? undefined : frameStyle}>
          {!loaded && (
            <span aria-hidden className="studio-visual-skeleton absolute inset-0">
              <span className="studio-visual-shimmer" />
            </span>
          )}
          {current && (
            // eslint-disable-next-line @next/next/no-img-element -- a same-origin proxied picture of unknown size, not a static asset
            <img
              key={current.src}
              src={medicalImageViewHref(current.src)}
              alt={term}
              decoding="async"
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => {
                setLoaded(false);
                setIndex((value) => value + 1);
              }}
              className={cn(
                "mx-auto block h-auto max-h-[26em] w-auto max-w-full bg-white object-contain transition-opacity duration-500",
                loaded ? "opacity-100" : "absolute inset-0 h-full w-full opacity-0"
              )}
            />
          )}
        </span>
      </span>
    </span>
  );
}
