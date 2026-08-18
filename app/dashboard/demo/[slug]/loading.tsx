import { BrandLoader } from "@/components/ui/BrandLoader";

/** Shown the instant a course link is clicked, while this route's JS/RSC payload loads — overrides the generic app/dashboard/loading.tsx with a fallback tuned to a full-screen workspace instead of a half-page panel. */
export default function CourseWorkspaceLoading() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-white dark:bg-slate-950">
      <BrandLoader />
    </div>
  );
}
