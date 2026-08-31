"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAuth } from "@/lib/translations/auth";

/**
 * Auth layout, shared by /login and /register — a single, full-screen,
 * centered experience. NOT a split-screen: the marketing journey lives
 * entirely on app/page.tsx now (hero, features, product mockups,
 * comparison — see that file), and this layout intentionally has none of
 * that content. Just the brand mark, a themed ambient background, and the
 * centered glassmorphic form card.
 *
 * This replaced an earlier version that DID have a left-side marketing
 * panel (headline, step timeline, comparison card, doctor-3d.png
 * illustration) — removed entirely per explicit direction that the
 * marketing journey and the auth flow be 100% separate. `doctor-3d.png` has
 * no code references left anywhere after this change (still on disk,
 * unreferenced, left alone — it's a user-provided asset, not one to delete
 * without being asked).
 */
export function AuthLayout({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: "login" | "register";
}) {
  const { language } = useLanguage();
  const title = tAuth(variant === "login" ? "loginTitle" : "registerTitle", language);
  const subtitle = tAuth(variant === "login" ? "loginSubtitle" : "registerSubtitle", language);

  return (
    // items-start on mobile, only centering vertically from sm: up — a
    // vertically-centered flex column whose content overflows the viewport
    // (RegisterForm's tall stack of fields on a short phone screen) can
    // otherwise render with part of its top scrolled above the reachable
    // area, since a "center" alignment splits any overflow across both
    // edges instead of anchoring the start. Anchoring to the top on the
    // narrowest viewports removes that risk entirely; sm:items-center keeps
    // the polished centered look once there's reliably enough height.
    <div className="relative flex min-h-dvh w-full items-start justify-center overflow-x-hidden overflow-y-auto bg-background px-4 py-10 sm:items-center sm:px-6">
      {/* Ambient background — a soft radial-ish glow pair, theme-aware via
          the oklch tokens (light mode: a faint teal wash; dark mode: the
          real dark --background with the same glows at lower opacity). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-primary-50 via-white to-white dark:from-primary-950/20 dark:via-background dark:to-background"
      />
      <div aria-hidden className="pointer-events-none absolute -left-32 top-0 -z-10 h-96 w-96 rounded-full bg-primary-400/20 blur-3xl dark:bg-primary-500/10" />
      <div aria-hidden className="pointer-events-none absolute -right-24 bottom-0 -z-10 h-96 w-96 rounded-full bg-cyan-400/20 blur-3xl dark:bg-cyan-500/10" />

      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
        <div className="mb-8 flex justify-center">
          <Link href="/" className="inline-flex transition-transform duration-300 hover:-translate-y-0.5 active:scale-95">
            <Logo size="lg" />
          </Link>
        </div>

        {/* Glassmorphic card — backdrop-blur-xl + a soft glowing gradient
            border behind it. LoginForm/RegisterForm render unchanged as
            `children`; no auth logic touched here at all. */}
        <div className="relative">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-1 rounded-[2rem] bg-gradient-to-br from-primary-400/30 via-cyan-400/20 to-emerald-400/30 blur-xl"
          />
          <div className="glass-card shadow-glass dark:shadow-glass-dark relative rounded-3xl border border-white/20 p-6 backdrop-blur-xl sm:p-8">
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>

            <div className="mt-8">{children}</div>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Med Art AI — Médecine · Pharmacie · Chirurgie Dentaire
        </p>
      </motion.div>
    </div>
  );
}
