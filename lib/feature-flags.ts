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
