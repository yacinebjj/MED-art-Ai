import { cn } from "@/lib/utils";

/**
 * One shimmer block — a `bg-muted` base (token-driven, correct in both
 * themes) with a lighter band sweeping across it via the `animate-shimmer`
 * keyframe (tailwind.config.ts, `backgroundPosition` driven so it needs no
 * extra wrapper element). Reads as "this is actively loading", not just a
 * flat gray placeholder — and like every animation in this app, it collapses
 * to a static frame under `prefers-reduced-motion` (see globals.css).
 */
function ShimmerBlock({ className }: { className: string }) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-lg bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]",
        className
      )}
    />
  );
}

/**
 * Loading fallback for the heavy, dynamically-imported Studio tiles
 * (GastriteResumeStudio/GastriteCasCliniqueStudio/GastriteQcmsStudio — each
 * pulls in its own large render tree: multi-mode tabs, mermaid-style cards,
 * an interactive quiz engine). Shown for the brief moment their JS chunk is
 * still streaming in, instead of a blank pane or a single spinner — content-
 * shaped so the layout doesn't visibly jump once the real tile mounts.
 */
export function StudioTileSkeleton() {
  return (
    <div className="space-y-4 py-2" aria-hidden="true">
      <ShimmerBlock className="h-7 w-2/3" />
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <ShimmerBlock key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <div className="space-y-2">
        <ShimmerBlock className="h-4 w-full" />
        <ShimmerBlock className="h-4 w-11/12" />
        <ShimmerBlock className="h-4 w-4/5" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ShimmerBlock className="h-24 rounded-2xl" />
        <ShimmerBlock className="h-24 rounded-2xl" />
      </div>
    </div>
  );
}
