"use client";

import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
} from "react";
import { cn } from "@/lib/utils";
import { MAX_IMAGE_SRC_CHARS, type MedicalImageResolution, type VerifiedMedicalImage } from "@/lib/medical-images";
import {
  MEDICAL_IMAGE_LOAD_TIMEOUT_MS,
  markMedicalImagePainted,
  medicalImageViewHref,
  peekMedicalImage,
  rememberShownMedicalImage,
  resolveMedicalImageInBrowser,
  wasMedicalImagePainted,
} from "@/lib/medical-image-client";
import { FigureBlockContext, FigureRegistryContext } from "@/lib/medical-figure-registry";
import { MedicalImageLightbox, medicalImageCredit } from "@/components/assistant/MedicalImageLightbox";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const noSubscription = () => () => undefined;
/** Places within a reply: block index × this + offset in the block. */
const BLOCK_SPAN = 10_000_000;
/** The quiet placeholder: while the link is checked, then while its picture arrives. */
const PLACEHOLDER = "relative block h-40 w-full animate-pulse overflow-hidden rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]";

function stopPropagation(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * An image a Copilot reply embedded (Markdown ![description](link)) — shown
 * only as a VERIFIED picture from an open repository (lib/medical-images.ts),
 * never as the link the model wrote:
 *  - a quiet placeholder while the link is checked AND while the picture
 *    arrives; the picture, its caption and its credit appear together, once
 *    it is really there — never a caption over an empty space;
 *  - loaded from MedArt's own address (app/api/assistant/medical-image/view),
 *    then from the repository's if that fails, each given a bounded wait.
 *    Diagnosed 2026-11-09 ("the image never renders, only its caption and
 *    credit"): from a student's connection every Wikimedia host timed out at
 *    the connection itself, so a picture loaded straight from Wikimedia
 *    neither arrived nor failed, and stayed invisible under its caption;
 *  - the picture flush and rounded, no frame (product order 2026-11-09). A
 *    light paper sits behind it in dark mode — only a transparent diagram
 *    lets it show, and its black labels need it; a photo covers it entirely;
 *  - the reply's description as its caption, then the repository, license
 *    and author, as plain text;
 *  - a click (Enter, Space) opens it full screen inside MedArt, with zoom and
 *    download (components/assistant/MedicalImageLightbox.tsx) — never another
 *    site;
 *  - in a reply with several pictures, never the same one twice: the reply's
 *    registry (lib/medical-figure-registry.ts) gives each figure, in reply
 *    order, its first candidate no earlier figure shows; one that fails to
 *    load gives way to its next candidate;
 *  - no picture fits, or none loads: nothing at all, never a broken image.
 *
 * Built from <span>s on purpose: Markdown puts an image inside a paragraph,
 * where a <figure>, <div> or <button> would be invalid or would carry a
 * button's look into a saved note or a PDF export.
 */
export const MedicalFigure = memo(function MedicalFigure({ src, alt, offset = 0 }: { src?: string; alt?: string; offset?: number }) {
  const link = typeof src === "string" ? src.trim() : "";
  const caption = (alt ?? "").replace(/\s+/g, " ").trim();
  if (!/^https?:\/\//i.test(link) || link.length > MAX_IMAGE_SRC_CHARS) return null;
  // Keyed by the image itself: another link (the reply still streaming, a regenerated answer) starts over.
  return <ResolvedFigure key={`${link}\u0000${caption}`} link={link} caption={caption} offset={offset} />;
});

function ResolvedFigure({ link, caption, offset }: { link: string; caption: string; offset: number }) {
  const registry = useContext(FigureRegistryContext);
  const block = useContext(FigureBlockContext);
  const id = useId();
  const order = block * BLOCK_SPAN + offset;
  const [resolution, setResolution] = useState<MedicalImageResolution | null | undefined>(() => peekMedicalImage(link, caption));
  /** Pictures that failed at every address: the figure moves on to its next candidate. */
  const [failed, setFailed] = useState<readonly string[]>([]);
  /** Pictures MedArt's address couldn't serve: loaded from the repository's own address instead. */
  const [directOnly, setDirectOnly] = useState<readonly string[]>([]);
  /** The address whose picture has arrived — and the one to fade in (a first paint only). */
  const [loadedView, setLoadedView] = useState<string | null>(null);
  const [fadeView, setFadeView] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const pictureRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (resolution !== undefined) return;
    let cancelled = false;
    void resolveMedicalImageInBrowser(link, caption).then((result) => {
      if (!cancelled) setResolution(result);
    });
    return () => {
      cancelled = true;
    };
  }, [resolution, link, caption]);

  const candidates = useMemo(
    () => (resolution ? [resolution.image, ...resolution.alternatives].filter((candidate) => !failed.includes(candidate.src)) : []),
    [resolution, failed]
  );
  const candidateList = candidates.map((candidate) => candidate.src).join("\n");

  // Registered before the browser paints, so a figure never flashes a picture an earlier one already shows.
  useBrowserLayoutEffect(() => {
    if (!registry) return;
    if (candidateList) registry.register(id, order, candidateList.split("\n"));
    else registry.unregister(id);
  }, [registry, id, order, candidateList]);
  useEffect(() => () => registry?.unregister(id), [registry, id]);

  const assigned = useSyncExternalStore(
    registry ? registry.subscribe : noSubscription,
    () => (registry ? registry.chosen(id) : undefined),
    () => undefined
  );

  let image: VerifiedMedicalImage | null | undefined;
  if (!registry) image = candidates[0] ?? null;
  else if (candidates.length === 0) image = null;
  else if (assigned === undefined) image = undefined;
  else image = assigned === null ? null : (candidates.find((candidate) => candidate.src === assigned) ?? null);

  // Where the picture is loaded from: MedArt's own address, the repository's if MedArt's can't serve it.
  const imageSrc = image ? image.src : null;
  const view = imageSrc === null ? null : directOnly.includes(imageSrc) ? imageSrc : medicalImageViewHref(imageSrc);
  // Shown only once THIS element has its picture (its load event, or the browser already holding it) —
  // never because the same picture arrived elsewhere earlier: a copy that hangs must not show an empty frame.
  const loaded = view !== null && loadedView === view;

  const showPicture = useCallback((address: string) => {
    // A picture seen before in this visit (a re-mounted block) doesn't fade in a second time.
    if (!wasMedicalImagePainted(address)) setFadeView(address);
    markMedicalImagePainted(address);
    setLoadedView(address);
  }, []);
  const giveUp = useCallback((address: string, src: string) => {
    if (address === src) setFailed((previous) => (previous.includes(src) ? previous : [...previous, src]));
    else setDirectOnly((previous) => (previous.includes(src) ? previous : [...previous, src]));
  }, []);

  // Already in the browser (a re-mounted block, a cached picture): the element is complete as soon as its
  // address is set, so it is shown before the first paint — no placeholder flash, no wait for the load event.
  useBrowserLayoutEffect(() => {
    const picture = pictureRef.current;
    if (view !== null && picture?.complete && picture.naturalWidth > 0) showPicture(view);
  }, [view, showPicture]);

  // A request that never ends — an unreachable host hangs rather than fails — gives way to the next address.
  useEffect(() => {
    if (view === null || imageSrc === null || loaded) return;
    const wait = view === imageSrc ? MEDICAL_IMAGE_LOAD_TIMEOUT_MS.direct : MEDICAL_IMAGE_LOAD_TIMEOUT_MS.viaMedArt;
    const timer = window.setTimeout(() => giveUp(view, imageSrc), wait);
    return () => window.clearTimeout(timer);
  }, [view, imageSrc, loaded, giveUp]);

  useEffect(() => {
    if (image) rememberShownMedicalImage(link, image);
  }, [link, image]);

  if (resolution === null || (resolution !== undefined && image === null)) return null;

  if (resolution === undefined || image === undefined || image === null || view === null) {
    return (
      <span aria-hidden="true" className="not-prose my-[1em] block">
        <span className={PLACEHOLDER} />
      </span>
    );
  }

  const shown = image;
  const address = view;
  const label = caption || shown.title;
  const openViewer = () => setOpen(true);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openViewer();
    }
  };

  // The same elements while the picture arrives and once it's there: it is downloaded once, into the
  // placeholder (invisible), then takes its place — with its caption and credit, never before.
  return (
    <span role={loaded ? "figure" : undefined} aria-label={loaded ? label : undefined} aria-hidden={loaded ? undefined : true} className="not-prose my-[1em] block">
      <span
        role={loaded ? "button" : undefined}
        tabIndex={loaded ? 0 : undefined}
        aria-haspopup={loaded ? "dialog" : undefined}
        aria-label={loaded ? `Agrandir l'image : ${label}` : undefined}
        title={loaded ? "Agrandir" : undefined}
        onClick={loaded ? openViewer : undefined}
        onKeyDown={loaded ? handleKeyDown : undefined}
        className={
          loaded
            ? "mx-auto block w-fit max-w-full cursor-zoom-in rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950"
            : PLACEHOLDER
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a verified repository picture, served by MedArt's own image route (next/image would bill an optimisation per picture) */}
        <img
          key={address}
          ref={pictureRef}
          src={address}
          width={shown.width ?? undefined}
          height={shown.height ?? undefined}
          alt={label}
          decoding="async"
          draggable={false}
          onLoad={() => showPicture(address)}
          onError={() => giveUp(address, shown.src)}
          className={
            loaded
              ? cn(
                  "block h-auto max-h-[min(26rem,60vh)] w-auto max-w-full rounded-2xl bg-transparent dark:bg-slate-100",
                  fadeView === address && "animate-in fade-in duration-300"
                )
              : "absolute inset-0 h-full w-full opacity-0"
          }
        />
      </span>
      {loaded && (
        <span dir="auto" className="mt-2 block px-1 text-center text-[0.78em] leading-snug text-slate-500 dark:text-zinc-400">
          {caption && <span className="font-medium text-slate-600 dark:text-zinc-300">{caption} · </span>}
          {medicalImageCredit(shown)}
        </span>
      )}
      {/* The full-screen view is portaled, but React still bubbles its events through here: they stop at this figure
          (its drags and wheel never reach the thread's scroll tracking either). */}
      {loaded && (
        <span
          onClick={stopPropagation}
          onKeyDown={stopPropagation}
          onPointerDown={stopPropagation}
          onPointerMove={stopPropagation}
          onPointerUp={stopPropagation}
          onTouchStart={stopPropagation}
          onTouchMove={stopPropagation}
          onWheel={stopPropagation}
          className="contents"
        >
          <MedicalImageLightbox key={shown.src} image={shown} caption={caption} open={open} onOpenChange={setOpen} />
        </span>
      )}
    </span>
  );
}
