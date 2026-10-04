"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Brain,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Cloud,
  CloudOff,
  CreditCard,
  FileQuestion,
  Infinity as InfinityIcon,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  LogOut,
  Mic,
  NotebookPen,
  Settings,
  Sparkles,
  Timer,
  Users,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import { Logo } from "./Logo";
import { AnimatedBrandMark } from "./AnimatedBrandMark";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import { useSidebarState } from "@/providers/SidebarProvider";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { useCockpitStore } from "@/store/useCockpitStore";
import { useCockpitUi, type LauncherTarget } from "@/store/useCockpitUi";
import { LAB_TOOLS } from "@/lib/workspace-lab";
import { t } from "@/lib/translations";
import { tCockpit, type CockpitKey } from "@/lib/translations/cockpit";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";

/**
 * One vibrant identity per feature. Every class is a literal so the Tailwind
 * JIT sees it: icon = glyph color, tile = the 3D icon chip, glow = hover/active
 * aura, active = the row tint + rail + label color when the route is current.
 */
interface NavHue {
  icon: string;
  tile: string;
  glow: string;
  activeGlow: string;
  activeRow: string;
  rail: string;
  activeText: string;
}

const HUES = {
  teal: {
    icon: "text-teal-600 dark:text-teal-400",
    tile: "from-teal-400/25 to-teal-600/10 ring-teal-500/25",
    glow: "group-hover:drop-shadow-[0_0_12px_rgba(20,184,166,0.65)]",
    activeGlow: "drop-shadow-[0_0_12px_rgba(20,184,166,0.65)]",
    activeRow: "bg-teal-500/[0.12] dark:bg-teal-400/[0.12]",
    rail: "bg-teal-400",
    activeText: "text-teal-700 dark:text-teal-300",
  },
  fuchsia: {
    icon: "text-fuchsia-600 dark:text-fuchsia-400",
    tile: "from-fuchsia-400/25 to-fuchsia-600/10 ring-fuchsia-500/25",
    glow: "group-hover:drop-shadow-[0_0_12px_rgba(217,70,239,0.65)]",
    activeGlow: "drop-shadow-[0_0_12px_rgba(217,70,239,0.65)]",
    activeRow: "bg-fuchsia-500/[0.12] dark:bg-fuchsia-400/[0.12]",
    rail: "bg-fuchsia-400",
    activeText: "text-fuchsia-700 dark:text-fuchsia-300",
  },
  orange: {
    icon: "text-orange-600 dark:text-orange-400",
    tile: "from-orange-400/25 to-orange-600/10 ring-orange-500/25",
    glow: "group-hover:drop-shadow-[0_0_12px_rgba(249,115,22,0.65)]",
    activeGlow: "drop-shadow-[0_0_12px_rgba(249,115,22,0.65)]",
    activeRow: "bg-orange-500/[0.12] dark:bg-orange-400/[0.12]",
    rail: "bg-orange-400",
    activeText: "text-orange-700 dark:text-orange-300",
  },
  lime: {
    icon: "text-lime-600 dark:text-lime-400",
    tile: "from-lime-400/25 to-lime-600/10 ring-lime-500/25",
    glow: "group-hover:drop-shadow-[0_0_12px_rgba(132,204,22,0.65)]",
    activeGlow: "drop-shadow-[0_0_12px_rgba(132,204,22,0.65)]",
    activeRow: "bg-lime-500/[0.12] dark:bg-lime-400/[0.12]",
    rail: "bg-lime-400",
    activeText: "text-lime-700 dark:text-lime-300",
  },
  emerald: {
    icon: "text-emerald-600 dark:text-emerald-400",
    tile: "from-emerald-400/25 to-emerald-600/10 ring-emerald-500/25",
    glow: "group-hover:drop-shadow-[0_0_12px_rgba(16,185,129,0.65)]",
    activeGlow: "drop-shadow-[0_0_12px_rgba(16,185,129,0.65)]",
    activeRow: "bg-emerald-500/[0.12] dark:bg-emerald-400/[0.12]",
    rail: "bg-emerald-400",
    activeText: "text-emerald-700 dark:text-emerald-300",
  },
  purple: {
    icon: "text-purple-600 dark:text-purple-400",
    tile: "from-purple-400/25 to-purple-600/10 ring-purple-500/25",
    glow: "group-hover:drop-shadow-[0_0_12px_rgba(139,92,246,0.65)]",
    activeGlow: "drop-shadow-[0_0_12px_rgba(139,92,246,0.65)]",
    activeRow: "bg-purple-500/[0.12] dark:bg-purple-400/[0.12]",
    rail: "bg-purple-400",
    activeText: "text-purple-700 dark:text-purple-300",
  },
  rose: {
    icon: "text-rose-600 dark:text-rose-400",
    tile: "from-rose-400/25 to-rose-600/10 ring-rose-500/25",
    glow: "group-hover:drop-shadow-[0_0_12px_rgba(244,63,94,0.65)]",
    activeGlow: "drop-shadow-[0_0_12px_rgba(244,63,94,0.65)]",
    activeRow: "bg-rose-500/[0.12] dark:bg-rose-400/[0.12]",
    rail: "bg-rose-400",
    activeText: "text-rose-700 dark:text-rose-300",
  },
  amber: {
    icon: "text-amber-600 dark:text-amber-400",
    tile: "from-amber-400/25 to-amber-600/10 ring-amber-500/25",
    glow: "group-hover:drop-shadow-[0_0_12px_rgba(245,158,11,0.65)]",
    activeGlow: "drop-shadow-[0_0_12px_rgba(245,158,11,0.65)]",
    activeRow: "bg-amber-500/[0.12] dark:bg-amber-400/[0.12]",
    rail: "bg-amber-400",
    activeText: "text-amber-700 dark:text-amber-300",
  },
  red: {
    icon: "text-red-600 dark:text-red-400",
    tile: "from-red-400/25 to-red-600/10 ring-red-500/25",
    glow: "group-hover:drop-shadow-[0_0_12px_rgba(239,68,68,0.65)]",
    activeGlow: "drop-shadow-[0_0_12px_rgba(239,68,68,0.65)]",
    activeRow: "bg-red-500/[0.12] dark:bg-red-400/[0.12]",
    rail: "bg-red-400",
    activeText: "text-red-700 dark:text-red-300",
  },
  cyan: {
    icon: "text-cyan-600 dark:text-cyan-400",
    tile: "from-cyan-400/25 to-cyan-600/10 ring-cyan-500/25",
    glow: "group-hover:drop-shadow-[0_0_12px_rgba(6,182,212,0.65)]",
    activeGlow: "drop-shadow-[0_0_12px_rgba(6,182,212,0.65)]",
    activeRow: "bg-cyan-500/[0.12] dark:bg-cyan-400/[0.12]",
    rail: "bg-cyan-400",
    activeText: "text-cyan-700 dark:text-cyan-300",
  },
  indigo: {
    icon: "text-indigo-600 dark:text-indigo-400",
    tile: "from-indigo-400/25 to-indigo-600/10 ring-indigo-500/25",
    glow: "group-hover:drop-shadow-[0_0_12px_rgba(99,102,241,0.65)]",
    activeGlow: "drop-shadow-[0_0_12px_rgba(99,102,241,0.65)]",
    activeRow: "bg-indigo-500/[0.12] dark:bg-indigo-400/[0.12]",
    rail: "bg-indigo-400",
    activeText: "text-indigo-700 dark:text-indigo-300",
  },
  blue: {
    icon: "text-blue-600 dark:text-blue-400",
    tile: "from-blue-400/25 to-blue-600/10 ring-blue-500/25",
    glow: "group-hover:drop-shadow-[0_0_12px_rgba(59,130,246,0.65)]",
    activeGlow: "drop-shadow-[0_0_12px_rgba(59,130,246,0.65)]",
    activeRow: "bg-blue-500/[0.12] dark:bg-blue-400/[0.12]",
    rail: "bg-blue-400",
    activeText: "text-blue-700 dark:text-blue-300",
  },
  slate: {
    icon: "text-slate-500 dark:text-slate-400",
    tile: "from-slate-300/30 to-slate-500/10 ring-slate-400/30",
    glow: "group-hover:drop-shadow-[0_0_12px_rgba(148,163,184,0.7)]",
    activeGlow: "drop-shadow-[0_0_12px_rgba(148,163,184,0.7)]",
    activeRow: "bg-slate-500/[0.12] dark:bg-slate-400/[0.12]",
    rail: "bg-slate-400",
    activeText: "text-slate-700 dark:text-slate-200",
  },
} satisfies Record<string, NavHue>;

type HueName = keyof typeof HUES;

/** Lab tools get their sidebar identity here (LAB_TOOLS' own tints serve the Studio cards). */
const LAB_HUES: Record<string, HueName> = { "case-simulator": "lime", matrix: "emerald", mindmap: "purple" };

type NavEntry = {
  id: string;
  labelKey: CockpitKey;
  icon: LucideIcon;
  hue: HueName;
} & ({ href: string; isActive?: (pathname: string, tab: string | null) => boolean } | { launch: LauncherTarget });

interface NavSection {
  titleKey: CockpitKey;
  items: NavEntry[];
}

const SECTIONS: NavSection[] = [
  {
    titleKey: "sectionCockpit",
    items: [
      {
        id: "dashboard",
        labelKey: "navDashboard",
        icon: LayoutDashboard,
        href: "/dashboard",
        hue: "teal",
        // Also lit inside the course workspaces reached FROM the dashboard (module, audio).
        isActive: (p) => p === "/dashboard" || p.startsWith("/dashboard/module/") || p.startsWith("/dashboard/workspace/"),
      },
      { id: "assistant", labelKey: "navAssistant", icon: Sparkles, href: "/dashboard/assistant", hue: "fuchsia" },
      { id: "evaluation", labelKey: "navEvaluation", icon: FileQuestion, launch: { kind: "exam" }, hue: "orange" },
    ],
  },
  {
    titleKey: "sectionLab",
    items: [
      ...LAB_TOOLS.map<NavEntry>((tool) => ({
        id: `lab-${tool.id}`,
        labelKey: `lab_${tool.id}` as CockpitKey,
        icon: tool.icon,
        hue: LAB_HUES[tool.id] ?? "slate",
        launch: { kind: "lab", tool: tool.id },
      })),
      { id: "audio", labelKey: "navAudio", icon: Mic, href: "/dashboard/audio-workspace", hue: "rose" },
    ],
  },
  {
    titleKey: "sectionRevision",
    items: [
      {
        id: "flashcards",
        labelKey: "navFlashcards",
        icon: Brain,
        href: "/dashboard/study?tab=flashcards",
        hue: "amber",
        isActive: (p, tab) => p === "/dashboard/study" && tab !== "session",
      },
      {
        id: "pomodoro",
        labelKey: "navPomodoro",
        icon: Timer,
        href: "/dashboard/study?tab=session",
        hue: "red",
        isActive: (p, tab) => p === "/dashboard/study" && tab === "session",
      },
      { id: "todo", labelKey: "navTodo", icon: ListTodo, href: "/dashboard/todo", hue: "cyan" },
      { id: "notes", labelKey: "navNotes", icon: NotebookPen, href: "/dashboard/notes", hue: "indigo" },
    ],
  },
  {
    titleKey: "sectionCommunity",
    items: [{ id: "groups", labelKey: "navGroups", icon: Users, href: "/dashboard/groups", hue: "blue", isActive: (p) => p.startsWith("/dashboard/groups") }],
  },
  {
    titleKey: "sectionSystem",
    items: [
      { id: "billing", labelKey: "navBilling", icon: CreditCard, href: "/dashboard/billing", hue: "emerald" },
      { id: "settings", labelKey: "navSettings", icon: Settings, href: "/dashboard/settings", hue: "slate" },
    ],
  },
];

function NavSections({ collapsed, pathname, tab, language }: { collapsed: boolean; pathname: string; tab: string | null; language: Language }) {
  return (
    <>
      {SECTIONS.map((section) => (
        <div key={section.titleKey}>
          {collapsed ? (
            <div aria-hidden className="mx-auto mb-1.5 h-px w-6 bg-border/70" />
          ) : (
            <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/80">{tCockpit(section.titleKey, language)}</p>
          )}
          <div className="space-y-0.5">
            {section.items.map((entry) => (
              <NavRow key={entry.id} entry={entry} collapsed={collapsed} pathname={pathname} tab={tab} language={language} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** Reads ?tab= (Flashcards vs Pomodoro highlight). Behind Suspense: useSearchParams in a shared layout would otherwise opt every page out of static rendering. */
function NavSectionsWithTab(props: { collapsed: boolean; pathname: string; language: Language }) {
  const tab = useSearchParams().get("tab");
  return <NavSections {...props} tab={tab} />;
}

function NavRow({ entry, collapsed, pathname, tab, language }: { entry: NavEntry; collapsed: boolean; pathname: string; tab: string | null; language: Language }) {
  const openLauncher = useCockpitUi((state) => state.openLauncher);
  const label = tCockpit(entry.labelKey, language);
  const Icon = entry.icon;
  const isActive = "href" in entry ? (entry.isActive ? entry.isActive(pathname, tab) : pathname === entry.href) : false;
  const hue = HUES[entry.hue];

  const className = cn(
    "group relative flex w-full items-center gap-3 rounded-xl py-1.5 text-[13px] transition-all duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    collapsed ? "justify-center px-0" : "px-2.5",
    isActive
      ? cn("font-semibold", hue.activeText)
      : "font-medium text-muted-foreground hover:bg-white/50 hover:text-foreground dark:hover:bg-white/5",
    !isActive && !collapsed && "hover:translate-x-0.5"
  );

  const inner = (
    <>
      {isActive && (
        <>
          <motion.span layoutId="sidebar-active-pill" className={cn("absolute inset-0 rounded-xl", hue.activeRow)} transition={{ type: "spring", stiffness: 500, damping: 40 }} />
          {/* 4px accent rail in the feature's own color — the "border-l-4" of the active route. */}
          <motion.span
            layoutId="sidebar-active-rail"
            className={cn("absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full shadow-[0_0_10px_currentColor]", hue.rail, hue.activeText)}
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
          />
        </>
      )}
      {/* 3D icon chip: gradient body + inner top highlight + ring, lifted/tilted on hover with a colored aura. */}
      <span
        className={cn(
          "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br ring-1 ring-inset",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_10px_-4px_rgba(0,0,0,0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_6px_14px_-6px_rgba(0,0,0,0.8)]",
          "transition-all duration-300 ease-out will-change-transform group-hover:-translate-y-0.5 group-hover:rotate-3 group-hover:scale-[1.15] motion-reduce:transform-none",
          hue.tile,
          hue.glow,
          isActive && cn("scale-105", hue.activeGlow)
        )}
      >
        <Icon className={cn("h-[17px] w-[17px]", hue.icon)} strokeWidth={2.2} />
      </span>
      {!collapsed && <span className="relative z-10 truncate">{label}</span>}
    </>
  );

  const control =
    "href" in entry ? (
      <Link href={entry.href} prefetch aria-current={isActive ? "page" : undefined} aria-label={collapsed ? label : undefined} className={className}>
        {inner}
      </Link>
    ) : (
      <button type="button" onClick={() => openLauncher(entry.launch)} aria-label={collapsed ? label : undefined} className={className}>
        {inner}
      </button>
    );

  if (!collapsed) return control;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Monthly AI-generation quota (subscriptions.generations_used vs the effective plan's cap). */
function QuotaGauge({ collapsed, language }: { collapsed: boolean; language: Language }) {
  const plan = useCockpitStore((state) => state.overview?.plan ?? null);
  if (!plan) {
    return collapsed ? null : <div className="h-[58px] animate-pulse rounded-xl bg-white/30 dark:bg-white/5" />;
  }
  const unlimited = plan.unlimitedThisPeriod;
  const pct = unlimited || plan.generationsCap <= 0 ? 0 : Math.min(100, Math.round((plan.generationsUsed / plan.generationsCap) * 100));
  const remaining = Math.max(0, plan.generationsCap - plan.generationsUsed);
  const tone = pct >= 90 ? "from-rose-500 to-orange-500" : pct >= 70 ? "from-amber-500 to-orange-400" : "from-primary-500 to-violet-500";

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href="/dashboard/billing" className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/50 dark:hover:bg-white/5" aria-label={tCockpit("quotaTitle", language)}>
            <svg viewBox="0 0 36 36" className="h-8 w-8 -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none" strokeWidth="4" className="stroke-muted" />
              <circle cx="18" cy="18" r="15" fill="none" strokeWidth="4" strokeLinecap="round" className={pct >= 90 ? "stroke-rose-500" : "stroke-primary-500"} strokeDasharray={`${unlimited ? 94 : (pct / 100) * 94} 94`} />
            </svg>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          {unlimited ? tCockpit("quotaUnlimited", language) : tCockpit("quotaRemaining", language).replace("{n}", String(remaining)).replace("{cap}", String(plan.generationsCap))}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link href="/dashboard/billing" className="block rounded-xl border border-white/30 bg-white/30 p-2.5 transition-colors hover:bg-white/50 dark:border-white/5 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]">
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-foreground">{tCockpit("quotaTitle", language)}</span>
        <span className="font-medium text-muted-foreground">{plan.label}</span>
      </div>
      {unlimited ? (
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <InfinityIcon className="h-3.5 w-3.5" />
          {tCockpit("quotaUnlimited", language)}
        </p>
      ) : (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div className={cn("h-full rounded-full bg-gradient-to-r", tone)} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {tCockpit("quotaUsed", language).replace("{used}", String(plan.generationsUsed)).replace("{cap}", String(plan.generationsCap))}
          </p>
        </>
      )}
    </Link>
  );
}

/** Real sync state of the dashboard data (last successful /api/dashboard/overview, online/offline). Click = sync now. */
function SyncStatus({ collapsed, language }: { collapsed: boolean; language: Language }) {
  const status = useCockpitStore((state) => state.status);
  const lastSyncedAt = useCockpitStore((state) => state.lastSyncedAt);
  const refresh = useCockpitStore((state) => state.refresh);

  const Icon = status === "offline" ? CloudOff : status === "syncing" ? LoaderCircle : Cloud;
  const tone = status === "offline" ? "text-slate-400" : status === "error" ? "text-amber-500" : "text-emerald-500";
  const label =
    status === "offline"
      ? tCockpit("syncOffline", language)
      : status === "syncing"
        ? tCockpit("syncing", language)
        : status === "error"
          ? tCockpit("syncError", language)
          : lastSyncedAt
            ? tCockpit("syncedAt", language).replace("{time}", new Date(lastSyncedAt).toLocaleTimeString(language === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" }))
            : tCockpit("syncIdle", language);

  const button = (
    <button
      type="button"
      onClick={() => void refresh({ force: true })}
      aria-label={label}
      className={cn(
        "flex items-center gap-2 rounded-lg py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground",
        collapsed ? "mx-auto justify-center px-2" : "w-full px-2"
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", tone, status === "syncing" && "animate-spin")} />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * "Medical Cockpit 3.0" — desktop-only floating glass sidebar (lg+); mobile
 * uses MobileBottomNav. Thematic sections (Cockpit / Lab / Révision /
 * Communauté / Système), an icon-only rail mode remembered per device, and
 * live widgets at the bottom (AI quota, data sync). Lab tools and the
 * evaluation entry open the course/module picker (LabLauncher), since they
 * work on a specific course.
 */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { isDesktopSidebarOpen, isRailCollapsed, toggleRail } = useSidebarState();
  const { language } = useLanguage();
  const initial = (profile?.fullName ?? "").trim().charAt(0).toUpperCase() || "E";
  const collapsed = isRailCollapsed;

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  const width = collapsed ? "w-[4.5rem]" : "w-64";

  return (
    <aside className={cn("hidden h-full shrink-0 transition-[width] duration-300 ease-out lg:block", isDesktopSidebarOpen ? width : "w-0")}>
      <div className={cn("h-full overflow-hidden transition-[width,opacity] duration-300 ease-out", width, !isDesktopSidebarOpen && "opacity-0")}>
        <div className={cn("glass-panel shadow-glass dark:shadow-glass-dark flex h-full flex-col rounded-3xl transition-[width] duration-300 ease-out", width)}>
          <div className={cn("flex shrink-0 items-center", collapsed ? "h-20 justify-center" : "h-24 px-5")}>
            {collapsed ? <AnimatedBrandMark size="sm" /> : <Logo size="lg" />}
          </div>

          <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pb-2 [scrollbar-color:rgba(100,116,139,0.35)_transparent] [scrollbar-width:thin]" aria-label="Navigation principale">
            <Suspense fallback={<NavSections collapsed={collapsed} pathname={pathname} tab={null} language={language} />}>
              <NavSectionsWithTab collapsed={collapsed} pathname={pathname} language={language} />
            </Suspense>
          </nav>

          <div className="shrink-0 space-y-1.5 border-t border-white/20 p-3 dark:border-white/5">
            <QuotaGauge collapsed={collapsed} language={language} />
            <SyncStatus collapsed={collapsed} language={language} />

            <div className={cn("flex items-center gap-1", collapsed && "flex-col")}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    "flex min-w-0 items-center gap-2.5 rounded-xl p-1.5 text-left transition-colors hover:bg-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5",
                    collapsed ? "justify-center" : "flex-1"
                  )}
                >
                  <Avatar className="h-8 w-8">
                    {profile?.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
                    <AvatarFallback>{initial}</AvatarFallback>
                  </Avatar>
                  {!collapsed && (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-foreground">{profile?.fullName || "Étudiant(e)"}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{profile?.email}</p>
                      </div>
                      <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </>
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel className="truncate">{profile?.fullName || profile?.email || "Étudiant(e)"}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/settings">
                      <Settings className="h-4 w-4" />
                      {t("settings", language)}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleSignOut}>
                    <LogOut className="h-4 w-4" />
                    {t("signOut", language)}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleRail}
                    aria-label={collapsed ? tCockpit("expandSidebar", language) : tCockpit("collapseSidebar", language)}
                    aria-expanded={!collapsed}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-white/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5"
                  >
                    {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{collapsed ? tCockpit("expandSidebar", language) : tCockpit("collapseSidebar", language)}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
