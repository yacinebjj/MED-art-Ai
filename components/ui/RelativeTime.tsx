"use client";

import { useEffect, useState } from "react";

/**
 * `Intl.RelativeTimeFormat`, not the `date-fns` package — no new dependency
 * for what a built-in Web/Node API already covers, and this app has no other
 * `date-fns` usage to piggyback on. French, "auto" numeric form so a value
 * inside the smallest unit's own near-zero range reads as "à l'instant"
 * rather than the stiffer "il y a 0 minute".
 */
const RTF = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

const UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "year", seconds: 31536000 },
  { unit: "month", seconds: 2592000 },
  { unit: "week", seconds: 604800 },
  { unit: "day", seconds: 86400 },
  { unit: "hour", seconds: 3600 },
  { unit: "minute", seconds: 60 },
  { unit: "second", seconds: 1 },
];

function formatRelative(iso: string): string {
  const diffSeconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const { unit, seconds } of UNITS) {
    if (Math.abs(diffSeconds) >= seconds || unit === "second") {
      return RTF.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return RTF.format(0, "second");
}

// Under a minute old, the label is refreshed every 5s (so "à l'instant"
// promptly becomes "il y a X secondes"); past that, once a minute is plenty
// — nobody needs a "il y a 5 minutes" label to update mid-minute.
const FAST_REFRESH_MS = 5_000;
const SLOW_REFRESH_MS = 60_000;

/**
 * Self-updating relative-time label ("il y a 5 minutes") — an isolated
 * `setInterval` inside THIS component only, so a parent card showing several
 * of these (or anything else on the page) never re-renders just because one
 * timestamp's label ticked over. Replaces Studio's "Récemment généré" list,
 * which previously showed the exact same hardcoded "{sourceCount} source(s)"
 * text on every row regardless of which section it was (see StudioPanel.tsx).
 */
export function RelativeTime({ timestamp, className }: { timestamp: string | null; className?: string }) {
  const [label, setLabel] = useState<string | null>(() => (timestamp ? formatRelative(timestamp) : null));

  useEffect(() => {
    if (!timestamp) {
      setLabel(null);
      return;
    }
    setLabel(formatRelative(timestamp));

    // A recursive setTimeout (not one fixed setInterval) so the cadence
    // itself can slow down once the item crosses the 1-minute mark, instead
    // of being frozen forever at whatever was true the moment this effect
    // last ran.
    let id: ReturnType<typeof setTimeout>;
    function tick() {
      setLabel(formatRelative(timestamp!));
      const ageMs = Date.now() - new Date(timestamp!).getTime();
      id = setTimeout(tick, ageMs < 60_000 ? FAST_REFRESH_MS : SLOW_REFRESH_MS);
    }
    id = setTimeout(tick, FAST_REFRESH_MS);
    return () => clearTimeout(id);
  }, [timestamp]);

  if (!label) return null;
  return <span className={className}>{label}</span>;
}
