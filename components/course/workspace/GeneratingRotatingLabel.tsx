"use client";

import { useEffect, useState } from "react";
import { FAKE_AI_WORKING_MESSAGES } from "@/lib/fake-ai-delay";
import { useLanguage } from "@/providers/LanguageProvider";

/**
 * Cycles through generic "AI at work" phrases for the duration of any
 * generating/regenerating row — see lib/fake-ai-delay.ts's own comment for
 * why this exists (the cache-hit artificial-delay illusion) and the
 * call sites in app/dashboard/module/[id]/page.tsx. Used identically
 * whether the underlying result was cached or genuinely fresh — a real
 * generation also benefits from more engaging copy than a static
 * "Génération en cours...".
 */
export function GeneratingRotatingLabel({ className }: { className?: string }) {
  const [index, setIndex] = useState(0);
  const { language } = useLanguage();

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % FAKE_AI_WORKING_MESSAGES.length);
    }, 1600);
    return () => clearInterval(interval);
  }, []);

  return <span className={className}>{FAKE_AI_WORKING_MESSAGES[index][language]}</span>;
}
