import { DashboardSkeleton } from "@/components/dashboard/os/DashboardSkeleton";

/**
 * Loading boundary for every page INSIDE the dashboard shell (dashboard,
 * assistant, study, to-do, groups, notes, billing, settings).
 *
 * app/dashboard/loading.tsx sits ABOVE app/dashboard/(shell)/layout.tsx, so
 * it only covers jumps between top-level segments (shell → module workspace,
 * audio workspace…). A navigation between two shell pages changes a segment
 * BELOW the shell layout, where there was no boundary at all: React kept the
 * old page on screen until the new route's code and payload had fully
 * arrived — the "click, nothing happens" stall. With this file the Sidebar
 * and Topbar stay put and the content area switches to a skeleton on the
 * very next frame.
 *
 * `route-pending` (app/globals.css): the skeleton only fades in after a
 * beat, so a page that lands quickly goes straight from the old page's exit
 * to its own entrance, without a skeleton flashing in between.
 */
export default function ShellLoading() {
  return (
    <div className="route-pending">
      <DashboardSkeleton />
    </div>
  );
}
