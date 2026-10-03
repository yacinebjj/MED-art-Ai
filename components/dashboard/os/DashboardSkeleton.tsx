/**
 * Route-level skeleton for the dashboard shell (app/dashboard/(shell)/loading.tsx
 * and Suspense fallbacks). A server-safe component (no hooks, no client JS):
 * it paints on the very first frame of a navigation, before any of the
 * target page's code or data has arrived.
 */
function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-[color-mix(in_oklab,var(--muted)_75%,transparent)] ${className}`} />;
}

export function DashboardSkeleton({ variant = "page" }: { variant?: "page" | "compact" }) {
  if (variant === "compact") {
    return (
      <div className="space-y-3 py-2" aria-busy="true" aria-live="polite">
        <Block className="h-6 w-48" />
        <Block className="h-24 w-full" />
        <Block className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Chargement…</span>
      <div className="glass-card rounded-3xl p-5 sm:p-7">
        <Block className="h-3 w-32" />
        <Block className="mt-3 h-7 w-2/3 max-w-md" />
        <Block className="mt-3 h-4 w-1/2 max-w-sm" />
        <div className="mt-4 flex gap-2">
          <Block className="h-6 w-28 rounded-full" />
          <Block className="h-6 w-32 rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass-card flex min-h-[180px] flex-col gap-3 rounded-3xl p-5">
            <div className="flex items-center gap-2.5">
              <Block className="h-8 w-8 rounded-xl" />
              <Block className="h-4 w-32" />
            </div>
            <Block className="h-14 w-full" />
            <Block className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
