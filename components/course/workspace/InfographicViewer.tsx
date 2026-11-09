"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Download, ExternalLink, ImageOff, Loader2, Maximize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { useLanguage } from "@/providers/LanguageProvider";
import { composeWatermarkedImage, WATERMARK_COLORS, WATERMARK_LOGO_SRC, WATERMARK_TEXT_PARTS, WATERMARK_URL_TEXT } from "@/lib/infographic-watermark";
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

/**
 * HTML twin of the signature strip baked into the image
 * (lib/infographic-watermark.ts) — shown under the plain image only when the
 * signed image could not be composed in this browser.
 */
function WatermarkStrip({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label={`MedArt AI — ${WATERMARK_URL_TEXT}`}
      className={cn("relative flex items-center justify-center gap-2.5 px-3 pb-2.5 pt-3", className)}
      style={{ backgroundImage: `linear-gradient(90deg, ${WATERMARK_COLORS.stripFrom}, ${WATERMARK_COLORS.stripTo})` }}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ backgroundImage: `linear-gradient(90deg, ${WATERMARK_COLORS.accentFrom}, ${WATERMARK_COLORS.accentTo})` }}
      />
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: WATERMARK_COLORS.badge }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand mark */}
        <img src={WATERMARK_LOGO_SRC} alt="" className="h-[22px] w-[22px]" />
      </span>
      <span aria-hidden className="text-sm tracking-wide">
        {WATERMARK_TEXT_PARTS.map((part) => (
          <span key={part.text} style={{ color: part.color, fontWeight: part.weight }}>
            {part.text}
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * Studio "Infographie / Fiche de Synthèse" — the generated sheet (app/api/studio/infographic),
 * signed: the MedArt AI strip (logo + www.medartai.com) is drawn under the
 * sheet in this browser (lib/infographic-watermark.ts), and that signed image
 * is what is shown, opened, zoomed and downloaded. Agrandir opens a
 * full-screen view with a zoom that keeps the clicked spot under the cursor.
 * If the signed image can't be composed here, the plain image is shown with
 * the same strip in HTML, and a download is only ever a signed file.
 */
export function InfographicViewer({ imageUrl, courseTitle }: { imageUrl: string; courseTitle: string }) {
  const { language } = useLanguage();
  const t = LABELS[language];
  const [attempt, setAttempt] = useState(0);
  const [composed, setComposed] = useState<{ url: string; blob: Blob } | null>(null);
  const [composeFailed, setComposeFailed] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [expanded, setExpanded] = useState(false);
  const [zoomWidth, setZoomWidth] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomFocusRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0 });

  const sourceUrl = attempt === 0 ? imageUrl : `${imageUrl}${imageUrl.includes("?") ? "&" : "?"}retry=${attempt}`;
  // The signed image; the plain one only when it could not be composed (with the HTML strip under it).
  const displaySrc = composed?.url ?? (composeFailed ? sourceUrl : null);
  const alt = `${t.alt} — ${courseTitle.replace(/\.[a-z0-9]{2,5}$/i, "")}`;
  const unavailable = !displaySrc || loadState === "error";

  // Composes the signed image once per source.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | null = null;
    setComposed(null);
    setComposeFailed(false);
    setLoadState("loading");
    composeWatermarkedImage(sourceUrl, controller.signal)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setComposed({ url: objectUrl, blob });
      })
      .catch((error) => {
        if (!active) return;
        console.warn("[InfographicViewer] Signature non intégrée à l'image — bandeau HTML à la place:", error instanceof Error ? error.message : error);
        setComposeFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceUrl]);

  // An image already decoded can finish before React sees its load event.
  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) setLoadState("loaded");
  }, [displaySrc]);

  const download = useCallback(async () => {
    setDownloadFailed(false);
    setDownloading(true);
    try {
      const blob = composed?.blob ?? (await composeWatermarkedImage(sourceUrl));
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
  }, [composed, sourceUrl, courseTitle]);

  function retry() {
    setDownloadFailed(false);
    setAttempt((n) => n + 1);
  }

  function zoomIn(focus: { x: number; y: number }) {
    const container = scrollRef.current;
    const naturalWidth = imageRef.current?.naturalWidth ?? 0;
    const containerWidth = container?.clientWidth ?? 0;
    zoomFocusRef.current = focus;
    setZoomWidth(Math.max(naturalWidth, containerWidth, 1));
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
          disabled={!displaySrc}
          aria-label={t.expandAria}
          className="group relative block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-border bg-white shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait dark:bg-zinc-900"
        >
          {loadState !== "loaded" && <div aria-hidden className="aspect-square w-full animate-pulse bg-zinc-100 dark:bg-zinc-800/60" />}
          {displaySrc && (
            // eslint-disable-next-line @next/next/no-img-element -- generated image of unknown size (a local signed copy); rendered as-is
            <img
              ref={imageRef}
              src={displaySrc}
              alt={alt}
              decoding="async"
              onLoad={() => setLoadState("loaded")}
              onError={() => setLoadState("error")}
              className={cn("block h-auto w-full", loadState === "loaded" ? "animate-fade-in" : "absolute inset-0 h-full opacity-0")}
            />
          )}
          {composeFailed && loadState === "loaded" && <WatermarkStrip />}
          <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-zinc-950/70 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors group-hover:bg-zinc-950/85">
            <Maximize2 className="h-3.5 w-3.5" />
            {t.expand}
          </span>
        </button>
      )}

      {composed && loadState === "loaded" && (
        <a
          href={composed.url}
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
            {displaySrc && (
              // eslint-disable-next-line @next/next/no-img-element -- same signed image, full size
              <img
                src={displaySrc}
                alt={alt}
                draggable={false}
                onClick={handleLightboxImageClick}
                style={zoomWidth === null ? undefined : { width: zoomWidth }}
                className={cn("select-none", zoomWidth === null ? "max-h-full max-w-full cursor-zoom-in object-contain" : "h-auto max-w-none cursor-zoom-out")}
              />
            )}
          </div>
          {composeFailed && <WatermarkStrip className="shrink-0" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
