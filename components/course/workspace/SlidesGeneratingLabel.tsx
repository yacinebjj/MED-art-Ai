"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/providers/LanguageProvider";

/**
 * Cycles through Slides-specific "AI at work" phrases — a real generation
 * here takes ~20-40s (a planning call plus SLIDE_COUNT_TARGET parallel
 * image calls, see app/api/studio/slides/route.ts), meaningfully longer
 * than every other Studio section, so a generic "Génération en cours..."
 * reads as stalled. Mirrors GeneratingRotatingLabel.tsx's exact mechanism
 * with its own message list instead — these messages are specific enough to
 * this one feature that sharing the generic list would be a worse fit, not
 * a cleaner reuse.
 */
const SLIDES_WORKING_MESSAGES: { fr: string; en: string }[] = [
  { fr: "Analyse du cours...", en: "Analyzing the course..." },
  { fr: "Construction du plan des diapositives...", en: "Planning the slide outline..." },
  { fr: "Création des visuels...", en: "Creating the visuals..." },
  { fr: "Assemblage des slides...", en: "Assembling the slides..." },
];

export function SlidesGeneratingLabel({ className }: { className?: string }) {
  const [index, setIndex] = useState(0);
  const { language } = useLanguage();

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES_WORKING_MESSAGES.length);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  return <span className={className}>{SLIDES_WORKING_MESSAGES[index][language]}</span>;
}
