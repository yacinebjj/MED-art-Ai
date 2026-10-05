"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Brain,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  NotebookPen,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { useCockpitStore } from "@/store/useCockpitStore";
import { t } from "@/lib/translations";
import { tCockpit } from "@/lib/translations/cockpit";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { UnifiedLanguageSwitch } from "./cockpit/UnifiedLanguageSwitch";
import { THEME_MODE_ICONS, THEME_MODE_LABELS, useThemeMode, type ThemeMode } from "./cockpit/ThemeModeSwitcher";

// Short, one-word labels: five of them share ~375px, so "MedArt Assistant"
// or "Espace Étude" would wrap or truncate under the icon.
const TAB_LABELS = {
  home: { fr: "Accueil", en: "Home" },
  assistant: { fr: "Copilot", en: "Copilot" },
  study: { fr: "Réviser", en: "Review" },
  notes: { fr: "Notes", en: "Notes" },
  more: { fr: "Menu", en: "Menu" },
} satisfies Record<string, Record<Language, string>>;

interface Tab {
  href: string;
  key: keyof typeof TAB_LABELS;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
}

// The 4 places a student goes every day get a permanent thumb target. Every
// other destination lives in the Menu sheet — native iOS/Android bars stop at
// 5 items for the same reason.
const TABS: Tab[] = [
  {
    href: "/dashboard",
    key: "home",
    icon: LayoutDashboard,
    isActive: (p) => p === "/dashboard" || p.startsWith("/dashboard/module/") || p.startsWith("/dashboard/workspace/"),
  },
  { href: "/dashboard/assistant", key: "assistant", icon: Sparkles, isActive: (p) => p === "/dashboard/assistant" },
  { href: "/dashboard/study", key: "study", icon: Brain, isActive: (p) => p === "/dashboard/study" },
  { href: "/dashboard/notes", key: "notes", icon: NotebookPen, isActive: (p) => p === "/dashboard/notes" },
];

const MENU_ROUTES = ["/dashboard/billing", "/dashboard/settings", "/dashboard/todo", "/dashboard/groups"];

const MENU_ITEMS: { href: string; icon: LucideIcon; labelKey: Parameters<typeof tCockpit>[0]; tint: string }[] = [
  { href: "/dashboard/todo", icon: ListTodo, labelKey: "navTodo", tint: "from-cyan-500 to-sky-500" },
  { href: "/dashboard/groups", icon: Users, labelKey: "navGroups", tint: "from-blue-500 to-indigo-500" },
  { href: "/dashboard/billing", icon: CreditCard, labelKey: "navBilling", tint: "from-emerald-500 to-teal-500" },
  { href: "/dashboard/settings", icon: Settings, labelKey: "navSettings", tint: "from-slate-500 to-slate-600" },
];

/** Account + secondary destinations + appearance, as a bottom sheet: every row is a full-width 56px target in the thumb zone. */
function MenuSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { language } = useLanguage();
  const themeMode = useThemeMode();
  const plan = useCockpitStore((state) => state.overview?.plan ?? null);
  const initial = (profile?.fullName ?? "").trim().charAt(0).toUpperCase() || "E";

  async function handleSignOut() {
    onOpenChange(false);
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 sm:p-0">
        <div className="px-4 pb-3 pr-12 pt-7">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              {profile?.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base font-bold">{profile?.fullName || "Étudiant(e)"}</DialogTitle>
              <DialogDescription className="mt-0 truncate text-xs">
                {plan ? plan.label : profile?.email}
              </DialogDescription>
            </div>
          </div>
        </div>

        <nav className="px-2" aria-label={TAB_LABELS.more[language]}>
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                onClick={() => onOpenChange(false)}
                className="press-feedback flex min-h-14 items-center gap-3 rounded-2xl px-2 text-[15px] font-semibold text-foreground active:bg-accent"
              >
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", item.tint)}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="flex-1">{tCockpit(item.labelKey, language)}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            );
          })}
        </nav>

        <div className="mx-4 my-2 h-px bg-border" />

        <div className="space-y-3 px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">{language === "fr" ? "Langue" : "Language"}</span>
            <UnifiedLanguageSwitch />
          </div>
          <div role="radiogroup" aria-label={language === "fr" ? "Apparence" : "Appearance"} className="grid grid-cols-3 gap-2">
            {(Object.keys(THEME_MODE_LABELS) as ThemeMode[]).map((mode) => {
              const ModeIcon = THEME_MODE_ICONS[mode];
              const active = themeMode.current === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => themeMode.select(mode)}
                  className={cn(
                    "press-feedback flex h-14 flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-semibold",
                    active
                      ? "border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300"
                      : "border-border text-muted-foreground"
                  )}
                >
                  <ModeIcon className={cn("h-4 w-4", mode === "night" && "text-amber-500")} />
                  {THEME_MODE_LABELS[mode][language]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-2 pb-3 pt-1">
          <button
            type="button"
            onClick={handleSignOut}
            className="press-feedback flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 text-[15px] font-semibold text-rose-600 active:bg-rose-500/10 dark:text-rose-400"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10">
              <LogOut className="h-5 w-5" />
            </span>
            {t("signOut", language)}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Native-app-style bottom tab bar (< lg; Sidebar.tsx is desktop-only).
 * Floating pill offset above the iOS home indicator by the safe area; each
 * tab is a full flex-1 column at least 56px tall. The 5th slot opens the
 * Menu bottom sheet instead of a tiny dropdown anchored to the screen edge.
 */
export function MobileBottomNav({ hidden = false }: { hidden?: boolean }) {
  const pathname = usePathname();
  const { language } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);

  // Navigating away (from the sheet or the browser) always closes it.
  useEffect(() => setMenuOpen(false), [pathname]);

  const isMenuActive = MENU_ROUTES.some((p) => pathname.startsWith(p));

  return (
    <>
      <nav
        aria-hidden={hidden}
        aria-label="Navigation"
        className={cn(
          "glass-panel shadow-glass dark:shadow-glass-dark fixed inset-x-3 bottom-3 z-40 flex items-stretch justify-around rounded-[1.75rem] px-1 lg:hidden",
          "motion-safe:transition-[transform,opacity] motion-safe:duration-200 motion-safe:ease-out",
          hidden ? "pointer-events-none translate-y-[calc(100%+4rem)] opacity-0" : "translate-y-0 opacity-100"
        )}
        // A floating pill takes the safe area as its OFFSET, not as internal
        // padding (which would stretch the pill itself by ~34px under the
        // home indicator).
        style={{
          bottom: "max(0.75rem, env(safe-area-inset-bottom))",
          left: "max(0.75rem, env(safe-area-inset-left))",
          right: "max(0.75rem, env(safe-area-inset-right))",
        }}
      >
        {TABS.map((tab) => {
          const isActive = tab.isActive(pathname);
          return (
            <TabButton key={tab.href} icon={tab.icon} label={TAB_LABELS[tab.key][language]} active={isActive} href={tab.href} />
          );
        })}
        <TabButton
          icon={Menu}
          label={TAB_LABELS.more[language]}
          active={isMenuActive || menuOpen}
          onClick={() => {
            haptic();
            setMenuOpen(true);
          }}
        />
      </nav>
      <MenuSheet open={menuOpen} onOpenChange={setMenuOpen} />
    </>
  );
}

function TabButton({
  icon: Icon,
  label,
  active,
  href,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const className =
    "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-3xl py-2 text-[11px] font-medium transition-transform duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const inner = (
    <>
      {active && (
        <motion.span
          layoutId="bottom-nav-active-pill"
          className="absolute inset-1 rounded-[1.4rem] bg-primary-500/15 dark:bg-primary-400/15"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
      <Icon className={cn("relative z-10 h-[22px] w-[22px]", active ? "text-primary-600 dark:text-primary-300" : "text-muted-foreground")} strokeWidth={active ? 2.4 : 2} />
      <span className={cn("relative z-10 leading-none", active ? "font-bold text-primary-700 dark:text-primary-300" : "text-muted-foreground")}>{label}</span>
    </>
  );
  if (href) {
    return (
      <Link href={href} prefetch aria-current={active ? "page" : undefined} onClick={() => haptic(6)} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog" className={className}>
      {inner}
    </button>
  );
}
