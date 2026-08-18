import { BrandLoader } from "@/components/ui/BrandLoader";

/**
 * Route-level Suspense fallback for every /dashboard/** navigation that
 * doesn't define its own loading.tsx (module workspace, demo course, search,
 * billing, settings...) — there was NONE anywhere in the app before this,
 * meaning every click into a new dashboard route showed a blank frozen page
 * for however long it took to fetch that route's JS/RSC payload, instead of
 * instant feedback. This alone doesn't make data fetching faster — it makes
 * the wait feel like zero instead of like a stall.
 */
export default function DashboardLoading() {
  return (
    <div className="flex h-full min-h-[50vh] w-full items-center justify-center">
      <BrandLoader className="h-6 w-6" />
    </div>
  );
}
