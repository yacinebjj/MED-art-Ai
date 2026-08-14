import { Spinner } from "@/components/ui/Spinner";

/** Shown the instant a module link is clicked, while this route's JS/RSC payload loads — same full-screen treatment as the demo course workspace, which this page mirrors structurally. */
export default function ModuleWorkspaceLoading() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-white dark:bg-slate-950">
      <Spinner className="h-6 w-6 text-primary-600 dark:text-primary-400" />
    </div>
  );
}
