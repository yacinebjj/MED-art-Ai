"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { PageTransition } from "@/components/layout/PageTransition";
import { SidebarProvider } from "@/providers/SidebarProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { t } from "@/lib/translations";
import { cn } from "@/lib/utils";

// How far the student has to scroll in one direction before the mobile dock
// reacts — without this, the tiniest scroll wobble (a bounce, a sub-pixel
// jitter) would flip it visible/hidden on every frame.
const SCROLL_HIDE_THRESHOLD_PX = 12;

// Every route this layout actually renders (the full (shell) route-group
// tree — dashboard home + 6 sibling sections) maps 1:1 onto a NAV_TRANSLATIONS
// key already used by Sidebar/MobileBottomNav, so the topbar title can name
// the section the student is actually in instead of a single constant string
// everywhere — a small but real "where am I?" orientation win. Falls back to
// the original generic title for any route this map doesn't recognize, so a
// future page added under (shell) without an update here degrades gracefully
// instead of rendering a blank/wrong title.
const ROUTE_TITLE_KEYS: Record<string, Parameters<typeof t>[0]> = {
  "/dashboard": "dashboard",
  "/dashboard/assistant": "assistant",
  "/dashboard/study": "studySpace",
  "/dashboard/todo": "todo",
  "/dashboard/groups": "groups",
  "/dashboard/notes": "notes",
  "/dashboard/billing": "billing",
  "/dashboard/settings": "settings",
};

function resolvePageTitleKey(pathname: string): Parameters<typeof t>[0] | null {
  if (ROUTE_TITLE_KEYS[pathname]) return ROUTE_TITLE_KEYS[pathname];
  if (pathname.startsWith("/dashboard/groups/")) return "groups";
  return null;
}

// Only the assistant page goes full-bleed (no max-width cap, no padding
// around it) — every other page in this shell (dashboard list, billing,
// settings, notes, search) keeps the centered, padded reading-width
// treatment. Branching on pathname here, in the ONE shared layout every
// (shell) page already goes through, avoids duplicating Sidebar/Topbar
// wiring into a second layout just for this one route.
const FULL_BLEED_ROUTES = ["/dashboard/assistant"];

// Notes keeps the normal centered/padded treatment (unlike full-bleed) but
// still needs a REAL `h-full` — its note editor manages its own internal
// scroll region precisely (IDE-style: only the editor scrolls, the page
// itself never does), which requires a real height to fill rather than
// "grow to content and let <main> scroll", the default for every other
// page here.
const FIXED_HEIGHT_ROUTES = ["/dashboard/notes"];

// A group's chat room (not the /dashboard/groups lobby list itself) needs
// the same real-height treatment as Notes — ChatRoom manages its own
// internal scroll region (message list scrolls, header/input stay pinned),
// which requires a real height to fill rather than "grow to content".
// Dynamic route ([id]), so this can't just be one more literal string in
// FIXED_HEIGHT_ROUTES above (that array is checked with exact `.includes`).
function isGroupChatRoomRoute(pathname: string): boolean {
  return /^\/dashboard\/groups\/[^/]+$/.test(pathname);
}

/**
 * "Native-app" no-scroll viewport architecture: the shell's own root is a
 * fixed `h-dvh` flex box that NEVER scrolls (`overflow-hidden`) — Topbar
 * and MobileBottomNav are `flex-none`/`fixed` so they stay permanently
 * pinned to the top and bottom of the screen, and ONLY the `<main>` region
 * between them scrolls (`flex-1 overflow-y-auto`). `min-h-0` on that
 * scrolling region (and on its flex-column parent) is load-bearing, not
 * decorative: a flex child with `overflow-y-auto` silently refuses to
 * actually clip/scroll without it, since flex items default to
 * `min-height: auto` — they'd grow to fit their content and push past the
 * parent's bound instead of containing + scrolling internally.
 *
 * This is deliberately scoped to THIS shell, not the true `<html>`/`<body>`
 * — the public landing page (app/page.tsx) and /login /register are
 * long-form scrolling pages entirely outside this route group; forcing
 * `overflow: hidden` on the real `<body>` would silently break scrolling on
 * those pages for zero benefit, since full containment here already
 * guarantees the outer document never needs to scroll on shell routes.
 */
export default function DashboardShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { language } = useLanguage();
  const isFullBleed = FULL_BLEED_ROUTES.includes(pathname);
  const needsFixedHeight = isFullBleed || FIXED_HEIGHT_ROUTES.includes(pathname) || isGroupChatRoomRoute(pathname);
  const titleKey = resolvePageTitleKey(pathname);
  const pageTitle = titleKey ? t(titleKey, language) : "Espace Étudiant";

  // Frees the whole screen for reading/typing on mobile: the dock hides on a
  // deliberate downward scroll or while any input/textarea/contentEditable
  // is focused, and reappears the moment the student scrolls back up or
  // steps away from that field. Reset to visible on every route change —
  // otherwise a dock hidden by a scroll position on one page could stay
  // hidden (with no scroll to "undo") on the next page navigated to.
  const [navHidden, setNavHidden] = useState(false);
  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    setNavHidden(false);
    lastScrollTopRef.current = 0;
  }, [pathname]);

  function handleMainScroll(event: React.UIEvent<HTMLElement>) {
    const scrollTop = event.currentTarget.scrollTop;
    const delta = scrollTop - lastScrollTopRef.current;
    if (Math.abs(delta) < SCROLL_HIDE_THRESHOLD_PX) return;
    // Never hide the dock just because the page is already pinned near the
    // top — nothing to "read more of" yet, and a barely-scrollable page
    // shouldn't flicker the dock away on a tiny bounce.
    setNavHidden(delta > 0 && scrollTop > SCROLL_HIDE_THRESHOLD_PX);
    lastScrollTopRef.current = scrollTop;
  }

  useEffect(() => {
    function isTextEntryElement(el: Element | null): boolean {
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
    }
    function handleFocusIn(event: FocusEvent) {
      if (isTextEntryElement(event.target as Element | null)) setNavHidden(true);
    }
    function handleFocusOut(event: FocusEvent) {
      // relatedTarget is the element gaining focus, if any — only reveal the
      // dock again once focus actually leaves text entry entirely (tabbing
      // between two inputs should keep it hidden, not flash it back).
      if (isTextEntryElement(event.target as Element | null) && !isTextEntryElement(event.relatedTarget as Element | null)) {
        setNavHidden(false);
      }
    }
    window.addEventListener("focusin", handleFocusIn);
    window.addEventListener("focusout", handleFocusOut);
    return () => {
      window.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  return (
    <SidebarProvider>
      {/* Visually hidden until keyboard-focused: lets a keyboard/screen-reader
          user jump straight past the ~8-item sidebar into the page content
          instead of tabbing through the whole nav on every single page. */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-3 focus-visible:top-3 focus-visible:z-[100] focus-visible:rounded-xl focus-visible:bg-primary-600 focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-white focus-visible:shadow-glow"
      >
        Aller au contenu principal
      </a>
      <div className="aurora-canvas-bg relative flex h-dvh w-full overflow-hidden">
        <div aria-hidden className="aurora-mesh-bg animate-mesh-pulse pointer-events-none fixed inset-0 -z-10" />

        <div className="hidden shrink-0 lg:block lg:p-3">
          <Sidebar />
        </div>

        <div className="flex h-full min-w-0 flex-1 flex-col gap-2 p-2 sm:gap-3 sm:p-3 lg:pl-0">
          <Topbar title={pageTitle} />

          <main
            id="main-content"
            tabIndex={-1}
            onScroll={handleMainScroll}
            className={cn(
              "relative min-h-0 flex-1 overscroll-y-contain focus:outline-none",
              isFullBleed ? "overflow-hidden" : "overflow-y-auto"
            )}
          >
            <div
              className={cn(
                needsFixedHeight && "h-full",
                // Bottom clearance for the floating mobile dock (MobileBottomNav,
                // `lg:hidden`) — must extend all the way to that same `lg`
                // breakpoint (not drop early at `sm`, which used to leave a real
                // gap on tablets/landscape phones where the dock is still
                // visible but this padding had already shrunk), and must add
                // safe-area on top of the static value rather than instead of
                // it — a fixed px number alone is enough on most phones but
                // falls short on the ones with a home-indicator inset.
                !isFullBleed && "mx-auto w-full max-w-7xl px-2 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-1 sm:px-4 lg:px-8 lg:pb-6"
              )}
            >
              <PageTransition className={needsFixedHeight ? "block h-full" : undefined}>{children}</PageTransition>
            </div>
          </main>
        </div>

        <MobileBottomNav hidden={navHidden} />
      </div>
    </SidebarProvider>
  );
}
