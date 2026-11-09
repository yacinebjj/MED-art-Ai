/**
 * MedArt AI branding on the Studio "Infographie / Fiche de Synthèse" (product
 * order 2026-11-09): a signature strip — the MedArt AI logo in a white badge
 * and "www.medartai.com" — drawn under the generated sheet, in the browser
 * (canvas). The workspace shows this composed image, so what the student
 * sees, long-presses, opens or downloads always carries the signature. The
 * stored image and its generation pipeline are untouched.
 *
 * The strip is ADDED below the sheet (the canvas grows), never painted over
 * it: no medical text of the sheet is ever hidden.
 */

/** The text on the strip — exactly this, by product order. */
export const WATERMARK_URL_TEXT = "www.medartai.com";

/** The brand mark alone (no wordmark), transparent background — legible at badge size. */
export const WATERMARK_LOGO_SRC = "/icons/icon-192.png";

/** The strip's text in its three tones (the CSS fallback strip uses the same split). */
export const WATERMARK_TEXT_PARTS = [
  { text: "www.", color: "#94a3b8", weight: 500 },
  { text: "medartai", color: "#ffffff", weight: 700 },
  { text: ".com", color: "#5eead4", weight: 700 },
] as const;

export const WATERMARK_COLORS = {
  stripFrom: "#0b1220",
  stripTo: "#0f3d4a",
  accentFrom: "#22d3ee",
  accentTo: "#2dd4bf",
  badge: "#ffffff",
} as const;

/** iOS Safari refuses canvases above 16,777,216 pixels: stay under it. */
const MAX_CANVAS_PIXELS = 16_000_000;
const LOAD_TIMEOUT_MS = 15_000;

export interface WatermarkLayout {
  /** Strip height (px). */
  height: number;
  /** Top accent line height (px). */
  accent: number;
  /** White badge (circle) diameter (px). */
  badge: number;
  /** Logo size inside the badge (px). */
  logo: number;
  /** Text size (px). */
  fontSize: number;
  /** Space between the badge and the text (px). */
  gap: number;
}

/** The strip's proportions for an image `width` px wide: ~8% of the width, never under 56 px. */
export function watermarkLayout(width: number): WatermarkLayout {
  const height = Math.max(56, Math.round(width * 0.08));
  const badge = Math.round(height * 0.62);
  return {
    height,
    accent: Math.max(2, Math.round(height * 0.045)),
    badge,
    logo: Math.round(badge * 0.8),
    fontSize: Math.round(height * 0.34),
    gap: Math.round(height * 0.18),
  };
}

/** Final canvas size: the sheet plus its strip, scaled down only past the browser's canvas limit. */
export function watermarkCanvasSize(sourceWidth: number, sourceHeight: number): { scale: number; width: number; imageHeight: number; layout: WatermarkLayout; height: number } {
  let scale = 1;
  for (let i = 0; i < 4; i++) {
    const width = Math.round(sourceWidth * scale);
    const total = Math.round(sourceHeight * scale) + watermarkLayout(width).height;
    if (width * total <= MAX_CANVAS_PIXELS) break;
    scale *= Math.sqrt(MAX_CANVAS_PIXELS / (width * total)) * 0.995;
  }
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const imageHeight = Math.max(1, Math.round(sourceHeight * scale));
  const layout = watermarkLayout(width);
  return { scale, width, imageHeight, layout, height: imageHeight + layout.height };
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} : délai dépassé`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Image illisible : ${src.slice(0, 80)}`));
  });
  image.src = src;
  if (typeof image.decode !== "function") return withTimeout(loaded, LOAD_TIMEOUT_MS, "Chargement de l'image");
  // decode() settles on its own (and rejects on a broken image): the load events are not needed then.
  loaded.catch(() => {});
  return withTimeout(
    image.decode().then(() => image),
    LOAD_TIMEOUT_MS,
    "Chargement de l'image"
  );
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeBlob(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImageElement(url);
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

let logoPromise: Promise<HTMLImageElement | null> | null = null;
/** The brand mark, loaded once per page; null when it can't be loaded (the strip then shows the text alone). */
function loadLogo(): Promise<HTMLImageElement | null> {
  logoPromise ??= loadImageElement(WATERMARK_LOGO_SRC).catch((error) => {
    console.warn("[watermark] Logo indisponible, signature sans logo:", error instanceof Error ? error.message : error);
    logoPromise = null;
    return null;
  });
  return logoPromise;
}

/** The page's own font (Inter, through next/font), so the strip matches the site. */
function brandFontFamily(): string {
  try {
    const family = getComputedStyle(document.body).fontFamily;
    if (family) return family;
  } catch {
    // Not in a browser document.
  }
  return "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
}

async function ensureFontsLoaded(fontSize: number, family: string): Promise<void> {
  try {
    const fonts = document.fonts;
    if (!fonts) return;
    await withTimeout(Promise.all([fonts.load(`700 ${fontSize}px ${family}`), fonts.load(`500 ${fontSize}px ${family}`)]), 3_000, "Police");
  } catch {
    // The fallback font is fine.
  }
}

/** Draws the signature strip at (0, y), `width` wide. */
export function drawWatermarkStrip(
  ctx: CanvasRenderingContext2D,
  y: number,
  width: number,
  layout: WatermarkLayout,
  logo: CanvasImageSource | null,
  fontFamily: string
): void {
  const background = ctx.createLinearGradient(0, y, width, y);
  background.addColorStop(0, WATERMARK_COLORS.stripFrom);
  background.addColorStop(1, WATERMARK_COLORS.stripTo);
  ctx.fillStyle = background;
  ctx.fillRect(0, y, width, layout.height);

  const accent = ctx.createLinearGradient(0, y, width, y);
  accent.addColorStop(0, WATERMARK_COLORS.accentFrom);
  accent.addColorStop(1, WATERMARK_COLORS.accentTo);
  ctx.fillStyle = accent;
  ctx.fillRect(0, y, width, layout.accent);

  // Text size that fits a narrow image (90% of the width at most).
  let fontSize = layout.fontSize;
  const measure = () =>
    WATERMARK_TEXT_PARTS.reduce((total, part) => {
      ctx.font = `${part.weight} ${fontSize}px ${fontFamily}`;
      return total + ctx.measureText(part.text).width;
    }, 0);
  const badgeSpace = logo ? layout.badge + layout.gap : 0;
  let textWidth = measure();
  while (badgeSpace + textWidth > width * 0.9 && fontSize > 8) {
    fontSize -= 1;
    textWidth = measure();
  }

  const centerY = y + layout.accent + (layout.height - layout.accent) / 2;
  let x = (width - (badgeSpace + textWidth)) / 2;

  if (logo) {
    const radius = layout.badge / 2;
    ctx.beginPath();
    ctx.arc(x + radius, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = WATERMARK_COLORS.badge;
    ctx.fill();
    ctx.drawImage(logo, x + radius - layout.logo / 2, centerY - layout.logo / 2, layout.logo, layout.logo);
    x += badgeSpace;
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const part of WATERMARK_TEXT_PARTS) {
    ctx.font = `${part.weight} ${fontSize}px ${fontFamily}`;
    ctx.fillStyle = part.color;
    ctx.fillText(part.text, x, centerY);
    x += ctx.measureText(part.text).width;
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Export de l'image impossible."))), "image/png");
  });
}

/**
 * The sheet at `imageUrl` with its MedArt AI signature strip, as a PNG. The
 * image is fetched with CORS (Supabase Storage answers
 * `Access-Control-Allow-Origin: *`), so the canvas can be exported. Throws
 * when anything fails — the caller then shows the plain image with the HTML
 * strip instead, and never offers an unsigned download.
 */
export async function composeWatermarkedImage(imageUrl: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(imageUrl, { mode: "cors", signal });
  if (!res.ok) throw new Error(`Image indisponible (HTTP ${res.status}).`);
  const decoded = await decodeBlob(await res.blob());
  try {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const { scale, width, imageHeight, layout, height } = watermarkCanvasSize(decoded.width, decoded.height);
    const fontFamily = brandFontFamily();
    const [logo] = await Promise.all([loadLogo(), ensureFontsLoaded(layout.fontSize, fontFamily)]);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponible.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (scale === 1) ctx.drawImage(decoded.source, 0, 0);
    else ctx.drawImage(decoded.source, 0, 0, width, imageHeight);
    drawWatermarkStrip(ctx, imageHeight, width, layout, logo, fontFamily);
    return await canvasToPng(canvas);
  } finally {
    decoded.release();
  }
}
