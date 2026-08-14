"use client";

/**
 * Desktop sidebar collapse state — distinct from Sidebar.tsx's existing
 * `open`/`onClose` props, which only ever controlled the MOBILE slide-in
 * overlay (hamburger menu, < lg breakpoint). There was no "collapse on
 * desktop" concept before this. A context is required, not local state
 * inside the assistant page, because the toggle button lives in
 * app/dashboard/(shell)/assistant/page.tsx while the <Sidebar> it needs to
 * affect is rendered by the ANCESTOR app/dashboard/(shell)/layout.tsx — a
 * page component cannot reach a sibling rendered by its own parent without
 * either lifting state to a shared ancestor (this) or prop-drilling through
 * `children`, which Next.js layouts don't support for this shape.
 */

import { createContext, useContext, useState } from "react";

interface SidebarContextValue {
  isDesktopSidebarOpen: boolean;
  setIsDesktopSidebarOpen: (open: boolean) => void;
  toggleDesktopSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);

  const value: SidebarContextValue = {
    isDesktopSidebarOpen,
    setIsDesktopSidebarOpen,
    toggleDesktopSidebar: () => setIsDesktopSidebarOpen((prev) => !prev),
  };

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

/** Safe outside the (shell) route group too — returns a permanently-open, no-op fallback instead of throwing, since Sidebar.tsx itself doesn't render outside (shell) but shares no code path with pages that would call this. */
export function useSidebarState(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    return { isDesktopSidebarOpen: true, setIsDesktopSidebarOpen: () => {}, toggleDesktopSidebar: () => {} };
  }
  return ctx;
}
