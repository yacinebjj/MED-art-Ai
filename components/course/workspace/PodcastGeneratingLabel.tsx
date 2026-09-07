"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/providers/LanguageProvider";

/**
 * Cycles through Podcast-specific "AI at work" phrases — a real generation
 * here takes ~1-4 minutes (a script-writing call plus one streamed ~10-15
 * min audio narration, see app/api/studio/podcast/route.ts), the longest of
 * any Studio section, so a generic "Génération en cours..." would read as
 * badly stalled. Mirrors components/dashboard/LectureNotesGeneratingLabel.tsx's
 * exact rotating-message mechanism with its own message list — this
 * feature's wait is long and different enough to deserve its own, not a
 * shared generic list.
 */
const PODCAST_WORKING_MESSAGES: { fr: string; en: string }[] = [
  { fr: "Analyse du cours...", en: "Analyzing the course..." },
  { fr: "Rédaction du script du podcast...", en: "Writing the podcast script..." },
  { fr: "Enregistrement de la narration...", en: "Recording the narration..." },
  { fr: "Finalisation de l'audio...", en: "Finalizing the audio..." },
];

export function PodcastGeneratingLabel({ className }: { className?: string }) {
  const [index, setIndex] = useState(0);
  const { language } = useLanguage();

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % PODCAST_WORKING_MESSAGES.length);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  return <span className={className}>{PODCAST_WORKING_MESSAGES[index][language]}</span>;
}
