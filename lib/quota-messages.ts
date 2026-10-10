/**
 * Client-safe (no server imports): shared between lib/subscription.ts, which
 * returns it when a quota gate could not reach the database, and the global
 * fetch wrapper in components/billing/PaywallProvider.tsx, which recognizes it
 * and silently replays the request instead of showing it to the student.
 */
export const QUOTA_CHECK_FAILED_MESSAGE = "Impossible de vérifier ton quota pour le moment. Réessaie dans un instant.";
