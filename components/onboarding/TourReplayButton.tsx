"use client";

import { usePathname } from "next/navigation";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import { PAGE_TOURS_ENABLED } from "@/lib/feature-flags";
import { useLanguage } from "@/providers/LanguageProvider";
import { useOptionalOnboarding } from "@/lib/onboarding/onboarding-context";
import { pageTourFor, type TourId } from "@/lib/onboarding/tour-ids";

/**
 * The "?" guide button: replays a tour on demand, whether or not it was seen
 * (lib/onboarding/onboarding-context.tsx only auto-starts tours for new
 * accounts). With no `tour`, plays the current page's tour; renders nothing
 * when there is none, outside /dashboard, or with page tours switched off
 * (lib/feature-flags.ts).
 */
export function TourReplayButton({ tour, className }: { tour?: TourId | null; className?: string }) {
  const onboarding = useOptionalOnboarding();
  const pathname = usePathname();
  const { language } = useLanguage();
  const target = tour === undefined ? pageTourFor(pathname) : tour;
  if (!onboarding || !target || (target !== "dashboard" && !PAGE_TOURS_ENABLED)) return null;
  const label = language === "fr" ? "Revoir le guide de cette page" : "Replay this page's guide";

  return (
    <button
      type="button"
      onClick={() => onboarding.startTour(target)}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <CircleHelp className="h-[18px] w-[18px]" />
    </button>
  );
}
