"use client";

import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { useLanguage } from "@/providers/LanguageProvider";

/** Footer with the giant neon "MedArt AI" signature. */
export function LandingFooter() {
  const { language } = useLanguage();
  const fr = language === "fr";
  const columns = [
    {
      title: fr ? "Produit" : "Product",
      links: [
        { href: "#arsenal", label: fr ? "Fonctionnalités" : "Features" },
        { href: "#simulateur", label: fr ? "Comment ça marche" : "How it works" },
        { href: "#groupes", label: fr ? "Groupes d'étude" : "Study groups" },
        { href: "/pricing", label: fr ? "Tarifs" : "Pricing" },
      ],
    },
    {
      title: fr ? "Compte" : "Account",
      links: [
        { href: "/register", label: fr ? "Créer un compte" : "Sign up" },
        { href: "/login", label: fr ? "Connexion" : "Log in" },
        { href: "/forgot-password", label: fr ? "Mot de passe oublié" : "Forgot password" },
      ],
    },
  ];

  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-slate-950">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />
      <div className="mx-auto max-w-7xl px-5 pb-6 pt-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo size="md" />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
              {fr
                ? "Le système d'exploitation médical des étudiants en Médecine, Pharmacie et Chirurgie dentaire en Algérie."
                : "The medical operating system for Medicine, Pharmacy and Dentistry students in Algeria."}
            </p>
          </div>
          {columns.map((column) => (
            <div key={column.title}>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{column.title}</p>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-slate-300 transition-colors hover:text-cyan-300">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p
          aria-hidden
          className="pointer-events-none mt-14 select-none bg-gradient-to-b from-cyan-200/40 via-cyan-400/15 to-transparent bg-clip-text text-center text-[18vw] font-black leading-none tracking-tighter text-transparent [text-shadow:0_0_80px_rgba(34,211,238,0.25)] sm:text-[15vw] xl:text-[12rem]"
        >
          MedArt AI
        </p>

        <div className="mt-2 flex flex-col items-center justify-between gap-3 border-t border-white/5 pt-6 text-xs text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} Med Art AI</p>
          <p>{fr ? "Fait en Algérie, pour les étudiants en santé." : "Made in Algeria, for health students."}</p>
        </div>
      </div>
    </footer>
  );
}
