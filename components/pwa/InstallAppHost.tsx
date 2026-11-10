"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { setInstallGuideOpen, useInstallState } from "@/lib/pwa-install";

const loadInstallAppModal = () => import("@/components/pwa/InstallAppModal").then((module) => module.InstallAppModal);
const InstallAppModal = dynamic(loadInstallAppModal, { ssr: false });

/**
 * Mounts the install guide (components/pwa/InstallAppModal.tsx) the first time
 * it is opened, on any page — rendered by the service-worker registration in
 * the root layout — then keeps it mounted so it closes with its animation. Its
 * code is fetched on its own, warmed while a dashboard page is idle, so the
 * first tap on « Installer l'application » opens it at once.
 */
export function InstallAppHost() {
  const { guideOpen, installed } = useInstallState();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (guideOpen) setMounted(true);
  }, [guideOpen]);

  useEffect(() => {
    if (installed || !window.location.pathname.startsWith("/dashboard")) return;
    const warm = () => void loadInstallAppModal();
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(warm, 2500);
    return () => window.clearTimeout(timer);
  }, [installed]);

  if (!mounted && !guideOpen) return null;
  return <InstallAppModal open={guideOpen} onOpenChange={setInstallGuideOpen} />;
}
