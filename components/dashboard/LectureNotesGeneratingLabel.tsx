"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/providers/LanguageProvider";

/**
 * Cycles through generic "Audio to Smart Notes" phrases — used for the two
 * steps that don't have a natural "step X of Y" (decoding the file client-
 * side, then the final Phase 2 extraction call). Mirrors
 * components/course/workspace/PodcastGeneratingLabel.tsx's exact mechanism.
 * During the actual per-chunk transcription loop
 * (components/dashboard/LectureNotesUploader.tsx), pass `progress` instead —
 * a real "segment 3/12" beats a generic rotating phrase once real progress
 * is known.
 */
const LECTURE_NOTES_WORKING_MESSAGES: { fr: string; en: string }[] = [
  { fr: "Analyse de l'enregistrement...", en: "Analyzing the recording..." },
  { fr: "Filtrage du bruit et du hors-sujet...", en: "Filtering out noise and off-topic talk..." },
  { fr: "Extraction des perles cliniques...", en: "Extracting the clinical gems..." },
  { fr: "Structuration des Smart Notes...", en: "Structuring the Smart Notes..." },
];

export function LectureNotesGeneratingLabel({
  className,
  progress,
}: {
  className?: string;
  /** When given (e.g. { current: 3, total: 12 }), shows real per-chunk progress instead of the generic rotating phrases. */
  progress?: { current: number; total: number };
}) {
  const [index, setIndex] = useState(0);
  const { language } = useLanguage();

  useEffect(() => {
    if (progress) return; // Real progress is already known — no need to rotate a generic phrase over it.
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % LECTURE_NOTES_WORKING_MESSAGES.length);
    }, 3500);
    return () => clearInterval(interval);
  }, [progress]);

  if (progress) {
    const label =
      language === "fr"
        ? `Transcription du segment ${progress.current}/${progress.total}...`
        : `Transcribing segment ${progress.current}/${progress.total}...`;
    return <span className={className}>{label}</span>;
  }

  return <span className={className}>{LECTURE_NOTES_WORKING_MESSAGES[index][language]}</span>;
}
