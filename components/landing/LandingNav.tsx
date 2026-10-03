"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";

const LINKS = [
  { href: "#arsenal", fr: "Fonctionnalités", en: "Features" },
  { href: "#simulateur", fr: "Comment ça marche", en: "How it works" },
  { href: "#groupes", fr: "Groupes d'étude", en: "Study groups" },
  { href: "#tarifs", fr: "Tarifs", en: "Pricing" },
  { href: "#faq", fr: "FAQ", en: "FAQ" },
];

/** Glass navbar: hides while scrolling down, comes back on scroll up; solidifies after the hero. */
export function LandingNav() {
  const { language, setLanguage } = useLanguage();
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);

  useMotionValueEvent(scrollY, "change", (latest) => {
    const previous = scrollY.getPrevious() ?? 0;
    setHidden(latest > previous && latest > 240 && !open);
    setSolid(latest > 24);
  });

  return (
    <motion.header
      animate={{ y: hidden ? "-110%" : "0%" }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5"
    >
      <div
        className={cn(
          "mx-auto flex h-16 max-w-7xl items-center justify-between rounded-2xl border px-3 transition-all duration-300 sm:px-5",
          solid ? "border-white/10 bg-slate-950/70 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.8)] backdrop-blur-xl" : "border-transparent bg-transparent"
        )}
      >
        <Link href="/" aria-label="MedArt AI">
          <Logo size="md" />
        </Link>
        <nav className="hidden items-center gap-1 lg:flex">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} className="rounded-xl px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white">
              {link[language]}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLanguage(language === "fr" ? "en" : "fr")}
            className="hidden rounded-xl border border-white/10 px-2.5 py-1.5 text-xs font-bold text-slate-300 transition-colors hover:text-white sm:block"
            aria-label={language === "fr" ? "Switch to English" : "Passer en français"}
          >
            {language === "fr" ? "EN" : "FR"}
          </button>
          <Link href="/login" className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:text-white sm:block">
            {language === "fr" ? "Connexion" : "Log in"}
          </Link>
          <Link
            href="/register"
            className="group hidden items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-2 text-sm font-bold text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.45)] transition-shadow hover:shadow-[0_0_36px_rgba(34,211,238,0.7)] sm:inline-flex"
          >
            {language === "fr" ? "Commencer" : "Get started"}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white hover:bg-white/10 lg:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mx-auto mt-2 flex max-w-7xl flex-col gap-1 rounded-2xl border border-white/10 bg-slate-950/90 p-3 backdrop-blur-xl lg:hidden"
          >
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setOpen(false)} className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-200 hover:bg-white/5">
                {link[language]}
              </a>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Link href="/login" className="rounded-xl border border-white/10 px-3 py-2.5 text-center text-sm font-semibold text-white">
                {language === "fr" ? "Connexion" : "Log in"}
              </Link>
              <Link href="/register" className="rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-3 py-2.5 text-center text-sm font-bold text-slate-950">
                {language === "fr" ? "Commencer" : "Get started"}
              </Link>
            </div>
            <button type="button" onClick={() => setLanguage(language === "fr" ? "en" : "fr")} className="mt-1 rounded-xl px-3 py-2 text-left text-xs font-bold text-slate-400">
              {language === "fr" ? "English version" : "Version française"}
            </button>
          </motion.nav>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
