import { BrandLoader } from "@/components/ui/BrandLoader";

/**
 * Shown the instant Examen de module is opened, while its code loads: the
 * exam's own stage, the top bar's slot and the two panel frames — the page's
 * shape in its own colours, never a blank screen. Same geometry as the page
 * (app/dashboard/module/[id]/exam/page.tsx), so nothing jumps when it lands.
 */
export default function ExamLoading() {
  return (
    <div className="cyber-stage cyber-stage-plain flex h-dvh min-h-[100dvh] w-full flex-col overflow-hidden rounded-none border-0">
      <div
        aria-hidden
        className="glass-chrome h-[var(--topbar-height)] shrink-0 rounded-none border-x-0 border-t-0 sm:mx-3 sm:mt-3 sm:rounded-2xl sm:border md:mx-4 md:mt-4"
      />
      <div className="flex min-h-0 w-full flex-1 gap-3 pt-2 sm:p-3">
        <div aria-hidden className="cyber-glass hidden w-64 shrink-0 animate-none rounded-3xl md:block xl:w-72" />
        <div className="cyber-glass flex min-h-0 flex-1 animate-none items-center justify-center rounded-none sm:rounded-3xl">
          {/* Fades in after a beat (app/globals.css): a quick load never flashes it. */}
          <div className="route-pending">
            <BrandLoader />
          </div>
        </div>
      </div>
    </div>
  );
}
