/**
 * "UX Illusion" — product direction: when Studio content is served from a
 * cache (any of studio_content_cache / studio_resume_mode_cache /
 * studio_content_variations), the student should still feel like the AI is
 * actively working on it rather than seeing an instant, suspiciously-fast
 * result. Call sites: app/dashboard/module/[id]/page.tsx's
 * handleStudioItemClick / handleGenerateResumeMode / handleRegenerateSection
 * — each awaits `wait(randomFakeDelayMs())` after a cache-hit response,
 * BEFORE revealing the result, keeping the existing "generating" spinner/
 * label visible for the extra time. Never applied to a genuine cache MISS —
 * a real generation already takes real time, no illusion needed there.
 */

export const FAKE_AI_WORKING_MESSAGES: { fr: string; en: string }[] = [
  { fr: "Analyse clinique en cours...", en: "Running clinical analysis..." },
  { fr: "Extraction des mots-clés...", en: "Extracting keywords..." },
  { fr: "Génération par l'IA...", en: "Generating with AI..." },
  { fr: "Vérification de la cohérence médicale...", en: "Checking medical consistency..." },
  { fr: "Structuration du contenu...", en: "Structuring the content..." },
  { fr: "Finalisation...", en: "Finalizing..." },
];

const MIN_DELAY_MS = 5000;
const MAX_DELAY_MS = 10000;

export function randomFakeDelayMs(): number {
  return Math.floor(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

/**
 * The Fiche de Synthèse's cache-hit reveal (2026-11-18): a short "it's being
 * put together" moment instead of the 5-10 s above — students found the
 * sheet slow to appear, and its image still has to download after the delay
 * (the page starts that download first, so the reveal doubles as prefetch).
 */
const QUICK_REVEAL_MIN_MS = 1500;
const QUICK_REVEAL_MAX_MS = 2500;

export function randomQuickRevealMs(): number {
  return Math.floor(QUICK_REVEAL_MIN_MS + Math.random() * (QUICK_REVEAL_MAX_MS - QUICK_REVEAL_MIN_MS));
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
