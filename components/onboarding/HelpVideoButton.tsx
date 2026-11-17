"use client";

import { useCallback, useState, type ComponentType } from "react";
import { CirclePlay } from "lucide-react";
import { cn } from "@/lib/utils";
import { HELP_VIDEOS_ENABLED } from "@/lib/feature-flags";
import { hasHelpVideo } from "@/lib/onboarding/help-videos";
import type { TourId } from "@/lib/onboarding/tour-ids";
import { useToast } from "@/components/ui/Toast";
import { useLanguage } from "@/providers/LanguageProvider";
// Type only: erased at build time, so the player stays out of every page's bundle.
import type { HelpVideoDialogProps } from "@/components/onboarding/HelpVideoDialog";

type Player = ComponentType<HelpVideoDialogProps>;

let playerLoad: Promise<Player> | null = null;

/**
 * The player (components/onboarding/HelpVideoDialog.tsx) and the clips' texts
 * are a chunk of their own, fetched on the first tap of a « ▶ » button and
 * shared by every button after that. A failed fetch (offline, or a tab left
 * open across a deploy) is forgotten, so the next tap tries again.
 */
function loadPlayer(): Promise<Player> {
  playerLoad ??= import("@/components/onboarding/HelpVideoDialog").then(
    (module) => module.HelpVideoDialog,
    (error: unknown) => {
      playerLoad = null;
      throw error;
    }
  );
  return playerLoad;
}

/**
 * A micro-tutorial for `tour`: `show()` loads the player and opens it, and
 * `player` must be rendered (it portals to <body>, so anywhere works). Until
 * the first `show()` it is null: no player code, no video, no image is ever
 * requested before a tap. `available` is false when the page or tool has no
 * clip, or with NEXT_PUBLIC_FEATURE_HELP_VIDEOS=false (lib/feature-flags.ts).
 */
export function useHelpVideo(tour: TourId | null | undefined) {
  const { toast } = useToast();
  const { language } = useLanguage();
  const [Player, setPlayer] = useState<Player | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const available = HELP_VIDEOS_ENABLED && hasHelpVideo(tour);

  const show = useCallback(() => {
    if (!available) return;
    setLoading(true);
    loadPlayer()
      .then((component) => {
        setPlayer(() => component);
        setOpen(true);
      })
      .catch(() =>
        toast({
          variant: "error",
          title: language === "fr" ? "Tutoriel indisponible" : "Tutorial unavailable",
          description:
            language === "fr"
              ? "Vérifie ta connexion, ou recharge la page si MedArt AI vient d'être mis à jour."
              : "Check your connection, or reload the page if MedArt AI was just updated.",
        })
      )
      .finally(() => setLoading(false));
  }, [available, language, toast]);

  const player = available && Player ? <Player tour={tour} open={open} onOpenChange={setOpen} /> : null;
  return { available, show, loading, player };
}

/**
 * The « ▶ » button, next to a « ? » guide button (TourReplayButton passes it
 * its own `className`, so both share size, shape and visibility). Renders
 * nothing when `tour` has no micro-tutorial.
 */
export function HelpVideoButton({ tour, className }: { tour: TourId; className?: string }) {
  const { language } = useLanguage();
  const video = useHelpVideo(tour);
  if (!video.available) return null;
  const label = language === "fr" ? "Voir le tutoriel vidéo" : "Watch the video tutorial";

  return (
    <>
      <button
        type="button"
        onClick={video.show}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-busy={video.loading || undefined}
        className={cn(
          // The « ? » button's own recipe (TourReplayButton).
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          video.loading && "animate-pulse",
          className
        )}
      >
        <CirclePlay className="h-[18px] w-[18px]" />
      </button>
      {video.player}
    </>
  );
}
