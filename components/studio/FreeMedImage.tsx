"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { medicalImageViewHref } from "@/lib/medical-image-client";
import {
  MEDICAL_IMAGE_SOURCE_LABELS,
  commonsFilePageUrl,
  isAttributionFreeLicense,
  licenseDeedUrl,
  type MedicalImageSource,
} from "@/lib/medical-images";
import { MAX_FREE_MED_IMAGE_QUERY_CHARS } from "@/lib/studio-visuals";
import { cn } from "@/lib/utils";

/**
 * <FreeMedImage query="…" /> — a picture inside a Studio Explication
 * (lib/studio-visuals.ts). $0: app/api/studio/free-med-image searches MedArt's
 * free repository engine (Wikimedia Commons, PubMed Central, Wellcome — public
 * APIs, no AI, no key) hard for a picture of `query`, and the browser loads it
 * from MedArt's own address, never from the repository.
 *
 * The picture itself, in a rounded glass frame, with a glass skeleton until it
 * arrives — and, when its license asks for credit (CC BY, CC BY-SA…), a
 * microscopic glass pill in its bottom-right corner ("© Wikimedia") that
 * unfolds on a tap into the author, the license and the source (product
 * order 2026-11-12). Public-domain and CC0 pictures carry nothing. Nothing at
 * all when no picture fits or none loads.
 *
 * The search starts only when the picture comes near the screen (a long
 * lesson's pictures never all ask at once), each term is asked once per page
 * session, and a picture that fails to load gives way to the next result.
 * Markup is spans, a button and links only, so it stays valid inside a
 * paragraph, and the frame is skipped by the reading surface's text index
 * (data-reading-skip).
 */

interface FreeImage {
  src: string;
  width: number | null;
  height: number | null;
  source: MedicalImageSource | null;
  credit: string | null;
  license: string | null;
}

const API = "/api/studio/free-med-image";
/** Part of the lookup's address: answers cached by browsers before the license unlock (2026-11-12) are never reused. */
const API_VERSION = "2";
/** Searched ahead of the scroll, so the picture is usually there when the student reaches it. */
const NEAR_SCREEN_MARGIN = "900px 0px";
/** A picture that hasn't arrived by then gives way to the next result. */
const LOAD_TIMEOUT_MS = 30_000;
/** Frame proportions while nothing is known yet. */
const DEFAULT_RATIO = 16 / 10;
/** The pill's one word per repository. */
const SOURCE_SHORT: Record<MedicalImageSource, string> = { wikimedia: "Wikimedia", pmc: "PMC", wellcome: "Wellcome" };

const lookups = new Map<string, Promise<FreeImage[]>>();

const textOrNull = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

function readImage(value: unknown): FreeImage | null {
  const image = value as Record<string, unknown> | null;
  if (!image || typeof image.src !== "string" || !image.src.startsWith("https://")) return null;
  const source = typeof image.source === "string" && image.source in SOURCE_SHORT ? (image.source as MedicalImageSource) : null;
  return {
    src: image.src,
    width: numberOrNull(image.width),
    height: numberOrNull(image.height),
    source,
    credit: textOrNull(image.credit),
    license: textOrNull(image.license),
  };
}

/** The pictures for `query`, best first — asked once per term; a failed lookup (network, rate limit) may be asked again later. */
function findImages(query: string): Promise<FreeImage[]> {
  const known = lookups.get(query);
  if (known) return known;
  const lookup = fetch(`${API}?${new URLSearchParams({ q: query, v: API_VERSION }).toString()}`, { credentials: "same-origin" })
    .then(async (response) => {
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { images?: unknown };
      return Array.isArray(body.images) ? body.images.map(readImage).filter((image): image is FreeImage => image !== null) : [];
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

/** The picture's credit: a microscopic "© Wikimedia" pill that unfolds, on a tap, into author · license · source. */
function ImageCredit({ image }: { image: FreeImage }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const sourceLabel = image.source ? MEDICAL_IMAGE_SOURCE_LABELS[image.source] : null;
  const deed = licenseDeedUrl(image.license);
  const page = image.source === "wikimedia" ? commonsFilePageUrl(image.src) : null;
  const summary = [image.credit, image.license, sourceLabel].filter(Boolean).join(" · ");

  // A tap anywhere else folds it back.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const parts: ReactNode[] = [];
  if (image.credit) parts.push(<span key="credit">{image.credit}</span>);
  if (image.license) {
    parts.push(
      deed ? (
        <a key="license" href={deed} target="_blank" rel="license noopener noreferrer">
          {image.license}
        </a>
      ) : (
        <span key="license">{image.license}</span>
      )
    );
  }
  if (sourceLabel) {
    parts.push(
      page ? (
        <a key="source" href={page} target="_blank" rel="noopener noreferrer">
          {sourceLabel}
        </a>
      ) : (
        <span key="source">{sourceLabel}</span>
      )
    );
  }

  return (
    <span ref={rootRef} className="free-med-image-credit">
      {open && (
        <span className="free-med-image-credit-detail">
          {parts.map((part, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden> · </span>}
              {part}
            </Fragment>
          ))}
        </span>
      )}
      <button
        type="button"
        className="free-med-image-credit-pill"
        aria-expanded={open}
        aria-label={`Crédit de l'image : ${summary}`}
        title={summary}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        © {image.source ? SOURCE_SHORT[image.source] : "Source"}
      </button>
    </span>
  );
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
  const needsCredit = Boolean(current) && !isAttributionFreeLicense(current?.license);

  return (
    <span ref={frameRef} data-reading-skip="" className="free-med-image not-prose my-[1.4em] block">
      <span className="free-med-image-frame">
        <span className={cn("relative block w-full rounded-[0.9em] text-center", !loaded && "overflow-hidden")} style={loaded ? undefined : frameStyle}>
          {!loaded && (
            <span aria-hidden className="studio-visual-skeleton absolute inset-0">
              <span className="studio-visual-shimmer" />
            </span>
          )}
          {current && (
            <span className={loaded ? "relative inline-block max-w-full align-top" : "absolute inset-0"}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a same-origin proxied picture of unknown size, not a static asset */}
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
                  "block rounded-[0.9em] bg-white object-contain transition-opacity duration-500",
                  loaded ? "h-auto max-h-[26em] w-auto max-w-full opacity-100" : "h-full w-full opacity-0"
                )}
              />
              {loaded && needsCredit && <ImageCredit image={current} />}
            </span>
          )}
        </span>
      </span>
    </span>
  );
}
