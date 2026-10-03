"use client";

import { createContext, useContext, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Logo } from "@/components/layout/Logo";
import { CursorGlow, ParticleField, TiltCard } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";

const AuthShellContext = createContext(false);

/** True inside the persistent auth shell (app/(auth)/layout.tsx) — AuthLayout then renders only its header + form. */
export function useInAuthShell(): boolean {
  return useContext(AuthShellContext);
}

/** Keeps only a ring the width of the element's padding (content-box XOR border-box). */
const RING_MASK_STYLE: CSSProperties = {
  WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
  WebkitMaskComposite: "xor",
  mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
  maskComposite: "exclude",
};

const TABS = [
  { href: "/login", fr: "Connexion", en: "Log in" },
  { href: "/register", fr: "Inscription", en: "Sign up" },
];

/**
 * Persistent "Cyber-Medical" shell for /login, /register, /forgot-password
 * (mounted ONCE by app/(auth)/layout.tsx, so switching Connexion ⇄
 * Inscription is a client transition: the background, logo and card frame
 * stay put; only the form inside changes and the card resizes smoothly).
 *
 * Performance budget, mobile first:
 *  - no WebGL here (the 3D DNA scene is gone from the auth pages);
 *  - background = static CSS glows + one small canvas particle field
 *    (34 points on phones, paused off-screen / in background tabs);
 *  - backdrop-blur ONLY from md: up — blurring over an animated canvas
 *    re-composites the whole card every frame, the classic mobile-GPU killer;
 *  - the laser border is a CSS transform rotation (compositor only),
 *    disabled under prefers-reduced-motion; tilt and cursor light are
 *    desktop-pointer only.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { language } = useLanguage();
  const reduce = useReducedMotion();
  const showTabs = pathname === "/login" || pathname === "/register";
  // The first page renders VISIBLE in the server HTML (no opacity:0 waiting for JS — on a slow
  // phone that read as a frozen blank card); only later Connexion ⇄ Inscription switches animate.
  const firstPathname = useRef(pathname);
  const animateSwap = !reduce && pathname !== firstPathname.current;

  // Always dark here: also reaches portaled UI (Select dropdowns, toasts) mounted on <body>.
  // Restores the student's own theme on the way out.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    const previousScheme = root.style.colorScheme;
    root.classList.add("dark");
    root.style.colorScheme = "dark";
    return () => {
      if (!hadDark) root.classList.remove("dark");
      root.style.colorScheme = previousScheme;
    };
  }, []);

  return (
    <AuthShellContext.Provider value>
      <div className="relative isolate flex min-h-dvh w-full flex-col items-center overflow-x-hidden bg-slate-950 px-4 pb-10 pt-6 text-slate-100 sm:justify-center sm:px-6 sm:py-10">
        <style>{"html,body{background:#020617}"}</style>
        {/* Background — static layers + one light particle canvas. */}
        <div aria-hidden className="fixed inset-0 -z-20 bg-[radial-gradient(ellipse_at_top,#0b1b33_0%,#020617_60%,#01030a_100%)]" />
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-cyan-500/[0.12] blur-[120px]" />
          <div className="absolute -bottom-40 -right-32 h-[30rem] w-[30rem] rounded-full bg-violet-600/[0.12] blur-[120px]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.045)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_70%)]" />
          <div className="absolute inset-0 opacity-70">
            <ParticleField />
          </div>
        </div>
        <CursorGlow />

        <div className="w-full max-w-md">
          <div className="mb-6 flex justify-center sm:mb-8">
            <Link href="/" className="inline-flex transition-transform duration-300 hover:-translate-y-0.5 active:scale-95" aria-label="MedArt AI — accueil">
              <Logo size="lg" />
            </Link>
          </div>

          {showTabs && (
            <div className="mx-auto mb-5 flex w-full max-w-xs rounded-2xl border border-white/10 bg-white/[0.04] p-1" role="tablist">
              {TABS.map((tab) => {
                const active = pathname === tab.href;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    prefetch
                    role="tab"
                    aria-selected={active}
                    className={cn("relative flex-1 rounded-xl py-2 text-center text-sm font-bold transition-colors", active ? "text-slate-950" : "text-slate-400 hover:text-white")}
                  >
                    {active && (
                      <motion.span
                        layoutId="auth-tab-pill"
                        className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 shadow-[0_0_20px_rgba(34,211,238,0.45)]"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative">{tab[language]}</span>
                  </Link>
                );
              })}
            </div>
          )}

          <TiltCard max={5} glare={false} className="rounded-[1.75rem]">
            <motion.div layout={!reduce} transition={{ type: "spring", stiffness: 260, damping: 30 }} className="relative rounded-[1.75rem]">
              <div className="relative rounded-[1.75rem] border border-white/[0.06] bg-slate-950/[0.92] p-6 shadow-[0_30px_90px_-30px_rgba(34,211,238,0.35)] sm:p-8 md:bg-slate-950/60 md:backdrop-blur-2xl">
                <motion.div key={pathname} initial={animateSwap ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
                  {children}
                </motion.div>
              </div>
              {/* Laser border: a rotating conic gradient clipped to a 1.5px ring (mask), drawn above the card. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.75rem] p-[1.5px]"
                // Inline and in this order: the `mask` shorthand resets mask-composite, so it must come first.
                style={RING_MASK_STYLE}
              >
                <span className="absolute left-1/2 top-1/2 aspect-square w-[220%] -translate-x-1/2 -translate-y-1/2">
                  <span className="block h-full w-full bg-[conic-gradient(from_0deg,transparent_0deg,rgba(34,211,238,0.95)_40deg,transparent_95deg,transparent_180deg,rgba(139,92,246,0.9)_220deg,transparent_275deg)] motion-safe:animate-[spin_5s_linear_infinite]" />
                </span>
              </span>
            </motion.div>
          </TiltCard>

          <p className="mt-8 text-center text-xs text-slate-500">© {new Date().getFullYear()} Med Art AI — Médecine · Pharmacie · Chirurgie Dentaire</p>
        </div>
      </div>
    </AuthShellContext.Provider>
  );
}
