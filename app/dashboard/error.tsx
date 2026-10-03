"use client";

import { RouteErrorFallback } from "@/components/layout/RouteErrorFallback";

/** Error boundary for the dashboard's full-screen routes (module workspace, audio workspace, search…). See RouteErrorFallback. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorFallback error={error} reset={reset} fullHeight />;
}
