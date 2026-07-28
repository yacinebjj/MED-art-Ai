"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { VisualRenderer } from "@/components/visual-studio/VisualRenderer";
import { LearningModeDrawer } from "@/components/visual-studio/LearningModeDrawer";
import { DOMAIN_ICON, DOMAIN_LABEL, SLIDE_THEME_STYLES } from "@/lib/presentation-theme";
import type { Slide } from "@/lib/presentation-types";

interface SlideDeckCanvasProps {
  slide: Slide;
  slides: Slide[];
  currentIndex: number;
  tocOpen: boolean;
  searchQuery: string;
  isDark?: boolean;
  onGoTo: (index: number) => void;
  onCloseTOC: () => void;
}

export function SlideDeckCanvas({
  slide,
  slides,
  currentIndex,
  tocOpen,
  searchQuery,
  isDark = false,
  onGoTo,
  onCloseTOC,
}: SlideDeckCanvasProps) {
  const theme = SLIDE_THEME_STYLES[slide.theme];
  const DomainIcon = DOMAIN_ICON[slide.domain];

  const filteredSlides = slides
    .map((s, i) => ({ slide: s, index: i }))
    .filter(
      ({ slide: s }) =>
        searchQuery.trim() === "" || s.title.toLowerCase().includes(searchQuery.trim().toLowerCase())
    );

  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="mx-auto flex h-full max-w-5xl flex-col p-4 sm:p-6">
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border-2 bg-white shadow-2xl",
            theme.border
          )}
        >
          {/* Header */}
          <div className={cn("shrink-0 bg-gradient-to-r px-6 py-5 sm:px-8 sm:py-6", theme.gradient)}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <span className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur">
                  <DomainIcon className="h-3 w-3" />
                  {DOMAIN_LABEL[slide.domain]}
                </span>
                <h2 className="text-xl font-extrabold text-white sm:text-2xl">{slide.title}</h2>
                <p className="mt-1 text-sm text-white/85">{slide.subtitle}</p>
              </div>
            </div>
          </div>

          {/* Slide content — fades in on every slide change */}
          <div className="relative min-h-0 flex-1 overflow-y-auto bg-white p-5 sm:p-8">
            <div key={slide.id} className="animate-fade-in">
              <VisualRenderer slide={slide} />
            </div>
          </div>

          <LearningModeDrawer key={slide.id} content={slide.learningMode} />
        </div>
      </div>

      {/* TOC / thumbnail drawer */}
      {tocOpen && (
          <>
            <div
              onClick={onCloseTOC}
              className="animate-fade-in absolute inset-0 z-20 bg-slate-900/30"
              aria-hidden
            />
            <div
              className={cn(
                "animate-fade-in absolute inset-y-0 right-0 z-30 flex w-72 flex-col border-l shadow-2xl sm:w-80",
                isDark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-between border-b p-4",
                  isDark ? "border-slate-700" : "border-slate-100"
                )}
              >
                <h3 className={cn("text-sm font-bold", isDark ? "text-white" : "text-slate-900")}>Sommaire</h3>
                <button
                  type="button"
                  onClick={onCloseTOC}
                  aria-label="Fermer le sommaire"
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full",
                    isDark ? "text-slate-400 hover:bg-slate-700" : "text-slate-400 hover:bg-slate-100"
                  )}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
                {filteredSlides.length === 0 && (
                  <p className="p-4 text-center text-sm text-slate-400">Aucune slide ne correspond à la recherche.</p>
                )}
                {filteredSlides.map(({ slide: s, index }) => {
                  const isActive = index === currentIndex;
                  const sTheme = SLIDE_THEME_STYLES[s.theme];
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        onGoTo(index);
                        onCloseTOC();
                      }}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        isActive
                          ? cn(sTheme.border, sTheme.badgeBg)
                          : isDark
                            ? "border-transparent hover:bg-slate-700"
                            : "border-transparent hover:bg-slate-50"
                      )}
                    >
                      <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", sTheme.dot)} />
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-slate-400">Slide {index + 1}</span>
                        <span
                          className={cn(
                            "block truncate text-sm font-medium",
                            isActive ? "text-slate-800" : isDark ? "text-slate-100" : "text-slate-800"
                          )}
                        >
                          {s.title}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
    </div>
  );
}
