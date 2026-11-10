"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CircleCheck, Info, LoaderCircle, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { currentInstallEnvironment, promptInstall, useInstallState, type InstallEnvironment, type InstallPlatform } from "@/lib/pwa-install";
import { tInstall, type InstallKey } from "@/lib/translations/install";
import {
  AndroidInstallMockup,
  AndroidMenuButtonMockup,
  AndroidMenuMockup,
  DesktopBarMockup,
  DesktopInstallIconMockup,
  DesktopInstallMockup,
  IosAddMockup,
  IosShareMockup,
  IosShareSheetMockup,
} from "@/components/pwa/InstallGuideMockups";

const PLATFORMS: { id: InstallPlatform; label: InstallKey }[] = [
  { id: "ios", label: "platformIos" },
  { id: "android", label: "platformAndroid" },
  { id: "desktop", label: "platformDesktop" },
];

interface Guide {
  steps: { title: InstallKey; text: InstallKey; picture: ReactNode }[];
  /** Another browser, another menu: one line for it. */
  hint: InstallKey;
  /** Opened inside another app (Instagram, Facebook…): what to do first. */
  inApp: InstallKey | null;
}

function guideFor(platform: InstallPlatform, environment: InstallEnvironment, language: Language): Guide {
  if (platform === "ios") {
    // Chrome on iOS keeps Share in its address bar; Safari (and the others) in the bottom bar.
    const chrome = environment.platform === "ios" && environment.browser === "chrome";
    return {
      steps: [
        { title: "iosStep1", text: chrome ? "iosStep1Chrome" : "iosStep1Safari", picture: <IosShareMockup chrome={chrome} language={language} /> },
        { title: "iosStep2", text: "iosStep2Text", picture: <IosShareSheetMockup language={language} /> },
        { title: "iosStep3", text: "iosStep3Text", picture: <IosAddMockup language={language} /> },
      ],
      hint: "iosHint",
      inApp: "iosInApp",
    };
  }
  if (platform === "android") {
    return {
      steps: [
        { title: "androidStep1", text: "androidStep1Text", picture: <AndroidMenuButtonMockup language={language} /> },
        { title: "androidStep2", text: "androidStep2Text", picture: <AndroidMenuMockup language={language} /> },
        { title: "androidStep3", text: "androidStep3Text", picture: <AndroidInstallMockup language={language} /> },
      ],
      hint: "androidHint",
      inApp: "androidInApp",
    };
  }
  return {
    steps: [
      { title: "desktopStep1", text: "desktopStep1Text", picture: <DesktopBarMockup language={language} /> },
      { title: "desktopStep2", text: "desktopStep2Text", picture: <DesktopInstallIconMockup language={language} /> },
      { title: "desktopStep3", text: "desktopStep3Text", picture: <DesktopInstallMockup language={language} /> },
    ],
    hint: "desktopHint",
    inApp: null,
  };
}

/**
 * « Installer l'application » (product order 2026-11-10): MedArt on the home
 * screen in a few seconds, for a student who has no patience left.
 *  - Opens on this device's guide (iPhone / iPad, Android, PC / Mac — the pill
 *    marked with a dot); the pills switch guides, arrow keys too.
 *  - Where the browser offers it (Chromium: Android, Chrome / Edge on a
 *    computer), « Installer en 1 clic » shows its own install dialog
 *    (lib/pwa-install.ts). Declined or not offered: the steps are right there.
 *  - Three steps, each with a miniature of the browser's real controls and the
 *    one to touch lit up (components/pwa/InstallGuideMockups.tsx), joined by a
 *    glowing trace.
 *  - Frosted glass over a deep blur; the card pops in on the lively spring
 *    (app/globals.css, INSTALL GUIDE). Opened by the entry points
 *    (components/pwa/InstallAppEntry.tsx) through components/pwa/InstallAppHost.tsx.
 */
export function InstallAppModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { language } = useLanguage();
  const environment = useMemo(() => currentInstallEnvironment(), []);
  const { canPrompt, installed } = useInstallState();
  const [platform, setPlatform] = useState<InstallPlatform>(environment.platform);
  const [prompting, setPrompting] = useState(false);
  const [declined, setDeclined] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Every opening starts on this device's guide.
  useEffect(() => {
    if (!open) return;
    setPlatform(environment.platform);
    setDeclined(false);
  }, [open, environment.platform]);

  const index = Math.max(0, PLATFORMS.findIndex((entry) => entry.id === platform));
  const onThisDevice = platform === environment.platform;
  const guide = guideFor(platform, environment, language);
  const oneClick = canPrompt && !installed && onThisDevice;

  async function installNow() {
    haptic();
    setPrompting(true);
    const outcome = await promptInstall();
    setPrompting(false);
    if (outcome !== "accepted") setDeclined(true);
  }

  function choose(next: InstallPlatform) {
    if (next === platform) return;
    haptic();
    setPlatform(next);
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const last = PLATFORMS.length - 1;
    const target =
      event.key === "ArrowRight" ? (index + 1) % PLATFORMS.length : event.key === "ArrowLeft" ? (index + last) % PLATFORMS.length : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (target < 0) return;
    event.preventDefault();
    setPlatform(PLATFORMS[target].id);
    tabRefs.current[target]?.focus();
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="install-overlay fixed inset-0 z-[1200] bg-black/80 backdrop-blur-2xl" />
        <DialogPrimitive.Content className="install-card fixed left-1/2 top-1/2 z-[1200] flex w-[calc(100%-1.5rem)] max-w-[30rem] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-black/[0.06] bg-white/95 text-slate-900 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)] outline-none dark:border-white/10 dark:bg-neutral-900/95 dark:text-white">
          {/* A faint grid and a pool of sky light at the top: the glass catches it. */}
          <div aria-hidden="true" className="install-grid pointer-events-none absolute inset-x-0 top-0 h-44" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(70%_100%_at_50%_0%,rgba(56,189,248,0.22),transparent_70%)]" />

          <header className="relative shrink-0 px-5 pb-4 pt-5">
            <div className="flex items-start gap-3.5 pr-10">
              <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white shadow-[0_0_0_1px_rgba(14,165,233,0.25),0_10px_28px_-8px_rgba(14,165,233,0.65)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- the app's own icon (public/icons): the one the student will find on their screen */}
                <img src="/icons/icon-192.png" alt="" draggable={false} className="h-11 w-11 rounded-xl" />
              </span>
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-[1.1875rem] font-bold leading-tight tracking-tight">{tInstall("title", language)}</DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1 text-[0.875rem] leading-snug text-slate-500 dark:text-neutral-400">
                  {tInstall("subtitle", language)}
                </DialogPrimitive.Description>
              </div>
            </div>
            <DialogPrimitive.Close
              aria-label={tInstall("close", language)}
              className="touch-target absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-slate-400 transition-colors duration-150 hover:bg-black/[0.05] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 dark:text-neutral-500 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <X className="h-[18px] w-[18px]" />
            </DialogPrimitive.Close>

            <div role="tablist" aria-label={tInstall("platforms", language)} className="relative mt-4 grid grid-cols-3 rounded-2xl bg-black/[0.045] p-1 dark:bg-white/[0.06]">
              <span
                aria-hidden="true"
                className="install-tab-indicator absolute bottom-1 left-1 top-1 w-[calc((100%-0.5rem)/3)] rounded-xl bg-white shadow-[0_2px_8px_-2px_rgba(15,23,42,0.18)] ring-1 ring-black/[0.04] dark:bg-white/[0.12] dark:ring-white/10"
                style={{ translate: `${index * 100}% 0` }}
              />
              {PLATFORMS.map((entry, position) => {
                const selected = entry.id === platform;
                return (
                  <button
                    key={entry.id}
                    ref={(node) => {
                      tabRefs.current[position] = node;
                    }}
                    type="button"
                    role="tab"
                    id={`install-tab-${entry.id}`}
                    aria-selected={selected}
                    aria-controls="install-panel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => choose(entry.id)}
                    onKeyDown={handleTabKeyDown}
                    className={cn(
                      "relative z-10 flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-xl px-1 text-[0.8125rem] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60",
                      selected ? "text-slate-900 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                    )}
                  >
                    <span className="truncate">{tInstall(entry.label, language)}</span>
                    {entry.id === environment.platform && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]">
                        <span className="sr-only">({tInstall("thisDevice", language)})</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </header>

          <div
            id="install-panel"
            role="tabpanel"
            aria-labelledby={`install-tab-${platform}`}
            className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pb-5 pt-1"
          >
            {installed ? (
              <div className="flex items-start gap-3 rounded-2xl bg-emerald-500/10 p-3.5 ring-1 ring-inset ring-emerald-500/25">
                <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                <div className="min-w-0">
                  <p className="text-[0.9375rem] font-semibold text-emerald-800 dark:text-emerald-300">{tInstall("installedTitle", language)}</p>
                  <p className="mt-0.5 text-[0.8125rem] leading-snug text-emerald-700/80 dark:text-emerald-200/80">{tInstall("installedText", language)}</p>
                </div>
              </div>
            ) : oneClick ? (
              <div>
                <button
                  type="button"
                  onClick={installNow}
                  disabled={prompting}
                  className="relative flex h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-sky-500 via-cyan-500 to-indigo-500 text-[1.0625rem] font-bold text-white shadow-[0_14px_34px_-12px_rgba(14,165,233,0.9)] transition-[transform,box-shadow] duration-200 hover:shadow-[0_18px_42px_-12px_rgba(14,165,233,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-wait dark:focus-visible:ring-offset-neutral-900"
                >
                  <span aria-hidden="true" className="install-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/45 to-transparent" />
                  {prompting ? <LoaderCircle className="relative h-5 w-5 animate-spin" /> : <Zap className="relative h-5 w-5 fill-current" />}
                  <span className="relative">{tInstall(prompting ? "oneClickPending" : "oneClick", language)}</span>
                </button>
                <p className="mt-2 text-center text-[0.75rem] font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">{tInstall("orSteps", language)}</p>
              </div>
            ) : declined && onThisDevice ? (
              <p className="text-[0.8125rem] leading-snug text-slate-500 dark:text-neutral-400">{tInstall("dismissed", language)}</p>
            ) : null}

            {onThisDevice && environment.inAppBrowser && guide.inApp && (
              <p className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-500/10 p-3 text-[0.8125rem] leading-snug text-amber-800 ring-1 ring-inset ring-amber-500/25 dark:text-amber-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                {tInstall(guide.inApp, language)}
              </p>
            )}

            {/* Keyed by guide: a new set of steps cascades in. */}
            <ol key={platform} aria-label={tInstall("steps", language)} className="mt-4">
              {guide.steps.map((step, position) => (
                <li
                  key={step.title}
                  className="install-step relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3.5 pb-6 last:pb-1"
                  style={{ "--step": position } as CSSProperties}
                >
                  {position < guide.steps.length - 1 && <span aria-hidden="true" className="install-trace absolute bottom-0 left-[1.125rem] top-11 w-0.5 -translate-x-1/2 rounded-full" />}
                  <span aria-hidden="true" className="install-node relative z-10 grid h-9 w-9 place-items-center rounded-full text-[0.9375rem] font-bold text-white">
                    {position + 1}
                  </span>
                  <div className="min-w-0 pt-1">
                    <h3 className="text-[1rem] font-semibold leading-snug">{tInstall(step.title, language)}</h3>
                    <p className="mt-0.5 text-[0.875rem] leading-snug text-slate-500 dark:text-neutral-400">{tInstall(step.text, language)}</p>
                    <div className="mt-3">{step.picture}</div>
                  </div>
                </li>
              ))}
            </ol>

            <p className="mt-5 flex items-start gap-2 text-[0.8125rem] leading-snug text-slate-500 dark:text-neutral-400">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
              {tInstall(guide.hint, language)}
            </p>
          </div>

          <footer className="relative shrink-0 border-t border-black/[0.06] p-4 dark:border-white/10">
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                onClick={() => haptic()}
                className="h-12 w-full rounded-2xl bg-slate-900 text-[0.9375rem] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(15,23,42,0.6)] transition-[transform,background-color] duration-150 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 active:scale-[0.98] dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 dark:focus-visible:ring-offset-neutral-900"
              >
                {tInstall("done", language)}
              </button>
            </DialogPrimitive.Close>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
