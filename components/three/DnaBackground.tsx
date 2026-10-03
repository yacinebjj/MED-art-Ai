"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

/**
 * Ambient 3D DNA background — a FEATHERWEIGHT wrapper. It imports nothing
 * from three.js: the WebGL scene (three.js + R3F + drei + the 812 KB model)
 * lives in ./DnaScene and is only downloaded when this wrapper decides the
 * device can afford it. See DnaScene's header for the full performance story.
 */
const DnaScene = dynamic(() => import("./DnaScene"), { ssr: false, loading: () => null });

type NavigatorWithHints = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

/** WebGL only where it's cheap: desktop-class pointer and hardware, motion allowed, no data saver. */
function shouldRenderWebGL(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as NavigatorWithHints;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768) return false;
  if (nav.connection?.saveData) return false;
  if ((nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4) return false;
  try {
    const probe = document.createElement("canvas");
    if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return false;
  } catch {
    return false;
  }
  return true;
}

export function DnaBackground({ opacityClassName }: { opacityClassName?: string }) {
  // Decided after mount (never during render, so no hydration mismatch) and
  // only once the main thread is idle — never competes with first paint.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!shouldRenderWebGL()) return;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setEnabled(true), { timeout: 2500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setEnabled(true), 1200);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div
      aria-hidden
      className={cn(
        // z-0, not a negative z-index — see the stacking note in git history:
        // a negative z-index here painted behind the opaque <body> background.
        "pointer-events-none fixed inset-0 z-0 h-screen w-screen",
        opacityClassName ?? "opacity-40 dark:opacity-25",
      )}
    >
      {enabled ? (
        <DnaScene />
      ) : (
        // GPU-free stand-in: one static soft glow, no animation, no WebGL, no download.
        <div className="h-full w-full bg-[radial-gradient(ellipse_at_70%_30%,rgba(45,212,191,0.12),transparent_60%)]" />
      )}
    </div>
  );
}
