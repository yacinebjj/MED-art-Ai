"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/Toast";
import { POMODORO_PHASE_EVENT, type PomodoroPhaseEventDetail } from "@/lib/pomodoro/schedule";

/**
 * Shows the Pomodoro phase toasts on every dashboard page. PomodoroProvider
 * (the engine, app/layout.tsx) chimes on each phase change but sits ABOVE
 * ToastProvider, so it can't toast itself: it fires POMODORO_PHASE_EVENT
 * instead, and this listener — mounted inside ToastProvider by
 * app/dashboard/layout.tsx — turns it into the message. Renders nothing.
 */
export function PomodoroAnnouncer() {
  const { toast } = useToast();

  useEffect(() => {
    function handlePhase(event: Event) {
      const { cue, cycle, timing } = (event as CustomEvent<PomodoroPhaseEventDetail>).detail;
      if (cue === "break") {
        toast({ variant: "info", title: "Pause méritée ☕", description: `${timing.rest} min pour souffler. Essaie le mode respiration.` });
      } else if (cue === "focus") {
        toast({ variant: "info", title: `Cycle ${cycle} — on repart !`, description: `${timing.study} min de concentration.` });
      } else {
        const plural = timing.cycles > 1 ? "s" : "";
        toast({ variant: "success", title: "Session terminée 🏆", description: `${timing.cycles} cycle${plural} bouclé${plural}. Bravo !` });
      }
    }
    window.addEventListener(POMODORO_PHASE_EVENT, handlePhase);
    return () => window.removeEventListener(POMODORO_PHASE_EVENT, handlePhase);
  }, [toast]);

  return null;
}
