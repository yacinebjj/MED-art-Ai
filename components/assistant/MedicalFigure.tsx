"use client";

import {
  memo,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
} from "react";
import { cn } from "@/lib/utils";
import { MAX_IMAGE_SRC_CHARS, type MedicalImageResolution, type VerifiedMedicalImage } from "@/lib/medical-images";
import {
  markMedicalImagePainted,
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

function stopPropagation(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * An image a Copilot reply embedded (Markdown ![description](link)) — shown
 * only as a VERIFIED picture from an open repository (lib/medical-images.ts),
 * never as the link the model wrote:
 *  - a quiet placeholder while the link is checked, then the picture flush
 *    and rounded, no frame (product order 2026-11-09). A light paper sits
 *    behind it in dark mode — only a transparent diagram lets it show, and
 *    its black labels need it; a photo covers it entirely;
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
  const [failed, setFailed] = useState<readonly string[]>([]);
  const [paintedSrc, setPaintedSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

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

  useEffect(() => {
    if (image) rememberShownMedicalImage(link, image);
  }, [link, image]);

  if (resolution === null || (resolution !== undefined && image === null)) return null;

  if (resolution === undefined || image === undefined || image === null) {
    return (
      <span aria-hidden="true" className="not-prose my-[1em] block">
        <span className="block h-40 w-full animate-pulse rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]" />
      </span>
    );
  }

  const shown = image;
  const label = caption || shown.title;
  const painted = paintedSrc === shown.src || wasMedicalImagePainted(shown.src);
  const openViewer = () => setOpen(true);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openViewer();
    }
  };

  return (
    <span role="figure" aria-label={label} className="not-prose my-[1em] block">
      <span
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-label={`Agrandir l'image : ${label}`}
        title="Agrandir"
        onClick={openViewer}
        onKeyDown={handleKeyDown}
        className="mx-auto block w-fit max-w-full cursor-zoom-in rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a verified repository picture, served by the repository itself (next/image would re-host it) */}
        <img
          key={shown.src}
          src={shown.src}
          width={shown.width ?? undefined}
          height={shown.height ?? undefined}
          alt={label}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => {
            markMedicalImagePainted(shown.src);
            setPaintedSrc(shown.src);
          }}
          onError={() => setFailed((previous) => (previous.includes(shown.src) ? previous : [...previous, shown.src]))}
          className={cn(
            "block h-auto max-h-[min(26rem,60vh)] w-auto max-w-full rounded-2xl bg-transparent transition-opacity duration-300 dark:bg-slate-100",
            painted ? "opacity-100" : "opacity-0"
          )}
        />
      </span>
      <span dir="auto" className="mt-2 block px-1 text-center text-[0.78em] leading-snug text-slate-500 dark:text-zinc-400">
        {caption && <span className="font-medium text-slate-600 dark:text-zinc-300">{caption} · </span>}
        {medicalImageCredit(shown)}
      </span>
      {/* The full-screen view is portaled, but React still bubbles its events through here: they stop at this figure. */}
      <span onClick={stopPropagation} onKeyDown={stopPropagation} className="contents">
        <MedicalImageLightbox image={shown} caption={caption} open={open} onOpenChange={setOpen} />
      </span>
    </span>
  );
}
