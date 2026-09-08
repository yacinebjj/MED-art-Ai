"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/providers/LanguageProvider";

/**
 * Cycles through Explication-specific "AI at work" phrases — mirrors
 * components/course/workspace/PodcastGeneratingLabel.tsx's exact
 * rotating-message mechanism. A real "Explication Ultra-Détaillée"
 * generation is a sequential, multi-part pipeline (lib/studio-explication-
 * client.ts) whose real per-part latency is measured in minutes, so a
 * generic "Génération en cours..." reads as stalled over that much longer
 * wait — which matters more here than for any other Studio tile, since a
 * student who assumes the app has hung is the student most likely to lock
 * their phone/switch apps mid-generation, the exact scenario this label
 * (together with the Wake Lock request in studio-explication-client.ts)
 * exists to discourage.
 */
const EXPLICATION_WORKING_MESSAGES: { fr: string; en: string }[] = [
  { fr: "Analyse du cours...", en: "Analyzing the course..." },
  { fr: "Rédaction de l'explication ultra-détaillée...", en: "Writing the ultra-detailed explanation..." },
  { fr: "Cela peut prendre plusieurs minutes — reste sur cette page.", en: "This can take several minutes — stay on this page." },
  { fr: "Vérification et assemblage du contenu...", en: "Checking and assembling the content..." },
];

export function ExplicationGeneratingLabel({ className }: { className?: string }) {
  const [index, setIndex] = useState(0);
  const { language } = useLanguage();

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % EXPLICATION_WORKING_MESSAGES.length);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  return <span className={className}>{EXPLICATION_WORKING_MESSAGES[index][language]}</span>;
}
