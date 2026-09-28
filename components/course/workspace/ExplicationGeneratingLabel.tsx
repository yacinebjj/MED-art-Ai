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

/**
 * Live aggregate progress, when the caller has it. Purely additive: with no
 * `progress` prop this behaves exactly as before (rotating working
 * messages). It exists because a real production report — "the client did
 * NOT auto-retry, it just halted" — turned out to be unfalsifiable from the
 * UI: retries WERE structurally implemented, but nothing surfaced them, so
 * a part quietly retrying for minutes was indistinguishable from a frozen
 * app. Showing progress makes recovery visible instead of leaving the
 * student staring at an unchanging spinner.
 *
 * Aggregate, not per-part (unlike the single-part view this replaced): every
 * missing part now generates CONCURRENTLY (see
 * lib/studio-explication-client.ts's runGenerationInParts), so there is no
 * longer one "current" part/attempt/sub-part to name — `isRecovering` is
 * true whenever ANY of the parts currently in flight is on a retry or a
 * post-timeout subdivision, not a single tracked one.
 */
export interface ExplicationProgressView {
  completedParts: number;
  totalParts: number;
  inFlightParts: number;
  isRecovering: boolean;
  phase: "generating" | "stitching";
}

export function ExplicationGeneratingLabel({ className, progress }: { className?: string; progress?: ExplicationProgressView | null }) {
  const [index, setIndex] = useState(0);
  const { language } = useLanguage();

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % EXPLICATION_WORKING_MESSAGES.length);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  const partLabel =
    progress && progress.phase === "generating"
      ? language === "en"
        ? `${progress.completedParts}/${progress.totalParts} parts done — ${progress.inFlightParts} in progress`
        : `${progress.completedParts}/${progress.totalParts} parties terminées — ${progress.inFlightParts} en cours`
      : progress && progress.phase === "stitching"
        ? language === "en"
          ? "Smoothing transitions between parts..."
          : "Fusion des transitions entre les parties..."
        : null;

  const recoveryLabel =
    progress && progress.phase === "generating" && progress.isRecovering
      ? language === "en"
        ? "retrying one or more parts..."
        : "nouvelle tentative sur une ou plusieurs parties..."
      : null;

  return (
    <span className={className}>
      {EXPLICATION_WORKING_MESSAGES[index][language]}
      {partLabel ? ` · ${partLabel}` : ""}
      {recoveryLabel ? ` · ${recoveryLabel}` : ""}
    </span>
  );
}
