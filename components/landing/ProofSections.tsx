"use client";

import { Check, GraduationCap, Languages, Lock, ShieldCheck, Smartphone, Wallet, X } from "lucide-react";
import { useLanguage } from "@/providers/LanguageProvider";
import { GlassPanel, GradientText, Reveal, SectionHeading } from "./primitives";

/** The original "avantage injuste" comparison, sharpened and extended. */
const COMPARISON = [
  { old: { fr: "Des heures à relire des PDF", en: "Hours re-reading PDFs" }, now: { fr: "Une explication limpide générée en quelques instants", en: "A crystal-clear explanation generated in moments" } },
  { old: { fr: "QCM génériques trouvés en ligne", en: "Generic MCQs found online" }, now: { fr: "40+ QCM tirés de TES cours, corrigés en détail", en: "40+ MCQs from YOUR courses, corrected in detail" } },
  { old: { fr: "Notes éparpillées entre plusieurs apps", en: "Notes scattered across apps" }, now: { fr: "Tout centralisé, rangé par module officiel", en: "Everything centralized, filed by official module" } },
  { old: { fr: "Réviser seul, perdu dans les groupes WhatsApp", en: "Revising alone, lost in WhatsApp groups" }, now: { fr: "Groupes d'étude temps réel : sondages, fichiers, mentions", en: "Real-time study groups: polls, files, mentions" } },
  { old: { fr: "Aucune idée de ce qu'il reste à revoir", en: "No idea what's left to review" }, now: { fr: "Progression, série et compte à rebours d'examen", en: "Progress, streak and exam countdown" } },
];

export function ComparisonSection() {
  const { language } = useLanguage();
  const fr = language === "fr";
  return (
    <section className="relative px-4 py-24 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow={fr ? "L'avantage injuste" : "The unfair advantage"}
        title={
          fr ? (
            <>
              L&apos;étude traditionnelle <span className="text-slate-500">contre</span> <GradientText>MedArt AI</GradientText>
            </>
          ) : (
            <>
              Traditional study <span className="text-slate-500">vs</span> <GradientText>MedArt AI</GradientText>
            </>
          )
        }
      />
      <Reveal delay={0.1} className="mx-auto mt-14 max-w-5xl">
        <GlassPanel className="grid gap-2 p-2 sm:grid-cols-2 sm:gap-3 sm:p-3">
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-5 sm:p-6">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.18em] text-rose-400">{fr ? "Avant" : "Before"}</p>
            <ul className="space-y-3.5">
              {COMPARISON.map((row) => (
                <li key={row.old.fr} className="flex items-start gap-2.5 text-sm text-slate-400">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                  <span className="line-through decoration-rose-500/40">{row.old[language]}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] p-5 shadow-[0_0_50px_-15px_rgba(16,185,129,0.5)] sm:p-6">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">{fr ? "Avec MedArt AI" : "With MedArt AI"}</p>
            <ul className="space-y-3.5">
              {COMPARISON.map((row, i) => (
                <Reveal key={row.now.fr} delay={0.08 * i} y={8}>
                  <li className="flex items-start gap-2.5 text-sm font-semibold text-white">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-slate-950">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    {row.now[language]}
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
        </GlassPanel>
      </Reveal>
    </section>
  );
}

/**
 * Social proof, VERIFIABLE only — product facts a student can check on day
 * one. Deliberately no invented testimonials or user counts.
 */
const PROOFS = [
  {
    icon: GraduationCap,
    fr: { t: "Médecine, Pharmacie, Dentaire", d: "Ton programme officiel, année par année, unités d'enseignement et modules." },
    en: { t: "Medicine, Pharmacy, Dentistry", d: "Your official curriculum, year by year, teaching units and modules." },
  },
  {
    icon: Lock,
    fr: { t: "Tes cours restent à toi", d: "Tes documents ne sont visibles que par toi ; les groupes sont privés, sur invitation." },
    en: { t: "Your courses stay yours", d: "Your documents are visible to you only; groups are private and invite-only." },
  },
  {
    icon: Wallet,
    fr: { t: "Paiement 100 % local", d: "Edahabia ou CIB, en dinars, via Chargily. Aucune carte internationale requise." },
    en: { t: "100% local payment", d: "Edahabia or CIB, in dinars, through Chargily. No international card needed." },
  },
  {
    icon: Languages,
    fr: { t: "Français, English, Darija", d: "Interface et contenus IA en FR ou EN ; podcasts aussi en darija algérienne." },
    en: { t: "French, English, Darija", d: "Interface and AI content in FR or EN; podcasts in Algerian Darija too." },
  },
  {
    icon: Smartphone,
    fr: { t: "Installable comme une app", d: "Sur Android, iPhone et PC, directement depuis le navigateur." },
    en: { t: "Installable like an app", d: "On Android, iPhone and PC, straight from the browser." },
  },
  {
    icon: ShieldCheck,
    fr: { t: "Fidèle à ton cours", d: "L'IA travaille sur TON polycopié — pas sur des sources inconnues d'Internet." },
    en: { t: "Faithful to your course", d: "The AI works on YOUR handout — not on unknown internet sources." },
  },
];

export function ProofSection() {
  const { language } = useLanguage();
  const fr = language === "fr";
  return (
    <section className="relative px-4 py-24 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow={fr ? "Pourquoi nous faire confiance" : "Why trust us"}
        title={
          fr ? (
            <>
              Construit pour <GradientText>l&apos;étudiant en santé algérien.</GradientText>
            </>
          ) : (
            <>
              Built for <GradientText>Algerian health students.</GradientText>
            </>
          )
        }
      />
      <div className="mx-auto mt-14 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROOFS.map((proof, i) => (
          <Reveal key={proof.fr.t} delay={Math.min(i * 0.06, 0.3)}>
            <div className="group h-full rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-cyan-400/30 hover:shadow-[0_20px_60px_-30px_rgba(34,211,238,0.6)]">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/25 to-violet-500/20 text-cyan-200 transition-transform duration-300 group-hover:scale-110">
                <proof.icon className="h-5 w-5" />
              </span>
              <p className="mt-4 text-base font-extrabold text-white">{proof[language].t}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{proof[language].d}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
