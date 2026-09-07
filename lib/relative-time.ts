import type { Language } from "@/providers/LanguageProvider";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Coarse "modifié il y a X" label — real elapsed time from a real timestamp, never a fabricated freshness signal. */
export function formatRelativeTime(iso: string, language: Language, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  if (diff < MINUTE) return language === "fr" ? "à l'instant" : "just now";
  if (diff < HOUR) {
    const n = Math.floor(diff / MINUTE);
    return language === "fr" ? `il y a ${n} min` : `${n}m ago`;
  }
  if (diff < DAY) {
    const n = Math.floor(diff / HOUR);
    return language === "fr" ? `il y a ${n} h` : `${n}h ago`;
  }
  const days = Math.floor(diff / DAY);
  if (days === 1) return language === "fr" ? "hier" : "yesterday";
  if (days < 7) return language === "fr" ? `il y a ${days} j` : `${days}d ago`;
  return new Date(iso).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "short", year: "numeric" });
}
