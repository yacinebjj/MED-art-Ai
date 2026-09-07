"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FullscreenToggleButtonProps {
  isFullscreen: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * Small icon button that toggles a panel's own local `isFullscreen` state.
 * Renders only the toggle affordance — the caller decides what "fullscreen"
 * means for its own layout, typically by switching its content wrapper to
 * `fixed inset-0 z-50 h-dvh w-screen overflow-y-auto bg-background p-4
 * sm:p-8`, mirroring the note editor's own proven pattern
 * (app/dashboard/(shell)/notes/page.tsx). A shared wrapper isn't used here
 * since every caller's normal-state layout (padding, prose classes, existing
 * scroll container) differs too much to fold into one generic component.
 */
export function FullscreenToggleButton({ isFullscreen, onToggle, className }: FullscreenToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isFullscreen ? "Réduire" : "Plein écran"}
      title={isFullscreen ? "Réduire" : "Plein écran"}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-soft backdrop-blur transition-all duration-200 hover:bg-accent hover:text-foreground active:scale-95",
        className
      )}
    >
      {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
    </button>
  );
}
