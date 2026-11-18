"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type SyntheticEvent } from "react";
import { Download, ExternalLink, ImageOff, Loader2, Maximize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { useLanguage } from "@/providers/LanguageProvider";
import {
  composeWatermarkedFromImage,
  composeWatermarkedImage,
  readySignedSheet,
  signedSheetFor,
  signedSheetObjectUrl,
  watermarkLayout,
  WATERMARK_COLORS,
  WATERMARK_LOGO_SRC,
  WATERMARK_TEXT_PARTS,
  WATERMARK_URL_TEXT,
} from "@/lib/infographic-watermark";
import { cn } from "@/lib/utils";

/** The Studio's graphite primary action (no blue in the Studio). */
const GRAPHITE_BUTTON = "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200";

const LIGHTBOX_ICON_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-50";

const LABELS = {
  fr: {
    heading: "Fiche de synthèse",
    expand: "Agrandir",
    expandAria: "Agrandir la fiche de synthèse",
    download: "Télécharger",
    downloadFailed: "Le téléchargement n'a pas pu être préparé. Réessaie dans un instant.",
    open: "Ouvrir dans un nouvel onglet",
    zoomIn: "Zoom avant",
    zoomOut: "Zoom arrière",
    alt: "Fiche de synthèse illustrée",
    loadError: "L'image n'a pas pu être chargée.",
    retry: "Réessayer",
  },
  en: {
    heading: "Summary sheet",
    expand: "Expand",
    expandAria: "Expand the summary sheet",
    download: "Download",
    downloadFailed: "The download couldn't be prepared. Try again in a moment.",
    open: "Open in a new tab",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    alt: "Illustrated summary sheet",
    loadError: "The image could not be loaded.",
    retry: "Try again",
  },
} as const;

/** "Diabète_type 2.pdf" → "fiche-de-synthese-diabete-type-2". */
function downloadBaseName(courseTitle: string): string {
  const slug = courseTitle
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `fiche-de-synthese${slug ? `-${slug}` : ""}`;
}

/** Runs `callback` when the browser is idle (or after a short delay where idle callbacks don't exist); returns a canceller. */
function whenIdle(callback: () => void, timeoutMs: number): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 300);
  return () => window.clearTimeout(handle);
}

/** Decodes an image URL off-screen, so swapping an <img> to it paints at once. Never throws. */
async function predecode(url: string): Promise<void> {
  try {
    const image = new Image();
    image.src = url;
    if (typeof image.decode === "function") await image.decode();
  } catch {
    // The <img> decodes it itself.
  }
}

/**
 * HTML twin of the signature strip baked into the image
 * (lib/infographic-watermark.ts) — shown under the plain image until the
 * signed one is ready, and for good when it can't be composed in this
 * browser. Given the sheet's natural width, it takes the exact proportions of
 * the baked strip (height ~8% of the width, badge, text and accent scaled
 * with the strip — container query units), so swapping to the signed image
 * moves nothing on screen. The strip is the size container; everything sized
 * in `cqh` sits INSIDE it (a container's own cq units would resolve against
 * its ancestors).
 */
function WatermarkStrip({ className, naturalWidth }: { className?: string; naturalWidth?: number }) {
  const layout = naturalWidth ? watermarkLayout(naturalWidth) : null;
  const percentOfStrip = (value: number) => (layout ? `${((value / layout.height) * 100).toFixed(3)}cqh` : undefined);
  const background = `linear-gradient(90deg, ${WATERMARK_COLORS.stripFrom}, ${WATERMARK_COLORS.stripTo})`;
  const accent = (
    <span
      aria-hidden
      className="absolute inset-x-0 top-0 h-[3px]"
      style={{ backgroundImage: `linear-gradient(90deg, ${WATERMARK_COLORS.accentFrom}, ${WATERMARK_COLORS.accentTo})`, ...(layout ? { height: percentOfStrip(Math.max(2, layout.accent)) } : {}) }}
    />
  );
  const mark = (
    <>
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: WATERMARK_COLORS.badge, ...(layout ? { width: percentOfStrip(layout.badge), height: percentOfStrip(layout.badge) } : {}) }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand mark */}
        <img src={WATERMARK_LOGO_SRC} alt="" className="h-[22px] w-[22px]" style={layout ? { width: "80%", height: "80%" } : undefined} />
      </span>
      <span aria-hidden className={cn("whitespace-nowrap", !layout && "text-sm tracking-wide")} style={layout ? { fontSize: percentOfStrip(layout.fontSize), lineHeight: 1 } : undefined}>
        {WATERMARK_TEXT_PARTS.map((part) => (
          <span key={part.text} style={{ color: part.color, fontWeight: part.weight }}>
            {part.text}
          </span>
        ))}
      </span>
    </>
  );

  if (layout && naturalWidth) {
    return (
      <div
        role="img"
        aria-label={`MedArt AI — ${WATERMARK_URL_TEXT}`}
        className={cn("relative w-full", className)}
        style={{ backgroundImage: background, aspectRatio: `${naturalWidth} / ${layout.height}`, containerType: "size" }}
      >
        {accent}
        <div className="flex h-full items-center justify-center" style={{ gap: percentOfStrip(layout.gap), paddingTop: percentOfStrip(layout.accent) }}>
          {mark}
        </div>
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label={`MedArt AI — ${WATERMARK_URL_TEXT}`}
      className={cn("relative flex items-center justify-center gap-2.5 px-3 pb-2.5 pt-3", className)}
      style={{ backgroundImage: background }}
    >
      {accent}
      {mark}
    </div>
  );
}

/**
 * Studio "Infographie / Fiche de Synthèse" — the generated sheet (app/api/studio/infographic),
 * signed with the MedArt AI strip (logo + www.medartai.com).
 *
 * Fast by design (2026-11-18, students found it slow to appear): the sheet is
 * shown THE MOMENT its file arrives — painted progressively by the browser —
 * with the strip in HTML under it, at the baked strip's exact proportions.
 * Only then, when the browser is idle, the signed PNG is drawn from that very
 * <img> (no second download, lib/infographic-watermark.ts) and swapped in,
 * already decoded, so nothing moves. It used to wait for the whole file, a
 * canvas redraw and a PNG encode before showing anything. A sheet signed
 * earlier in the session shows signed at once.
 *
 * Until the signed image is in place, the plain one can't be long-pressed,
 * right-clicked or dragged: what the student saves, opens or downloads always
 * carries the signature, and a download is only ever a signed file. If the
 * signed image can't be composed here, the plain one stays with its HTML
 * strip. Agrandir opens a full-screen view with a zoom that keeps the clicked
 * spot under the cursor.
 */
export function InfographicViewer({ imageUrl, courseTitle }: { imageUrl: string; courseTitle: string }) {
  const { language } = useLanguage();
  const t = LABELS[language];
  const [attempt, setAttempt] = useState(0);
  const sourceUrl = attempt === 0 ? imageUrl : `${imageUrl}${imageUrl.includes("?") ? "&" : "?"}retry=${attempt}`;
  /** The signed image (object URL + its blob), once composed. */
  const [signed, setSigned] = useState<{ url: string; blob: Blob } | null>(() => readySignedSheet(sourceUrl));
  const [composeFailed, setComposeFailed] = useState(false);
  /** The plain sheet loaded without CORS (its CORS request failed): shown, but it can't be signed from the page. */
  const [plainOnly, setPlainOnly] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">(signed ? "loaded" : "loading");
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [zoomWidth, setZoomWidth] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomFocusRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0 });

  const displaySrc = signed?.url ?? sourceUrl;
  const alt = `${t.alt} — ${courseTitle.replace(/\.[a-z0-9]{2,5}$/i, "")}`;
  const unavailable = loadState !== "loaded";
  /** The plain sheet is on screen: no native save / drag until the signed one replaces it. */
  const guarded = !signed;

  /** Signs the sheet once per source: from the <img> on screen when it loaded with CORS, else by downloading it. */
  const composeSigned = useCallback((): Promise<Blob> => {
    const image = imageRef.current;
    return signedSheetFor(sourceUrl, () =>
      image && !plainOnly && image.complete && image.naturalWidth > 0
        ? composeWatermarkedFromImage(image).catch(() => composeWatermarkedImage(sourceUrl))
        : composeWatermarkedImage(sourceUrl)
    );
  }, [sourceUrl, plainOnly]);

  // Once the plain sheet is on screen, the signed one is drawn in idle time and swapped in.
  useEffect(() => {
    if (loadState !== "loaded" || signed || composeFailed) return;
    let cancelled = false;
    const cancelIdle = whenIdle(() => {
      composeSigned()
        .then(async (blob) => {
          if (cancelled) return;
          // Shared with every viewer of this sheet (lib/infographic-watermark.ts owns and revokes it).
          const url = signedSheetObjectUrl(sourceUrl, blob);
          await predecode(url);
          if (!cancelled) setSigned({ url, blob });
        })
        .catch((error) => {
          if (cancelled) return;
          console.warn("[InfographicViewer] Signature non intégrée à l'image — bandeau HTML à la place:", error instanceof Error ? error.message : error);
          setComposeFailed(true);
        });
    }, 1_500);
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [loadState, signed, composeFailed, composeSigned, sourceUrl]);

  // An image already decoded can finish before React sees its load event.
  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      setNaturalWidth((current) => current ?? image.naturalWidth);
      setLoadState("loaded");
    }
  }, [displaySrc]);

  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>) {
    // The signed image is taller (it carries the strip): the plain sheet's width is what the HTML strip mirrors.
    if (!signed) setNaturalWidth(event.currentTarget.naturalWidth || null);
    setLoadState("loaded");
  }

  function handleImageError() {
    if (signed) {
      // The signed copy failed to paint (memory?): back to the plain sheet with its HTML strip.
      setSigned(null);
      setComposeFailed(true);
      return;
    }
    if (!plainOnly) {
      // The CORS request failed: show the sheet anyway, without signing it here.
      setPlainOnly(true);
      return;
    }
    setLoadState("error");
  }

  const preventNativeSave = (event: ReactMouseEvent) => {
    if (guarded) event.preventDefault();
  };

  const download = useCallback(async () => {
    setDownloadFailed(false);
    setDownloading(true);
    try {
      const blob = signed?.blob ?? (await composeSigned());
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `${downloadBaseName(courseTitle)}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
    } catch (error) {
      // Never an unsigned file: the student tries again.
      console.error("[InfographicViewer] Téléchargement signé impossible:", error instanceof Error ? error.message : error);
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  }, [signed, composeSigned, courseTitle]);

  function retry() {
    setDownloadFailed(false);
    setComposeFailed(false);
    setPlainOnly(false);
    setSigned(null);
    setNaturalWidth(null);
    setLoadState("loading");
    setAttempt((n) => n + 1);
  }

  function zoomIn(focus: { x: number; y: number }) {
    const container = scrollRef.current;
    const naturalImageWidth = imageRef.current?.naturalWidth ?? 0;
    const containerWidth = container?.clientWidth ?? 0;
    zoomFocusRef.current = focus;
    setZoomWidth(Math.max(naturalImageWidth, containerWidth, 1));
  }

  function handleLightboxImageClick(event: ReactMouseEvent<HTMLImageElement>) {
    if (zoomWidth !== null) {
      setZoomWidth(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    zoomIn({
      x: rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5,
      y: rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0,
    });
  }

  // Keeps the zoomed-on spot in the middle of the view.
  useLayoutEffect(() => {
    if (zoomWidth === null) return;
    const container = scrollRef.current;
    const image = container?.querySelector("img");
    if (!container || !image) return;
    const { x, y } = zoomFocusRef.current;
    container.scrollLeft = Math.max(0, image.offsetWidth * x - container.clientWidth / 2);
    container.scrollTop = Math.max(0, image.offsetHeight * y - container.clientHeight / 2);
  }, [zoomWidth]);

  function handleOpenChange(open: boolean) {
    setExpanded(open);
    if (!open) setZoomWidth(null);
  }

  /** No callout menu / drag of the plain sheet on touch and desktop browsers while it is unsigned. */
  const guardStyle: CSSProperties | undefined = guarded ? { WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" } : undefined;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.heading}</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(true)} disabled={unavailable}>
            <Maximize2 className="h-4 w-4" />
            {t.expand}
          </Button>
          <Button type="button" size="sm" onClick={download} disabled={downloading || unavailable} className={GRAPHITE_BUTTON}>
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t.download}
          </Button>
        </div>
      </div>

      {downloadFailed && (
        <p role="status" className="text-right text-xs font-medium text-rose-600 dark:text-rose-400">
          {t.downloadFailed}
        </p>
      )}

      {loadState === "error" ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border px-4 py-12 text-center">
          <ImageOff className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t.loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            <RotateCcw className="h-4 w-4" />
            {t.retry}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          disabled={unavailable}
          aria-label={t.expandAria}
          className={cn(
            "group relative block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-border bg-white shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait dark:bg-zinc-900",
            loadState === "loading" && "min-h-[18rem] sm:min-h-[26rem]"
          )}
        >
          {/* Behind the sheet while its first bytes arrive; the sheet paints over it as it downloads. */}
          {loadState === "loading" && <div aria-hidden className="absolute inset-0 animate-pulse bg-zinc-100 dark:bg-zinc-800/60" />}
          {/* eslint-disable-next-line @next/next/no-img-element -- generated image of unknown size, shown as it downloads */}
          <img
            key={plainOnly ? "plain" : "cors"}
            ref={imageRef}
            src={displaySrc}
            alt={alt}
            crossOrigin={plainOnly || signed ? undefined : "anonymous"}
            decoding="async"
            draggable={!guarded}
            onContextMenu={preventNativeSave}
            onLoad={handleImageLoad}
            onError={handleImageError}
            style={guardStyle}
            className="relative block h-auto w-full"
          />
          {!signed && loadState === "loaded" && <WatermarkStrip naturalWidth={naturalWidth ?? undefined} className="animate-fade-in" />}
          <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-zinc-950/70 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors group-hover:bg-zinc-950/85">
            <Maximize2 className="h-3.5 w-3.5" />
            {t.expand}
          </span>
        </button>
      )}

      {signed && loadState === "loaded" && (
        <a
          href={signed.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 self-center text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t.open}
        </a>
      )}

      <Dialog open={expanded} onOpenChange={handleOpenChange}>
        <DialogContent
          sheetOnMobile={false}
          onOverlayClick={() => handleOpenChange(false)}
          className="inset-2 flex h-auto max-h-none w-auto max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden border-white/10 bg-zinc-950 p-0 text-white sm:inset-4 [&>button:last-child:hover]:bg-white/10 [&>button:last-child:hover]:text-white [&>button:last-child]:text-white/75"
        >
          <div className="flex shrink-0 items-center gap-1 border-b border-white/10 py-2 pl-4 pr-14">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-sm font-semibold text-white">{t.heading}</DialogTitle>
              <DialogDescription className="truncate text-xs text-white/60">{courseTitle}</DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => (zoomWidth === null ? zoomIn({ x: 0.5, y: 0 }) : setZoomWidth(null))}
              aria-label={zoomWidth === null ? t.zoomIn : t.zoomOut}
              title={zoomWidth === null ? t.zoomIn : t.zoomOut}
              className={LIGHTBOX_ICON_BUTTON}
            >
              {zoomWidth === null ? <ZoomIn className="h-4 w-4" /> : <ZoomOut className="h-4 w-4" />}
            </button>
            <button type="button" onClick={download} disabled={downloading || unavailable} aria-label={t.download} title={t.download} className={LIGHTBOX_ICON_BUTTON}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            </button>
          </div>
          {downloadFailed && (
            <p role="status" className="shrink-0 px-4 py-1.5 text-xs font-medium text-rose-300">
              {t.downloadFailed}
            </p>
          )}
          <div
            ref={scrollRef}
            className={cn("min-h-0 flex-1 overflow-auto overscroll-contain", zoomWidth === null && "flex items-center justify-center p-2 sm:p-4")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- same image as inline, full size */}
            <img
              src={displaySrc}
              alt={alt}
              crossOrigin={plainOnly || signed ? undefined : "anonymous"}
              draggable={false}
              onContextMenu={preventNativeSave}
              onClick={handleLightboxImageClick}
              style={{ ...(zoomWidth === null ? {} : { width: zoomWidth }), ...guardStyle }}
              className={cn("select-none", zoomWidth === null ? "max-h-full max-w-full cursor-zoom-in object-contain" : "h-auto max-w-none cursor-zoom-out")}
            />
          </div>
          {!signed && <WatermarkStrip className="shrink-0" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
