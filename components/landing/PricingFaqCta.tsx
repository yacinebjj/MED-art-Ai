"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { FREE_TRIAL, GROUP_SIZE, PAID_LIMITS, PLANS, POOL_DEADLINE_DAYS, PROMO_SIZE, REFUND_DELAY_LABEL, formatDZD, getPlansForCycle, type BillingCycle } from "@/lib/pricing";
import { BillingCycleToggle } from "@/components/pricing/BillingCycleToggle";
import { PricingTierCard, PromoMonthlyOnlyCard } from "@/components/pricing/PricingTierCard";
import { useLanguage } from "@/providers/LanguageProvider";
import { AUDIO_SMART_NOTES_ENABLED } from "@/lib/feature-flags";
import { GradientText, MagneticLink, ParticleField, Reveal, SectionHeading } from "./primitives";

export function PricingSection() {
  const { language } = useLanguage();
  const fr = language === "fr";
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const plans = getPlansForCycle(cycle);
  return (
    <section id="tarifs" className="relative scroll-mt-24 px-4 py-24 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow={fr ? "Tarifs" : "Pricing"}
        title={
          fr ? (
            <>
              Des tarifs pensés <GradientText>pour les étudiants.</GradientText>
            </>
          ) : (
            <>
              Pricing built <GradientText>for students.</GradientText>
            </>
          )
        }
        subtitle={
          fr
            ? `Seul, à ${GROUP_SIZE} amis ou à ${PROMO_SIZE} avec ta promo. Commence avec ${FREE_TRIAL.courses} cours + ${FREE_TRIAL.messages} messages offerts, une seule fois — plus vous êtes nombreux, moins c'est cher par personne.`
            : `Alone, with ${GROUP_SIZE} friends or ${PROMO_SIZE} from your class. Start with ${FREE_TRIAL.courses} course + ${FREE_TRIAL.messages} free messages, one time only — the more of you, the cheaper it is per person.`
        }
      />
      <Reveal delay={0.1} className="mt-10 flex justify-center">
        <BillingCycleToggle value={cycle} onChange={setCycle} />
      </Reveal>
      <div className="mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
        {!plans.some((plan) => plan.tier === "promo") && (
          <Reveal delay={0.2} className="relative order-last h-full">
            <PromoMonthlyOnlyCard onShowMonthly={() => setCycle("monthly")} />
          </Reveal>
        )}
        {plans.map((plan, index) => (
          <Reveal key={plan.tier} delay={index * 0.1} className={cn("relative h-full", plan.featured && "lg:-translate-y-4")}>
            {plan.featured && (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute -inset-[2px] rounded-[1.6rem] bg-[conic-gradient(from_var(--angle),#22d3ee,#8b5cf6,#10b981,#22d3ee)] opacity-80 blur-[3px]"
                animate={{ ["--angle" as string]: ["0deg", "360deg"] }}
                transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                style={{ ["--angle" as string]: "0deg" }}
              />
            )}
            <div className="relative h-full">
              <PricingTierCard
                plan={plan}
                ctaSlot={
                  <Link
                    href="/register"
                    className={cn(
                      "mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all",
                      plan.featured
                        ? "bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 shadow-[0_0_30px_rgba(34,211,238,0.45)] hover:shadow-[0_0_45px_rgba(34,211,238,0.7)]"
                        : "border border-white/15 text-white hover:bg-white/5"
                    )}
                  >
                    {fr ? "Commencer" : "Get started"}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                }
              />
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.2} className="mx-auto mt-10 max-w-3xl">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-sm text-slate-300 sm:flex-row sm:justify-between">
          <p>
            <span className="font-bold text-white">{fr ? "Essai gratuit" : "Free trial"}</span> —{" "}
            {fr
              ? `${FREE_TRIAL.courses} cours avec le Studio complet + ${FREE_TRIAL.messages} messages Assistant / Copilot, une seule fois, sans carte bancaire.`
              : `${FREE_TRIAL.courses} course with the full Studio + ${FREE_TRIAL.messages} Assistant / Copilot messages, one time only, no card needed.`}
          </p>
          <Link href="/register" className="shrink-0 font-semibold text-cyan-300 hover:underline">
            {fr ? "Créer mon compte" : "Create my account"}
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

const FAQ = [
  {
    fr: {
      q: "Est-ce vraiment gratuit pour commencer ?",
      a: `Oui. Chaque compte reçoit, une seule fois et sans carte bancaire, ${FREE_TRIAL.courses} cours avec le Studio complet + ${FREE_TRIAL.messages} messages avec l'Assistant / Copilot. Ensuite, les formules payantes donnent ${PAID_LIMITS.coursesPerMonth} cours, ${PAID_LIMITS.examsPerMonth} examens et ${PAID_LIMITS.synthesesPerMonth} résumés de module par mois, ${PAID_LIMITS.premiumMessagesPerDay} messages/jour avec l'IA premium (puis le modèle standard, jamais bloqué)${AUDIO_SMART_NOTES_ENABLED ? `, Audio → Smart Notes ${PAID_LIMITS.audioPerDay}/jour` : ""}, et Flashcards / To-Do / Notes illimités.`,
    },
    en: {
      q: "Is it really free to start?",
      a: `Yes. Every account gets, one time only and with no card, ${FREE_TRIAL.courses} course with the full Studio + ${FREE_TRIAL.messages} Assistant / Copilot messages. Paid plans then give ${PAID_LIMITS.coursesPerMonth} courses, ${PAID_LIMITS.examsPerMonth} exams and ${PAID_LIMITS.synthesesPerMonth} module summaries a month, ${PAID_LIMITS.premiumMessagesPerDay} premium-AI messages a day (then the standard model, never blocked)${AUDIO_SMART_NOTES_ENABLED ? `, Audio → Smart Notes ${PAID_LIMITS.audioPerDay}/day` : ""}, and unlimited Flashcards / To-Do / Notes.`,
    },
  },
  {
    fr: {
      q: "Comment marchent les formules Groupe et Promo Cohorte ?",
      a: `Groupe : exactement ${GROUP_SIZE} personnes à ${formatDZD(PLANS.group_monthly.priceDZD)} par personne et par mois. Une personne peut payer les ${GROUP_SIZE} places d'un coup (activation immédiate), ou chacun paie sa part et l'abonnement démarre dès ${GROUP_SIZE}/${GROUP_SIZE}. Promo Cohorte : exactement ${PROMO_SIZE} étudiants de la même promo, ${formatDZD(PLANS.promo_monthly.priceDZD)} par personne pour 1 mois. Si la jauge n'est pas pleine en ${POOL_DEADLINE_DAYS} jours, le remboursement est déclenché automatiquement et reçu sous ${REFUND_DELAY_LABEL}.`,
    },
    en: {
      q: "How do the Group and Cohort plans work?",
      a: `Group: exactly ${GROUP_SIZE} people at ${formatDZD(PLANS.group_monthly.priceDZD)} per person per month. One person can pay all ${GROUP_SIZE} seats at once (active right away), or everyone pays their share and the plan starts at ${GROUP_SIZE}/${GROUP_SIZE}. Cohort: exactly ${PROMO_SIZE} students from the same class, ${formatDZD(PLANS.promo_monthly.priceDZD)} per person for 1 month. If the gauge is not full within ${POOL_DEADLINE_DAYS} days, a refund is requested automatically and received within 5 business days.`,
    },
  },
  {
    fr: { q: "Quels documents puis-je importer ?", a: "PDF, Word, PowerPoint, images de cours (lues par OCR) et fichiers Google Drive. Tu les ranges dans les modules de ton programme officiel." },
    en: { q: "Which documents can I import?", a: "PDF, Word, PowerPoint, course images (read by OCR) and Google Drive files. You file them under the modules of your official curriculum." },
  },
  {
    fr: { q: "Le contenu généré est-il fiable ?", a: "L'IA travaille sur TON cours, pas sur Internet : explications, QCM et cas cliniques restent fidèles à ton polycopié. Comme pour tout outil, garde ton esprit critique et vérifie ce qui te paraît douteux." },
    en: { q: "Is the generated content reliable?", a: "The AI works on YOUR course, not the internet: explanations, MCQs and cases stay faithful to your handout. As with any tool, keep a critical mind and double-check anything that looks off." },
  },
  {
    fr: { q: "Comment fonctionnent les groupes d'étude ?", a: "Crée un groupe, partage son code ou son lien : chaque demande est validée par l'admin. Messages en temps réel, sondages, documents, vocaux, mentions et réactions — dans un espace privé." },
    en: { q: "How do study groups work?", a: "Create a group, share its code or link: the admin approves every request. Real-time messages, polls, documents, voice notes, mentions and reactions — in a private space." },
  },
  {
    fr: {
      q: "Comment payer ?",
      a: `En dinars, par carte Edahabia ou CIB via Chargily, en une fois pour la durée choisie (aucun prélèvement automatique). Individuel : ${formatDZD(PLANS.individual_monthly.priceDZD)}/mois, ${formatDZD(PLANS.individual_quad.priceDZD)} les 4 mois, ${formatDZD(PLANS.individual_annual.priceDZD)} l'année. Groupe : ${formatDZD(PLANS.group_monthly.priceDZD)} par personne et par mois. Promo Cohorte : ${formatDZD(PLANS.promo_monthly.priceDZD)} par personne, 1 mois uniquement.`,
    },
    en: {
      q: "How do I pay?",
      a: `In dinars, by Edahabia or CIB card through Chargily, once for the length you pick (no automatic charges). Individual: ${formatDZD(PLANS.individual_monthly.priceDZD)}/month, ${formatDZD(PLANS.individual_quad.priceDZD)} for 4 months, ${formatDZD(PLANS.individual_annual.priceDZD)} a year. Group: ${formatDZD(PLANS.group_monthly.priceDZD)} per person per month. Cohort: ${formatDZD(PLANS.promo_monthly.priceDZD)} per person, 1 month only.`,
    },
  },
  {
    fr: { q: "Ça marche sur mon téléphone ?", a: "Oui : MedArt AI s'installe comme une application sur Android, iPhone et PC directement depuis le navigateur, et toute l'interface est pensée pour le mobile." },
    en: { q: "Does it work on my phone?", a: "Yes: MedArt AI installs like an app on Android, iPhone and PC straight from the browser, and the whole interface is designed for mobile." },
  },
];

export function FaqSection() {
  const { language } = useLanguage();
  const fr = language === "fr";
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="relative scroll-mt-24 px-4 py-24 sm:px-6 lg:px-8">
      <SectionHeading eyebrow="FAQ" title={fr ? "Les questions qu'on nous pose." : "Questions we get asked."} />
      <div className="mx-auto mt-12 max-w-3xl space-y-3">
        {FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            <Reveal key={item.fr.q} delay={Math.min(i * 0.05, 0.25)}>
              <div className={cn("overflow-hidden rounded-2xl border transition-colors", isOpen ? "border-cyan-400/30 bg-cyan-400/[0.04]" : "border-white/10 bg-white/[0.02]")}>
                <button type="button" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen} className="flex w-full items-center gap-4 px-5 py-4 text-left">
                  <span className="flex-1 text-base font-bold text-white">{item[language].q}</span>
                  <motion.span animate={{ rotate: isOpen ? 45 : 0 }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-cyan-300">
                    <Plus className="h-4 w-4" />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
                      <p className="px-5 pb-5 text-sm leading-relaxed text-slate-300">{item[language].a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

export function FinalCta() {
  const { language } = useLanguage();
  const fr = language === "fr";
  return (
    <section className="relative px-4 pb-24 pt-8 sm:px-6 lg:px-8">
      <Reveal className="mx-auto max-w-6xl">
        <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-gradient-to-br from-cyan-600/30 via-blue-700/30 to-violet-700/30 px-6 py-16 text-center sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute inset-0 opacity-70">
            <ParticleField />
          </div>
          <div aria-hidden className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-cyan-400/25 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-violet-500/25 blur-3xl" />
          <h2 className="relative text-balance text-4xl font-black tracking-tight text-white sm:text-6xl">
            {fr ? "Aborde tes examens avec certitude." : "Face your exams with certainty."}
          </h2>
          <p className="relative mx-auto mt-5 max-w-xl text-base text-slate-200 sm:text-lg">
            {fr
              ? "Importe ton premier cours aujourd'hui. Dans quelques instants, tu révises avec l'efficacité que tes études méritent."
              : "Import your first course today. Within moments, you'll revise with the efficiency your studies deserve."}
          </p>
          <div className="relative mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <MagneticLink
              href="/register"
              className="group inline-flex items-center gap-2 rounded-2xl bg-white px-8 py-4 text-base font-black text-slate-950 shadow-[0_0_50px_rgba(255,255,255,0.35)] transition-shadow hover:shadow-[0_0_70px_rgba(255,255,255,0.55)]"
            >
              {fr ? "Créer mon compte étudiant" : "Create my student account"}
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </MagneticLink>
          </div>
          <ul className="relative mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-300">
            {(fr
              ? [`${FREE_TRIAL.courses} cours + ${FREE_TRIAL.messages} messages offerts, une seule fois`, "Sans carte bancaire", "Paiement Edahabia / CIB"]
              : [`${FREE_TRIAL.courses} course + ${FREE_TRIAL.messages} messages free, one time only`, "No card required", "Edahabia / CIB payment"]
            ).map((item) => (
              <li key={item} className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-300" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </section>
  );
}
