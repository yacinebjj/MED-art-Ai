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
    <div className="animate-pulse space-y-4 py-2" aria-hidden="true">
      <div className="h-7 w-2/3 rounded-lg bg-gray-200 dark:bg-neutral-800" />
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 w-20 rounded-full bg-gray-200 dark:bg-neutral-800" />
        ))}
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full rounded bg-gray-200 dark:bg-neutral-800" />
        <div className="h-4 w-11/12 rounded bg-gray-200 dark:bg-neutral-800" />
        <div className="h-4 w-4/5 rounded bg-gray-200 dark:bg-neutral-800" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="h-24 rounded-2xl bg-gray-200 dark:bg-neutral-800" />
        <div className="h-24 rounded-2xl bg-gray-200 dark:bg-neutral-800" />
      </div>
    </div>
  );
}
