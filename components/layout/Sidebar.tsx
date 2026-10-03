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

type NavEntry = {
  id: string;
  labelKey: CockpitKey;
  icon: LucideIcon;
  /** Literal Tailwind class for the icon tint (the JIT must see it verbatim). */
  tint?: string;
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
        // Also lit inside the course workspaces reached FROM the dashboard (module, audio).
        isActive: (p) => p === "/dashboard" || p.startsWith("/dashboard/module/") || p.startsWith("/dashboard/workspace/"),
      },
      { id: "assistant", labelKey: "navAssistant", icon: Sparkles, href: "/dashboard/assistant", tint: "text-violet-500" },
      { id: "evaluation", labelKey: "navEvaluation", icon: FileQuestion, launch: { kind: "exam" }, tint: "text-primary-500" },
    ],
  },
  {
    titleKey: "sectionLab",
    items: [
      ...LAB_TOOLS.map<NavEntry>((tool) => ({
        id: `lab-${tool.id}`,
        labelKey: `lab_${tool.id}` as CockpitKey,
        icon: tool.icon,
        tint: tool.tint.icon,
        launch: { kind: "lab", tool: tool.id },
      })),
      { id: "audio", labelKey: "navAudio", icon: Mic, href: "/dashboard/audio-workspace", tint: "text-orange-500" },
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
        isActive: (p, tab) => p === "/dashboard/study" && tab !== "session",
      },
      {
        id: "pomodoro",
        labelKey: "navPomodoro",
        icon: Timer,
        href: "/dashboard/study?tab=session",
        isActive: (p, tab) => p === "/dashboard/study" && tab === "session",
      },
      { id: "todo", labelKey: "navTodo", icon: ListTodo, href: "/dashboard/todo" },
      { id: "notes", labelKey: "navNotes", icon: NotebookPen, href: "/dashboard/notes" },
    ],
  },
  {
    titleKey: "sectionCommunity",
    items: [{ id: "groups", labelKey: "navGroups", icon: Users, href: "/dashboard/groups", isActive: (p) => p.startsWith("/dashboard/groups") }],
  },
  {
    titleKey: "sectionSystem",
    items: [
      { id: "billing", labelKey: "navBilling", icon: CreditCard, href: "/dashboard/billing" },
      { id: "settings", labelKey: "navSettings", icon: Settings, href: "/dashboard/settings" },
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

  const className = cn(
    "group relative flex w-full items-center gap-3 rounded-xl py-2 text-[13px] transition-all duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    collapsed ? "justify-center px-0" : "px-3",
    isActive
      ? "font-semibold text-primary-700 dark:text-primary-300"
      : "font-medium text-muted-foreground hover:bg-white/50 hover:text-foreground dark:hover:bg-white/5",
    !isActive && !collapsed && "hover:translate-x-0.5"
  );

  const inner = (
    <>
      {isActive && (
        <>
          <motion.span
            layoutId="sidebar-active-rail"
            className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-primary-400 to-violet-400"
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
          />
          <motion.span
            layoutId="sidebar-active-pill"
            className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary-500/15 to-violet-500/10 shadow-glow"
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
          />
        </>
      )}
      <Icon className={cn("relative z-10 h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110", !isActive && entry.tint)} />
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

          <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pb-2 [scrollbar-width:thin]" aria-label="Navigation principale">
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
