"use client";

import { RouteErrorFallback } from "@/components/layout/RouteErrorFallback";

/**
 * Error boundary INSIDE the dashboard shell: a failing page (or a chunk that
 * failed to load during navigation) is replaced in the content area only —
 * Sidebar and Topbar stay usable, so the student can navigate away without
 * reloading. See RouteErrorFallback.
 */
export default function ShellError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorFallback error={error} reset={reset} />;
}
