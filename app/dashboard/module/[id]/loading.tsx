import { BrandLoader } from "@/components/ui/BrandLoader";

/** Shown the instant a module link is clicked, while this route's JS/RSC payload loads — same full-screen treatment as the demo course workspace, which this page mirrors structurally. */
export default function ModuleWorkspaceLoading() {
  return (
    // The workspace's own canvas (as its in-page loader), never a white screen.
    <div className="copilot-canvas flex h-dvh min-h-dvh w-full items-center justify-center">
      {/* Fades in after a beat (app/globals.css): a quick load never flashes it. */}
      <div className="route-pending">
        <BrandLoader />
      </div>
    </div>
  );
}
