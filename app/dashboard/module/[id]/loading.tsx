import { BrandLoader } from "@/components/ui/BrandLoader";

/** Shown the instant a module link is clicked, while this route's JS/RSC payload loads — same full-screen treatment as the demo course workspace, which this page mirrors structurally. */
export default function ModuleWorkspaceLoading() {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-white dark:bg-slate-950">
      <BrandLoader />
    </div>
  );
}
