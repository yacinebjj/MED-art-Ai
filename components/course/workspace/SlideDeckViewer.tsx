"use client";

/**
 * Studio's "Slides" tab content — a mini-deck of independently-generated
 * images (google/gemini-3.1-flash-image-preview via OpenRouter, one call per
 * slide, cross-student cached — see app/api/studio/slides/route.ts).
 * Presented as a real carousel (arrows, pagination dots, keyboard nav) since
 * a slide deck is fundamentally sequential, unlike the single-image
 * Infographic tab. Fullscreen is still inherited for free from StudioPanel's
 * generic "Maximize2" toggle, same as InfographicViewer.
 */

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/** Fetches one slide as a data URL — jsPDF's addImage needs a base64 string/Image/canvas, not a cross-origin URL directly. Supabase Storage's public bucket URLs are served with permissive CORS, so a plain fetch+blob works. */
async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function SlideDeckViewer({ slideUrls, courseTitle }: { slideUrls: string[]; courseTitle: string }) {
  const { toast } = useToast();
  const [index, setIndex] = useState(0);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const total = slideUrls.length;

  function goPrev() {
    setIndex((i) => Math.max(0, i - 1));
  }
  function goNext() {
    setIndex((i) => Math.min(total - 1, i + 1));
  }

  // Left/Right arrow keys navigate the deck — a real slide deck's most
  // natural interaction, and cheap to add on top of the click controls.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  async function handleDownloadPdf() {
    setIsExportingPdf(true);
    try {
      // Dynamic import — jsPDF is only ever needed for this one action, no
      // reason to add it to this page's initial JS bundle.
      const { jsPDF } = await import("jspdf");
      const dataUrls = await Promise.all(slideUrls.map(fetchAsDataUrl));

      // 16:9 landscape at a plain 1280x720 "pt" canvas — matches every
      // slide's own aspect ratio (see SLIDE_STYLE_SYSTEM_PROMPT's own "16:9
      // paysage" instruction), so each image fills its page with no
      // letterboxing or distortion.
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [1280, 720] });
      dataUrls.forEach((dataUrl, i) => {
        if (i > 0) doc.addPage([1280, 720], "landscape");
        doc.addImage(dataUrl, "PNG", 0, 0, 1280, 720);
      });
      doc.save(`slides-${courseTitle.replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`);
    } catch (error) {
      toast({
        variant: "error",
        title: "Échec de l'export PDF",
        description: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setIsExportingPdf(false);
    }
  }

  const current = slideUrls[index];
  if (!current) return null;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-full max-w-4xl">
        <img
          key={current}
          src={current}
          alt={`Diapositive ${index + 1}/${total} — ${courseTitle}`}
          className="w-full rounded-2xl border border-border shadow-soft"
        />
        <button
          type="button"
          onClick={goPrev}
          disabled={index === 0}
          aria-label="Diapositive précédente"
          className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 text-foreground shadow-soft backdrop-blur transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-0"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={index === total - 1}
          aria-label="Diapositive suivante"
          className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 text-foreground shadow-soft backdrop-blur transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-0"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="flex items-center gap-1.5" role="tablist" aria-label="Pagination des diapositives">
        {slideUrls.map((_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Aller à la diapositive ${i + 1}`}
            onClick={() => setIndex(i)}
            className={`h-2 rounded-full transition-all duration-300 ${
              i === index ? "w-6 bg-primary-600 dark:bg-primary-500" : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
            }`}
          />
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        Diapositive {index + 1} / {total}
      </p>

      <button
        type="button"
        onClick={handleDownloadPdf}
        disabled={isExportingPdf}
        className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary-500 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-70 dark:bg-primary-500 dark:hover:bg-primary-400"
      >
        {isExportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {isExportingPdf ? "Export en cours..." : "Télécharger en PDF"}
      </button>
    </div>
  );
}
