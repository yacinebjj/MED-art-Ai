"use client";

import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Download, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MEDICAL_IMAGE_SOURCE_LABELS, type VerifiedMedicalImage } from "@/lib/medical-images";
import { medicalImageDownloadHref, medicalImageViewHref } from "@/lib/medical-image-client";

/** "Wikimedia Commons · CC BY-SA 3.0 · Author" — the credit shown under a picture and in its full-screen view (plain text: no link leaves MedArt). */
export function medicalImageCredit(image: VerifiedMedicalImage): string {
  return [MEDICAL_IMAGE_SOURCE_LABELS[image.source], image.license, image.credit].filter(Boolean).join(" · ");
}

/** A floating control: a frosted disc with one white glyph (44 px: a thumb's size). */
const CONTROL =
  "touch-target pointer-events-auto relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-inset ring-white/15 backdrop-blur-md transition-colors duration-200 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70";

/** A tap zooms in at least this much (a small picture still gets a close look) and at most this much. */
const MIN_ZOOM = 2;
const MAX_ZOOM = 4;
/** Movement under this is a tap, not a drag. */
const TAP_SLOP_PX = 8;
/** A swipe this far — or a flick of at least FLICK_MIN_PX — closes the viewer. */
const SWIPE_CLOSE_PX = 110;
const SWIPE_CLOSE_VELOCITY = 0.6;
const FLICK_MIN_PX = 40;
/** The arrow keys move a zoomed picture this much. */
const KEY_PAN_PX = 96;
const KEY_PAN: Record<string, readonly [number, number] | undefined> = {
  ArrowLeft: [KEY_PAN_PX, 0],
  ArrowRight: [-KEY_PAN_PX, 0],
  ArrowUp: [0, KEY_PAN_PX],
  ArrowDown: [0, -KEY_PAN_PX],
};

interface Zoom {
  scale: number;
  x: number;
  y: number;
}

interface Gesture {
  pointerId: number;
  /** pan: a zoomed picture follows the finger · swipe: the whole picture, to close · idle: sideways, ignored · pending: not moved yet. */
  mode: "pending" | "pan" | "swipe" | "idle";
  startX: number;
  startY: number;
  lastY: number;
  lastTime: number;
  velocity: number;
  originX: number;
  originY: number;
  panX: number;
  panY: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * A Copilot picture full screen, inside MedArt (product orders 2026-11-09 and
 * 2026-11-10): the picture alone on a frosted backdrop, with two floating
 * controls — download (through MedArt's own address) and close — and its
 * caption and credit quietly underneath. It springs up when opened and sinks
 * back when closed (app/globals.css, the picture viewer).
 *  - A tap (a click, Enter) zooms in on that spot, the full-size picture pixel
 *    for pixel (MIN_ZOOM–MAX_ZOOM); a drag, the wheel or the arrow keys then
 *    move it around; another tap zooms back out.
 *  - Dismissing is effortless: a tap on the backdrop, a swipe of the picture
 *    up or down, Escape, or ✕.
 *  - The sharp version is loaded from MedArt's own address first (some
 *    connections can't reach the repositories at all), then the reply's
 *    version, then each from the repository's address.
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
  const addresses = useMemo(() => {
    const versions = Array.from(new Set([image.zoomSrc, image.src].filter((version): version is string => Boolean(version))));
    return [...versions.map(medicalImageViewHref), ...versions];
  }, [image.zoomSrc, image.src]);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pictureRef = useRef<HTMLImageElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  /** The pointer moved past a tap: the click that ends this drag is ignored. */
  const movedRef = useRef(false);
  const wheelTimerRef = useRef(0);
  const full = addresses[Math.min(attempt, addresses.length - 1)];
  const label = caption || image.title;

  function handleOpenChange(next: boolean) {
    if (!next) setZoom(null);
    onOpenChange(next);
  }

  /** Keeps a picture zoomed `scale` times from showing past its edges (centred when it is smaller than the screen). */
  function within(scale: number, x: number, y: number): Zoom {
    const picture = pictureRef.current;
    const stage = stageRef.current;
    if (!picture || !stage) return { scale, x: 0, y: 0 };
    const view = stage.getBoundingClientRect();
    // offsetWidth/Height: the fitted size, which the zoom's scale leaves alone.
    const limitX = Math.max(0, (picture.offsetWidth * scale - view.width) / 2);
    const limitY = Math.max(0, (picture.offsetHeight * scale - view.height) / 2);
    return { scale, x: clamp(x, -limitX, limitX) || 0, y: clamp(y, -limitY, limitY) || 0 };
  }

  /** Zooms in on a point of the picture (its centre from the keyboard), which stays under the finger. */
  function zoomIn(clientX: number | null, clientY: number | null) {
    const picture = pictureRef.current;
    if (!picture) return;
    const fitted = picture.offsetWidth;
    const scale = clamp(fitted > 0 && picture.naturalWidth > 0 ? picture.naturalWidth / fitted : MIN_ZOOM, MIN_ZOOM, MAX_ZOOM);
    const box = picture.getBoundingClientRect();
    const dx = clientX === null ? 0 : clientX - (box.left + box.width / 2);
    const dy = clientY === null ? 0 : clientY - (box.top + box.height / 2);
    setZoom(within(scale, -(scale - 1) * dx, -(scale - 1) * dy));
  }

  function handlePictureClick(event: ReactMouseEvent<HTMLButtonElement>) {
    if (movedRef.current) return;
    if (zoom) {
      setZoom(null);
      return;
    }
    const fromKeyboard = event.detail === 0;
    zoomIn(fromKeyboard ? null : event.clientX, fromKeyboard ? null : event.clientY);
  }

  function handlePictureKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const step = KEY_PAN[event.key];
    if (!zoom || !step) return;
    event.preventDefault();
    setZoom(within(zoom.scale, zoom.x + step[0], zoom.y + step[1]));
  }

  // A tap on the backdrop closes (never the end of a drag, never a control or the picture).
  function handleContentClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (movedRef.current) return;
    if ((event.target as HTMLElement).closest("[data-lightbox-control], [data-lightbox-picture]")) return;
    handleOpenChange(false);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (gestureRef.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    movedRef.current = false;
    if ((event.target as HTMLElement).closest("[data-lightbox-control]")) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      mode: zoom ? "pan" : "pending",
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocity: 0,
      originX: zoom?.x ?? 0,
      originY: zoom?.y ?? 0,
      panX: zoom?.x ?? 0,
      panY: zoom?.y ?? 0,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const now = performance.now();
    gesture.velocity = (event.clientY - gesture.lastY) / Math.max(1, now - gesture.lastTime);
    gesture.lastY = event.clientY;
    gesture.lastTime = now;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!movedRef.current) {
      if (Math.hypot(dx, dy) < TAP_SLOP_PX) return;
      movedRef.current = true;
      if (gesture.mode === "pending") gesture.mode = Math.abs(dy) > Math.abs(dx) ? "swipe" : "idle";
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Already released: the drag still works uncaptured.
      }
    }
    const picture = pictureRef.current;
    const stage = stageRef.current;
    if (gesture.mode === "pan" && zoom && picture) {
      const next = within(zoom.scale, gesture.originX + dx, gesture.originY + dy);
      gesture.panX = next.x;
      gesture.panY = next.y;
      picture.setAttribute("data-gesture", "");
      picture.style.translate = `${next.x}px ${next.y}px`;
    } else if (gesture.mode === "swipe" && stage) {
      stage.setAttribute("data-gesture", "");
      stage.style.translate = `0 ${dy}px`;
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.setAttribute("data-gesture", "");
        overlay.style.opacity = String(1 - Math.min(0.8, Math.abs(dy) / 400));
      }
    }
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    const picture = pictureRef.current;
    const stage = stageRef.current;
    const overlay = overlayRef.current;
    if (gesture.mode === "pan") {
      picture?.removeAttribute("data-gesture");
      if (movedRef.current && zoom) setZoom({ scale: zoom.scale, x: gesture.panX, y: gesture.panY });
      return;
    }
    if (gesture.mode !== "swipe" || !stage) return;
    stage.removeAttribute("data-gesture");
    overlay?.removeAttribute("data-gesture");
    const offset = gesture.lastY - gesture.startY;
    // A finger that paused before lifting isn't a flick.
    const flick = performance.now() - gesture.lastTime > 100 ? 0 : gesture.velocity;
    if (event.type !== "pointercancel" && (Math.abs(offset) > SWIPE_CLOSE_PX || (Math.abs(offset) > FLICK_MIN_PX && Math.abs(flick) > SWIPE_CLOSE_VELOCITY))) {
      handleOpenChange(false);
      return;
    }
    // Not far enough: the picture springs back and the backdrop returns.
    stage.style.translate = "";
    if (overlay) overlay.style.opacity = "";
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const picture = pictureRef.current;
    if (!zoom || !picture) return;
    picture.setAttribute("data-gesture", "");
    setZoom(within(zoom.scale, zoom.x - event.deltaX, zoom.y - event.deltaY));
    window.clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = window.setTimeout(() => pictureRef.current?.removeAttribute("data-gesture"), 160);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay ref={overlayRef} className="lightbox-overlay fixed inset-0 z-[1100] bg-black/85 backdrop-blur-xl" />
        <DialogPrimitive.Content
          data-zoomed={zoom ? "" : undefined}
          onClick={handleContentClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onWheel={handleWheel}
          className="lightbox-content fixed inset-0 z-[1100] touch-none select-none overflow-hidden outline-none"
        >
          <div ref={stageRef} className="lightbox-stage flex h-full w-full items-center justify-center px-3 sm:px-12">
            <button
              type="button"
              data-lightbox-picture=""
              onClick={handlePictureClick}
              onKeyDown={handlePictureKeyDown}
              aria-label={zoom ? "Zoom arrière" : "Zoom avant"}
              title={zoom ? "Zoom arrière" : "Zoom avant"}
              className={cn(
                "relative block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                zoom ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a verified repository picture, served by MedArt's own image route */}
              <img
                ref={pictureRef}
                src={full}
                alt={label}
                draggable={false}
                decoding="async"
                onError={() => setAttempt((current) => Math.min(current + 1, addresses.length - 1))}
                data-zoomed={zoom ? "" : undefined}
                style={{ scale: zoom ? String(zoom.scale) : "1", translate: zoom ? `${zoom.x}px ${zoom.y}px` : "0px 0px" }}
                // A light paper behind the picture: only a transparent diagram lets it show, and its black labels need it here.
                className="lightbox-image block h-auto max-h-[calc(100vh-9rem)] w-auto max-w-[calc(100vw-1.5rem)] rounded-2xl bg-slate-100 object-contain shadow-2xl supports-[height:100dvh]:max-h-[calc(100dvh-9rem)] sm:max-w-[calc(100vw-6rem)]"
              />
            </button>
          </div>
          <div className="lightbox-chrome pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:px-5 sm:pt-5">
            <a data-lightbox-control="" href={medicalImageDownloadHref(image, caption)} download aria-label="Télécharger" title="Télécharger" className={CONTROL}>
              <Download className="h-5 w-5" strokeWidth={2.25} />
            </a>
            <DialogPrimitive.Close data-lightbox-control="" title="Fermer" className={CONTROL}>
              <X className="h-5 w-5" strokeWidth={2.25} />
              <span className="sr-only">Fermer</span>
            </DialogPrimitive.Close>
          </div>
          <div
            className={cn(
              "lightbox-chrome pointer-events-none absolute inset-x-0 bottom-0 px-6 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-center transition-opacity duration-300",
              zoom ? "opacity-0" : "opacity-100"
            )}
          >
            <DialogPrimitive.Title className="mx-auto line-clamp-2 max-w-2xl text-[0.9375rem] font-medium leading-snug text-white/90">{label}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="mx-auto mt-1 max-w-2xl truncate text-[0.8125rem] text-white/55">{medicalImageCredit(image)}</DialogPrimitive.Description>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
