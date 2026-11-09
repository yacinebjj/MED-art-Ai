"use client";

import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Download, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { MEDICAL_IMAGE_SOURCE_LABELS, type VerifiedMedicalImage } from "@/lib/medical-images";
import { medicalImageDownloadHref, medicalImageViewHref } from "@/lib/medical-image-client";

const ICON_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40";

/** "Wikimedia Commons · CC BY-SA 3.0 · Author" — the credit shown under a picture and in its full-screen view (plain text: no link leaves MedArt). */
export function medicalImageCredit(image: VerifiedMedicalImage): string {
  return [MEDICAL_IMAGE_SOURCE_LABELS[image.source], image.license, image.credit].filter(Boolean).join(" · ");
}

/**
 * A Copilot picture full screen, inside MedArt (product order 2026-11-09: a
 * click never sends the student to another site): the sharpest version the
 * repository has, a click (or the button) zooms in on the clicked spot, and
 * "Télécharger" saves it through MedArt's own address. Escape, the close
 * button or a click on the backdrop close it. Like the figure, it loads the
 * picture from MedArt's own address first (some connections can't reach the
 * repositories at all), then from the repository's.
 */
export function MedicalImageLightbox({
  image,
  caption,
  open,
  onOpenChange,
}: {
  image: VerifiedMedicalImage;
  caption: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [zoomWidth, setZoomWidth] = useState<number | null>(null);
  // The sharp version, then the reply's one — each from MedArt's address, then from the repository's.
  const addresses = useMemo(() => {
    const versions = Array.from(new Set([image.zoomSrc, image.src].filter((version): version is string => Boolean(version))));
    return [...versions.map(medicalImageViewHref), ...versions];
  }, [image.zoomSrc, image.src]);
  const [attempt, setAttempt] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const focusRef = useRef({ x: 0.5, y: 0.5 });
  const full = addresses[Math.min(attempt, addresses.length - 1)];
  const label = caption || image.title;

  function zoomTo(focus: { x: number; y: number }) {
    const natural = imageRef.current?.naturalWidth ?? 0;
    const viewWidth = scrollRef.current?.clientWidth ?? 0;
    focusRef.current = focus;
    // At least twice the view's width: a close look, even at a small picture.
    setZoomWidth(Math.max(natural, viewWidth * 2, 1));
  }

  function handleImageClick(event: ReactMouseEvent<HTMLImageElement>) {
    if (zoomWidth !== null) {
      setZoomWidth(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    zoomTo({
      x: rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5,
      y: rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5,
    });
  }

  // Keeps the zoomed-on spot in the middle of the view.
  useLayoutEffect(() => {
    if (zoomWidth === null) return;
    const container = scrollRef.current;
    const picture = imageRef.current;
    if (!container || !picture) return;
    container.scrollLeft = Math.max(0, picture.offsetWidth * focusRef.current.x - container.clientWidth / 2);
    container.scrollTop = Math.max(0, picture.offsetHeight * focusRef.current.y - container.clientHeight / 2);
  }, [zoomWidth]);

  function handleOpenChange(next: boolean) {
    if (!next) setZoomWidth(null);
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        sheetOnMobile={false}
        onOverlayClick={() => handleOpenChange(false)}
        className="inset-2 flex h-auto max-h-none w-auto max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden border-white/10 bg-zinc-950 p-0 text-white sm:inset-4 [&>button:last-child:hover]:bg-white/10 [&>button:last-child:hover]:text-white [&>button:last-child]:text-white/75"
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-white/10 py-2 pl-4 pr-14">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-semibold text-white">{label}</DialogTitle>
            <DialogDescription className="truncate text-xs text-white/60">{medicalImageCredit(image)}</DialogDescription>
          </div>
          <button
            type="button"
            onClick={() => (zoomWidth === null ? zoomTo({ x: 0.5, y: 0.5 }) : setZoomWidth(null))}
            aria-label={zoomWidth === null ? "Zoom avant" : "Zoom arrière"}
            title={zoomWidth === null ? "Zoom avant" : "Zoom arrière"}
            className={ICON_BUTTON}
          >
            {zoomWidth === null ? <ZoomIn className="h-4 w-4" /> : <ZoomOut className="h-4 w-4" />}
          </button>
          <a href={medicalImageDownloadHref(image, caption)} download aria-label="Télécharger" title="Télécharger" className={ICON_BUTTON}>
            <Download className="h-4 w-4" />
          </a>
        </div>
        <div
          ref={scrollRef}
          className={cn("min-h-0 flex-1 overflow-auto overscroll-contain", zoomWidth === null && "flex items-center justify-center p-3 sm:p-6")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a verified repository picture, served by MedArt's own image route */}
          <img
            ref={imageRef}
            src={full}
            alt={label}
            draggable={false}
            decoding="async"
            onClick={handleImageClick}
            onError={() => setAttempt((current) => Math.min(current + 1, addresses.length - 1))}
            style={zoomWidth === null ? undefined : { width: zoomWidth }}
            // A light paper behind the picture: only a transparent diagram lets it show, and its black labels need it on this dark view.
            className={cn(
              "select-none rounded-xl bg-slate-100",
              zoomWidth === null ? "max-h-full max-w-full cursor-zoom-in object-contain" : "h-auto max-w-none cursor-zoom-out"
            )}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
