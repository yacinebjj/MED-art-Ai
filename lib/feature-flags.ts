/**
 * Product feature flags — the single switch for features whose code stays in
 * the repo but whose surface is withdrawn from students.
 *
 * NEXT_PUBLIC_* values are inlined at build time, so the same flag is read
 * identically by middleware, server routes and client components.
 */

/**
 * "Audio to Smart Notes" (app/dashboard/audio-workspace, app/api/lecture-notes/*,
 * components/audio-studio/*, lib/audio/*) — held back for the V2 release.
 * Everything is preserved; with the flag off:
 *  - every nav / Spotlight / dashboard / notification / pricing mention is hidden,
 *  - /dashboard/audio-workspace redirects to /dashboard (middleware + its layout),
 *  - /api/lecture-notes/** answers 404 (middleware), so nothing can be billed.
 * Set NEXT_PUBLIC_FEATURE_AUDIO_SMART_NOTES=true to bring it back.
 */
export const AUDIO_SMART_NOTES_ENABLED = process.env.NEXT_PUBLIC_FEATURE_AUDIO_SMART_NOTES === "true";

export const AUDIO_SMART_NOTES_PAGE = "/dashboard/audio-workspace";
export const AUDIO_SMART_NOTES_API = "/api/lecture-notes";

/**
 * Studio "Infographie / Fiche de Synthèse" (app/api/studio/infographic and
 * its /prompt step, lib/ai/infographic-sheet.ts, InfographicViewer) — live
 * since 2026-11-09 (product order), replacing the Infographie / Mindmap that
 * was shelved on 2026-10-08. On unless switched off: set
 * NEXT_PUBLIC_FEATURE_FICHE_SYNTHESE=false, then redeploy, to withdraw it —
 * the tile disappears from the Studio (desktop grid, mobile cards, command
 * palette, demo) and the landing pages, and every /api/studio/infographic
 * route answers 404 (middleware), so it cannot be triggered or billed.
 */
export const INFOGRAPHIC_ENABLED = process.env.NEXT_PUBLIC_FEATURE_FICHE_SYNTHESE !== "false";

export const INFOGRAPHIC_API = "/api/studio/infographic";

/**
 * Page and tool guided tours (lib/onboarding/tours.ts) — on unless switched
 * off. Set NEXT_PUBLIC_FEATURE_PAGE_TOURS=false, then redeploy, to withdraw
 * every page / Studio / Lab tour at once: none auto-starts and the "?" guide
 * buttons disappear. The dashboard's first-run tour is not affected.
 */
export const PAGE_TOURS_ENABLED = process.env.NEXT_PUBLIC_FEATURE_PAGE_TOURS !== "false";
