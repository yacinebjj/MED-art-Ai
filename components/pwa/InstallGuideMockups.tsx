"use client";

import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  EllipsisVertical,
  History,
  House,
  Lock,
  MonitorDown,
  MousePointer2,
  Plus,
  RotateCw,
  Share,
  SquarePlus,
  Star,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tInstall } from "@/lib/translations/install";
import type { Language } from "@/providers/LanguageProvider";

/**
 * The install guide's pictures (components/pwa/InstallAppModal.tsx): each
 * browser's real controls redrawn in miniature — no screenshot to go stale —
 * with the one to touch lit up: a glowing ring, a halo that pulses outward
 * and a nudging arrow « Touche ici » (app/globals.css, INSTALL GUIDE). Purely
 * illustrative: the step's own text says everything (aria-hidden).
 */

/** The app's own icon — the very one the student will find on their screen. */
function AppIcon({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the app's own icon (public/icons), shown at a few pixels
    <img src="/icons/icon-192.png" alt="" draggable={false} className={cn("shrink-0 bg-white object-cover ring-1 ring-black/[0.06]", className)} />
  );
}

/** The surface a miniature sits on. */
function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative select-none rounded-2xl bg-gradient-to-b from-slate-50 to-slate-100 p-2.5 ring-1 ring-inset ring-black/[0.06] dark:from-white/[0.06] dark:to-white/[0.025] dark:ring-white/10",
        className
      )}
    >
      {children}
    </div>
  );
}

/** A miniature panel of the browser (bar, sheet, menu, dialog). */
const PANEL = "bg-white/95 ring-1 ring-black/[0.06] shadow-[0_6px_18px_-8px_rgba(15,23,42,0.28)] dark:bg-neutral-800/95 dark:ring-white/10";

/** The control to touch: a glowing ring and a halo pulsing outward. */
function Target({ children, shape = "pill", className }: { children: ReactNode; shape?: "circle" | "pill" | "row"; className?: string }) {
  const radius = shape === "circle" ? "rounded-full" : shape === "row" ? "rounded-[0.625rem]" : "rounded-lg";
  return (
    <span className={cn("relative z-10 inline-flex items-center justify-center", className)}>
      <span className={cn("install-halo pointer-events-none absolute -inset-1.5 ring-2 ring-sky-400/60", radius)} />
      <span className={cn("pointer-events-none absolute -inset-[3px] bg-sky-400/10 shadow-[0_0_14px_2px_rgba(56,189,248,0.55)] ring-2 ring-sky-400", radius)} />
      <span className="relative flex w-full items-center justify-center">{children}</span>
    </span>
  );
}

/** The nudging arrow and its « Touche ici » chip, pointing at the control above (up) or below (down). */
function Pointer({ direction, label, className }: { direction: "up" | "down"; label: string; className?: string }) {
  const Arrow = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "pointer-events-none absolute z-20 flex items-center gap-0.5",
        direction === "up" ? "install-nudge-up flex-col" : "install-nudge-down flex-col-reverse",
        className
      )}
    >
      <Arrow className="h-4 w-4 text-sky-500 drop-shadow-[0_0_6px_rgba(56,189,248,0.9)]" strokeWidth={3} />
      <span className="whitespace-nowrap rounded-full bg-sky-500 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider text-white shadow-[0_6px_16px_-4px_rgba(14,165,233,0.8)]">
        {label}
      </span>
    </span>
  );
}

/** A few faint lines: the page behind the browser's controls. */
function PageLines({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-1.5 px-1", className)}>
      <div className="h-2 w-2/3 rounded-full bg-slate-300/70 dark:bg-white/10" />
      <div className="h-2 w-1/2 rounded-full bg-slate-300/50 dark:bg-white/[0.07]" />
    </div>
  );
}

function Row({ label, icon: Icon, highlighted = false, iconFirst = false }: { label: string; icon?: LucideIcon; highlighted?: boolean; iconFirst?: boolean }) {
  return (
    <span
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-[0.75rem]",
        iconFirst ? "flex-row" : "flex-row-reverse justify-between",
        highlighted ? "font-semibold text-sky-700 dark:text-sky-300" : "text-slate-700 dark:text-neutral-200"
      )}
    >
      {Icon && <Icon className={cn("h-4 w-4 shrink-0", highlighted ? "text-sky-600 dark:text-sky-300" : "text-slate-500 dark:text-neutral-400")} strokeWidth={2.1} />}
      <span className={cn("truncate", iconFirst && "flex-1")}>{label}</span>
    </span>
  );
}

// ── iPhone / iPad ──────────────────────────────────────────────────────────

/** Step 1: Safari's bottom bar (Share in the middle), or Chrome's address bar (Share at its end). */
export function IosShareMockup({ chrome, language }: { chrome: boolean; language: Language }) {
  if (chrome) {
    return (
      <Frame className="h-[7.75rem]">
        <div className={cn("flex h-10 items-center gap-2 rounded-[0.875rem] pl-3 pr-1.5", PANEL)}>
          <Lock className="h-3 w-3 text-slate-400" strokeWidth={2.5} />
          <span className="flex-1 truncate text-[0.75rem] text-slate-600 dark:text-neutral-300">medartai.com</span>
          <Target shape="circle">
            <span className="grid h-7 w-7 place-items-center">
              <Share className="h-4 w-4 text-blue-500" strokeWidth={2.25} />
            </span>
          </Target>
        </div>
        <PageLines className="mt-3 w-1/2" />
        <Pointer direction="up" label={tInstall("tapHere", language)} className="right-2 top-[3.6rem]" />
      </Frame>
    );
  }
  return (
    <Frame className="h-[7.75rem]">
      <PageLines className="pt-0.5" />
      <Pointer direction="down" label={tInstall("tapHere", language)} className="bottom-[3.45rem] left-1/2 -translate-x-1/2" />
      <div className={cn("absolute inset-x-2.5 bottom-2.5 flex h-10 items-center justify-between rounded-[0.875rem] px-4 text-slate-400 dark:text-neutral-500", PANEL)}>
        <ChevronLeft className="h-[18px] w-[18px]" />
        <ChevronRight className="h-[18px] w-[18px]" />
        <Target shape="circle">
          <span className="grid h-7 w-7 place-items-center">
            <Share className="h-[18px] w-[18px] text-blue-500" strokeWidth={2.25} />
          </span>
        </Target>
        <BookOpen className="h-[18px] w-[18px]" />
        <Copy className="h-[18px] w-[18px]" />
      </div>
    </Frame>
  );
}

/** Step 2: the share sheet, « Sur l'écran d'accueil » lit up. */
export function IosShareSheetMockup({ language }: { language: Language }) {
  return (
    <Frame>
      <div className="mb-2 flex items-center gap-2 px-1">
        <AppIcon className="h-7 w-7 rounded-[0.5rem]" />
        <div className="min-w-0">
          <p className="text-[0.75rem] font-semibold leading-tight text-slate-800 dark:text-white">MedArt AI</p>
          <p className="text-[0.625rem] leading-tight text-slate-400">medartai.com</p>
        </div>
      </div>
      <div className={cn("rounded-xl py-0.5", PANEL)}>
        <Row label={tInstall("mockCopy", language)} icon={Copy} />
        <div className="mx-3 h-px bg-black/[0.06] dark:bg-white/10" />
        <Row label={tInstall("mockFavorites", language)} icon={Star} />
        <div className="mx-3 h-px bg-black/[0.06] dark:bg-white/10" />
        <Target shape="row" className="flex w-full">
          <Row label={tInstall("mockAddHome", language)} icon={SquarePlus} highlighted />
        </Target>
      </div>
    </Frame>
  );
}

/** Step 3: « Ajouter », top right, and the app as it will appear. */
export function IosAddMockup({ language }: { language: Language }) {
  return (
    <Frame className="pt-10">
      <Pointer direction="down" label={tInstall("tapHere", language)} className="right-[1.05rem] top-1" />
      <div className={cn("rounded-xl", PANEL)}>
        <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-3 py-2 dark:border-white/10">
          <span className="text-[0.75rem] text-blue-500">{tInstall("mockCancel", language)}</span>
          <span className="min-w-0 truncate text-[0.6875rem] font-semibold text-slate-800 dark:text-white">{tInstall("mockAddHomeTitle", language)}</span>
          <Target>
            <span className="px-1 text-[0.75rem] font-bold text-blue-500">{tInstall("mockAdd", language)}</span>
          </Target>
        </div>
        <div className="flex items-center gap-3 px-3 py-3">
          <AppIcon className="h-11 w-11 rounded-[0.7rem]" />
          <div className="min-w-0 flex-1 border-b border-black/[0.06] pb-1 dark:border-white/10">
            <p className="text-[0.8125rem] font-medium text-slate-800 dark:text-white">MedArt AI</p>
            <p className="truncate text-[0.625rem] text-slate-400">www.medartai.com</p>
          </div>
        </div>
      </div>
    </Frame>
  );
}

// ── Android ────────────────────────────────────────────────────────────────

/** Step 1: Chrome's top bar, the ⋮ menu lit up. */
export function AndroidMenuButtonMockup({ language }: { language: Language }) {
  return (
    <Frame className="h-[7.75rem]">
      <div className={cn("flex h-10 items-center gap-2 rounded-xl px-2", PANEL)}>
        <House className="h-4 w-4 shrink-0 text-slate-500 dark:text-neutral-400" />
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 dark:bg-white/10">
          <Lock className="h-3 w-3 shrink-0 text-slate-400" strokeWidth={2.5} />
          <span className="truncate text-[0.6875rem] text-slate-600 dark:text-neutral-300">medartai.com</span>
        </div>
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[0.3rem] border-[1.5px] border-slate-500 text-[0.5625rem] font-bold text-slate-600 dark:border-neutral-400 dark:text-neutral-300">1</span>
        <Target shape="circle">
          <span className="grid h-7 w-7 place-items-center">
            <EllipsisVertical className="h-4 w-4 text-slate-700 dark:text-neutral-200" strokeWidth={2.5} />
          </span>
        </Target>
      </div>
      <PageLines className="mt-3 w-1/2" />
      <Pointer direction="up" label={tInstall("tapHere", language)} className="right-[0.55rem] top-[3.6rem]" />
    </Frame>
  );
}

/** Step 2: Chrome's menu, « Installer l'application » lit up. */
export function AndroidMenuMockup({ language }: { language: Language }) {
  return (
    <Frame>
      <div className={cn("ml-auto w-[88%] rounded-xl py-1", PANEL)}>
        <Row label={tInstall("mockNewTab", language)} icon={Plus} iconFirst />
        <Row label={tInstall("mockHistory", language)} icon={History} iconFirst />
        <div className="px-1">
          <Target shape="row" className="flex w-full">
            <Row label={tInstall("mockInstallApp", language)} icon={Download} highlighted iconFirst />
          </Target>
        </div>
      </div>
    </Frame>
  );
}

/** Step 3: Chrome's confirmation, « Installer » lit up. */
export function AndroidInstallMockup({ language }: { language: Language }) {
  return (
    <Frame className="pb-11">
      <div className={cn("mx-auto rounded-2xl p-3", PANEL)}>
        <p className="text-[0.8125rem] font-semibold text-slate-800 dark:text-white">{tInstall("mockInstallQuestion", language)}</p>
        <div className="mt-2 flex items-center gap-2.5">
          <AppIcon className="h-9 w-9 rounded-full" />
          <div className="min-w-0">
            <p className="text-[0.75rem] font-medium text-slate-800 dark:text-white">MedArt AI</p>
            <p className="truncate text-[0.625rem] text-slate-400">www.medartai.com</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-3">
          <span className="text-[0.75rem] font-semibold text-blue-600 dark:text-blue-400">{tInstall("mockCancel", language)}</span>
          <Target>
            <span className="rounded-full bg-blue-600 px-3 py-1 text-[0.75rem] font-semibold text-white">{tInstall("mockInstall", language)}</span>
          </Target>
        </div>
      </div>
      <Pointer direction="up" label={tInstall("tapHere", language)} className="bottom-1.5 right-[1.15rem]" />
    </Frame>
  );
}

// ── PC / Mac ───────────────────────────────────────────────────────────────

/** The address bar of Chrome / Edge: a tab, the arrows, the field (children). */
function DesktopBar({ children }: { children: ReactNode }) {
  return (
    <div className={cn("rounded-xl", PANEL)}>
      <div className="flex items-end gap-1.5 border-b border-black/[0.06] px-2.5 pt-1.5 dark:border-white/10">
        <span className="flex items-center gap-1.5 rounded-t-lg bg-slate-100 px-2.5 py-1 dark:bg-white/10">
          <AppIcon className="h-3 w-3 rounded-[0.2rem]" />
          <span className="text-[0.625rem] font-medium text-slate-700 dark:text-neutral-200">MedArt AI</span>
        </span>
      </div>
      <div className="flex items-center gap-2 px-2.5 py-2 text-slate-400 dark:text-neutral-500">
        <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        <RotateCw className="h-3 w-3 shrink-0" />
        {children}
        <EllipsisVertical className="h-3.5 w-3.5 shrink-0" />
      </div>
    </div>
  );
}

/** Step 1: the right of the address bar, where the install icon sits. */
export function DesktopBarMockup({ language }: { language: Language }) {
  return (
    <Frame className="pb-11">
      <DesktopBar>
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-slate-100 pl-2.5 pr-1 dark:bg-white/10">
          <Lock className="h-3 w-3 shrink-0 text-slate-400" strokeWidth={2.5} />
          <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-slate-600 dark:text-neutral-300">www.medartai.com</span>
          <Target>
            <span className="flex items-center gap-1.5 px-1">
              <MonitorDown className="h-3.5 w-3.5 text-slate-700 dark:text-neutral-200" strokeWidth={2.25} />
              <Star className="h-3.5 w-3.5 text-slate-400" />
            </span>
          </Target>
        </div>
      </DesktopBar>
      <Pointer direction="up" label={tInstall("clickHere", language)} className="bottom-1.5 right-[2.85rem]" />
    </Frame>
  );
}

/** Step 2: the install icon, its tooltip « Installer MedArt AI » and the cursor on it. */
export function DesktopInstallIconMockup({ language }: { language: Language }) {
  return (
    <Frame className="pt-11">
      <span className="absolute right-[2.6rem] top-2.5 rounded-md bg-slate-800 px-2 py-1 text-[0.625rem] font-medium text-white shadow-lg dark:bg-neutral-700">
        {tInstall("mockInstallMedart", language)}
      </span>
      <div className={cn("ml-auto flex h-10 w-[78%] items-center gap-2 rounded-full pl-3 pr-2", PANEL)}>
        <span className="min-w-0 flex-1 truncate text-[0.75rem] text-slate-500 dark:text-neutral-400">medartai.com</span>
        <Target shape="circle">
          <span className="grid h-7 w-7 place-items-center">
            <MonitorDown className="h-4 w-4 text-slate-800 dark:text-white" strokeWidth={2.25} />
          </span>
        </Target>
        <Star className="h-4 w-4 shrink-0 text-slate-400" />
        <MousePointer2 className="absolute bottom-[-0.6rem] right-[2.05rem] h-5 w-5 fill-white text-slate-900 drop-shadow dark:fill-neutral-900 dark:text-white" />
      </div>
    </Frame>
  );
}

/** Step 3: the browser's confirmation, « Installer » lit up. */
export function DesktopInstallMockup({ language }: { language: Language }) {
  return (
    <Frame className="pb-11">
      <div className={cn("ml-auto w-[92%] rounded-xl p-3", PANEL)}>
        <div className="flex items-center gap-2.5">
          <AppIcon className="h-8 w-8 rounded-lg" />
          <div className="min-w-0">
            <p className="text-[0.75rem] font-semibold text-slate-800 dark:text-white">{tInstall("mockInstallQuestion", language)}</p>
            <p className="truncate text-[0.625rem] text-slate-400">MedArt AI · www.medartai.com</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="rounded-full px-3 py-1 text-[0.6875rem] font-medium text-slate-600 ring-1 ring-inset ring-black/10 dark:text-neutral-300 dark:ring-white/15">
            {tInstall("mockCancel", language)}
          </span>
          <Target>
            <span className="rounded-full bg-blue-600 px-3 py-1 text-[0.6875rem] font-semibold text-white">{tInstall("mockInstall", language)}</span>
          </Target>
        </div>
      </div>
      <Pointer direction="up" label={tInstall("clickHere", language)} className="bottom-1.5 right-[1.2rem]" />
    </Frame>
  );
}
