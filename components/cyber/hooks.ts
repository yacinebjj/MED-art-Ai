"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Desktop with a precise pointer and motion allowed — the only place tilt / magnetic effects run. */
function canRunPointerEffects(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: fine) and (min-width: 768px)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Reactive "rich effects allowed" flag: false on phones / tablets / touch
 * screens and under prefers-reduced-motion. Starts false (SSR + first paint),
 * so heavy decoration only ever mounts after hydration on a capable desktop.
 */
export function useRichEffects(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine) and (min-width: 768px)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(fine.matches && !reduce.matches);
    update();
    fine.addEventListener("change", update);
    reduce.addEventListener("change", update);
    return () => {
      fine.removeEventListener("change", update);
      reduce.removeEventListener("change", update);
    };
  }, []);
  return enabled;
}

/**
 * 3D micro-tilt + cursor reflection, written straight to CSS custom
 * properties inside one requestAnimationFrame — zero React re-renders while
 * the pointer moves. No-op on touch devices / reduced motion. Pair with the
 * `.cyber-tilt` (and optionally `.cyber-reflect`) classes from cyber.css.
 */
export function useCyberTilt<T extends HTMLElement>(maxDeg = 4) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !canRunPointerEffects()) return;
    let frame = 0;

    function handleMove(event: PointerEvent) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.dataset.tilting = "true";
        el.style.setProperty("--cyber-ry", `${((px - 0.5) * 2 * maxDeg).toFixed(2)}deg`);
        el.style.setProperty("--cyber-rx", `${((0.5 - py) * 2 * maxDeg).toFixed(2)}deg`);
        el.style.setProperty("--cyber-mx", `${(px * 100).toFixed(1)}%`);
        el.style.setProperty("--cyber-my", `${(py * 100).toFixed(1)}%`);
        el.style.setProperty("--cyber-reflect", "1");
      });
    }

    function handleLeave() {
      if (!el) return;
      cancelAnimationFrame(frame);
      el.dataset.tilting = "false";
      el.style.setProperty("--cyber-rx", "0deg");
      el.style.setProperty("--cyber-ry", "0deg");
      el.style.setProperty("--cyber-reflect", "0");
    }

    el.addEventListener("pointermove", handleMove);
    el.addEventListener("pointerleave", handleLeave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", handleMove);
      el.removeEventListener("pointerleave", handleLeave);
    };
  }, [maxDeg]);

  return ref;
}

/** Magnetic pull towards the cursor (desktop only) — pair with `.cyber-magnetic`. */
export function useMagnetic<T extends HTMLElement>(strength = 0.25) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !canRunPointerEffects()) return;
    let frame = 0;

    function handleMove(event: PointerEvent) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty("--cyber-tx", `${(dx * strength).toFixed(1)}px`);
        el.style.setProperty("--cyber-ty", `${(dy * strength).toFixed(1)}px`);
      });
    }

    function handleLeave() {
      if (!el) return;
      cancelAnimationFrame(frame);
      el.style.setProperty("--cyber-tx", "0px");
      el.style.setProperty("--cyber-ty", "0px");
    }

    el.addEventListener("pointermove", handleMove);
    el.addEventListener("pointerleave", handleLeave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", handleMove);
      el.removeEventListener("pointerleave", handleLeave);
    };
  }, [strength]);

  return ref;
}

/** A counter to re-key one-shot effects (particle bursts) — `fire()` restarts the animation. */
export function useBurst(): [number, () => void] {
  const [nonce, setNonce] = useState(0);
  const fire = useCallback(() => setNonce((n) => n + 1), []);
  return [nonce, fire];
}

/** localStorage-backed UI preference (view mode, ambience…). Never data — purely a per-device convenience. */
export function useStoredPreference<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored && (allowed as readonly string[]).includes(stored)) setValue(stored as T);
    } catch {
      // Storage blocked — keep the default.
    }
    // `allowed` is a static list per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Best-effort.
      }
    },
    [key]
  );

  return [value, update];
}
