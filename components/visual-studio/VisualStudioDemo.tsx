"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, Layers } from "lucide-react";
import { VISUAL_STUDIO_DEMO_SLIDES } from "@/lib/visual-studio-demo-slides";

let mermaidInitialized = false;

async function renderMermaidDiagram(container: HTMLDivElement, code: string, slideId: number) {
  const mermaid = (await import("mermaid")).default;

  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      fontFamily: "inherit",
    });
    mermaidInitialized = true;
  }

  container.innerHTML = "";
  const { svg } = await mermaid.render(`visual-studio-slide-${slideId}`, code);
  container.innerHTML = svg;
}

export function VisualStudioDemo() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const mermaidRef = useRef<HTMLDivElement>(null);

  const slides = VISUAL_STUDIO_DEMO_SLIDES;
  const currentSlide = slides[currentIndex];

  useEffect(() => {
    if (currentSlide.type !== "DIAGRAM_SLIDE" || !currentSlide.mermaidCode || !mermaidRef.current) {
      return;
    }

    let cancelled = false;
    const container = mermaidRef.current;

    renderMermaidDiagram(container, currentSlide.mermaidCode, currentSlide.id).catch((error) => {
      if (!cancelled) {
        console.error("Mermaid render failed:", error);
        container.textContent = "Impossible d'afficher le diagramme.";
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentIndex, currentSlide]);

  function handleNext() {
    setCurrentIndex((index) => Math.min(slides.length - 1, index + 1));
  }

  function handlePrev() {
    setCurrentIndex((index) => Math.max(0, index - 1));
  }

  return (
    <div className="relative flex h-[80vh] min-h-[600px] w-full flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl">
      <div className="absolute inset-0 z-0">
        {currentSlide.type === "IMAGE_SLIDE" ? (
          <>
            <img
              src={currentSlide.imageUrl}
              alt={currentSlide.title}
              className="h-full w-full scale-105 object-cover opacity-75 transition-all duration-700"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950/95 via-slate-900/60 to-transparent" />
          </>
        ) : (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-slate-900 p-12">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.08)_0,transparent_70%)]" />
            <div
              ref={mermaidRef}
              className="flex w-full scale-110 items-center justify-center [&_svg]:max-h-[70vh] [&_svg]:w-full"
            />
          </div>
        )}
      </div>

      <div className="relative z-10 m-8 max-h-[75vh] w-[42%] overflow-y-auto rounded-3xl border border-white/15 bg-slate-900/80 p-8 text-slate-100 shadow-2xl backdrop-blur-2xl">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-400">
          {currentSlide.type === "DIAGRAM_SLIDE" ? (
            <Activity className="h-4 w-4" />
          ) : (
            <Layers className="h-4 w-4" />
          )}
          <span>
            Diapositive {currentSlide.id} / {slides.length}
          </span>
        </div>
        <h2 className="mb-2 text-2xl font-bold tracking-tight text-white">{currentSlide.title}</h2>
        <h3 className="mb-4 text-sm font-medium text-cyan-300/80">{currentSlide.subtitle}</h3>
        <div className="my-4 h-px w-full bg-white/10" />
        <p className="text-base leading-relaxed text-slate-300">{currentSlide.content}</p>
      </div>

      <div className="relative z-10 mx-auto mb-6 flex items-center gap-6 rounded-full border border-white/10 bg-slate-900/80 px-8 py-3 shadow-xl backdrop-blur-xl">
        <button
          type="button"
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-300 transition-colors hover:text-white disabled:opacity-30 disabled:hover:text-slate-300"
        >
          <ChevronLeft className="h-5 w-5" />
          Précédent
        </button>

        <div className="flex items-center gap-1.5 px-3">
          {slides.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentIndex(idx)}
              aria-label={`Aller à la diapositive ${idx + 1}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                currentIndex === idx ? "w-8 bg-cyan-400" : "w-2 bg-slate-700 hover:bg-slate-500"
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={handleNext}
          disabled={currentIndex === slides.length - 1}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-300 transition-colors hover:text-white disabled:opacity-30 disabled:hover:text-slate-300"
        >
          Suivant
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
