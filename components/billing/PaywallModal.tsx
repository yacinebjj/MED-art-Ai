"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { ArrowLeft, CalendarClock, Check, GraduationCap, Info, Lock, Sparkles, User, Users, UsersRound, X } from "lucide-react";
import type { PaywallReason, UsageSnapshot } from "@/lib/subscription";
import { FREE_TRIAL, GROUP_SIZE, PAID_LIMITS, PLANS, PROMO_SIZE, formatDZD } from "@/lib/pricing";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/** What the modal shows: a server paywall reason, or the hard lock once the whole trial is used. */
export type PaywallView = PaywallReason | "trial_exhausted";

export function isTrialView(view: PaywallView): boolean {
  return view === "trial_exhausted" || view.startsWith("trial_");
}

interface PaywallModalProps {
  view: PaywallView | null;
  usage: UsageSnapshot | null;
  /** Hard lock: no way out except the billing page. */
  locked: boolean;
  onChoosePlan: () => void;
  /** Trial (non-locked) variants: discreet way back to the dashboard. */
  onBackToCourse: () => void;
  /** Quota variants only (dismissible). */
  onClose: () => void;
}

function formatResetDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

const TRIAL_PLANS = [
  {
    icon: User,
    name: PLANS.individual_monthly.label,
    price: formatDZD(PLANS.individual_monthly.priceDZD),
    unit: "/mois",
    detail: "Pour toi seul, à ton rythme",
  },
  {
    icon: Users,
    name: PLANS.group_monthly.label,
    price: formatDZD(PLANS.group_monthly.priceDZD),
    unit: "/pers./mois",
    detail: `Exactement ${GROUP_SIZE} amis`,
    featured: true,
  },
  {
    icon: UsersRound,
    name: PLANS.promo_monthly.label,
    price: formatDZD(PLANS.promo_monthly.priceDZD),
    unit: "/pers.",
    detail: `Exactement ${PROMO_SIZE} étudiants · 1 mois`,
  },
] as const;

interface QuotaCopy {
  title: string;
  body: string;
  rule: string;
  reset: string;
}

function quotaCopy(view: PaywallReason, usage: UsageSnapshot | null): QuotaCopy {
  const monthReset = formatResetDate(usage?.monthResetsAt ?? usage?.periodEnd ?? null);
  const monthly = monthReset ? `Ton compteur se recharge le ${monthReset}.` : "Ton compteur se recharge au début de ton prochain mois d'abonnement.";
  switch (view) {
    case "quota_courses":
      return {
        title: "Limite du mois atteinte",
        body: `Tu as importé tes ${usage?.courses.cap ?? PAID_LIMITS.coursesPerMonth} cours de ce mois-ci. Tes cours déjà importés restent disponibles.`,
        rule: "Un cours supprimé ne rend pas le crédit.",
        reset: monthly,
      };
    case "quota_exams":
      return {
        title: "Limite du mois atteinte",
        body: `Tu as généré tes ${usage?.exams.cap ?? PAID_LIMITS.examsPerMonth} examens de ce mois-ci. Tes examens déjà générés restent disponibles.`,
        rule: "Un examen supprimé ne rend pas le crédit.",
        reset: monthly,
      };
    case "quota_syntheses":
      return {
        title: "Limite du mois atteinte",
        body: `Tu as utilisé tes ${usage?.syntheses.cap ?? PAID_LIMITS.synthesesPerMonth} résumés de module de ce mois-ci. Ce qui a déjà été généré reste disponible.`,
        rule: "Chaque génération — Résumé, Mots-clés ou Dictionnaire — utilise 1 résumé.",
        reset: monthly,
      };
    case "quota_audio_daily":
      return {
        title: "Limite du jour atteinte",
        body: `Audio → Smart Notes : ${usage?.audio.capPerDay ?? PAID_LIMITS.audioPerDay} audio par jour. Tu as déjà utilisé celui d'aujourd'hui.`,
        rule: `Tu as droit à ${PAID_LIMITS.audioPerDay} audio par jour et ${PAID_LIMITS.audioPerMonth} par mois.`,
        reset: "Reviens demain : ton audio du jour sera de nouveau disponible.",
      };
    case "quota_audio_monthly":
      return {
        title: "Limite du mois atteinte",
        body: `Tu as utilisé tes ${usage?.audio.capPerMonth ?? PAID_LIMITS.audioPerMonth} audios Smart Notes de ce mois-ci.`,
        rule: `Tu as droit à ${PAID_LIMITS.audioPerDay} audio par jour et ${PAID_LIMITS.audioPerMonth} par mois.`,
        reset: monthly,
      };
    default:
      return { title: "Limite atteinte", body: "Tu as atteint une limite de ta formule.", rule: "", reset: monthly };
  }
}

function TrialContent({ view, usage, locked, onChoosePlan, onBackToCourse }: { view: PaywallView; usage: UsageSnapshot | null; locked: boolean; onChoosePlan: () => void; onBackToCourse: () => void }) {
  const isFeature = view === "trial_feature";
  const coursesUsed = Math.min(usage?.courses.used ?? FREE_TRIAL.courses, FREE_TRIAL.courses);
  const messagesUsed = Math.min(usage?.messages.used ?? FREE_TRIAL.messages, FREE_TRIAL.messages);

  const title = isFeature ? "Une fonction des formules payantes ✨" : "Ton essai gratuit est terminé 🎓";
  const intro = isFeature
    ? "Les examens, résumés de module et Audio → Smart Notes font partie des formules payantes."
    : view === "trial_courses"
      ? "Tu as déjà importé ton cours gratuit. Pour importer d'autres cours, choisis ta formule."
      : view === "trial_messages"
        ? "Tu as utilisé tes 20 messages gratuits avec l'Assistant et le Copilot."
        : "Bravo, tu as bien profité de ton essai ! Pour continuer à réviser, choisis ta formule.";

  return (
    <>
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
          {isFeature ? <Sparkles className="h-8 w-8" /> : <GraduationCap className="h-8 w-8" />}
          {locked && (
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-card text-muted-foreground ring-1 ring-border">
              <Lock className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
        <DialogPrimitive.Title className="text-balance text-xl font-bold leading-tight text-foreground sm:text-2xl">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-2 text-balance text-sm leading-relaxed text-muted-foreground">{intro}</DialogPrimitive.Description>
      </div>

      {!isFeature && (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-center">
            <p className="text-lg font-bold tabular-nums text-foreground">
              {coursesUsed}/{FREE_TRIAL.courses}
            </p>
            <p className="text-xs text-muted-foreground">cours gratuit</p>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-center">
            <p className="text-lg font-bold tabular-nums text-foreground">
              {messagesUsed}/{FREE_TRIAL.messages}
            </p>
            <p className="text-xs text-muted-foreground">messages gratuits</p>
          </div>
        </div>
      )}

      <div className="mt-5 space-y-2">
        {TRIAL_PLANS.map((plan) => {
          const Icon = plan.icon;
          return (
            <div
              key={plan.name}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-2.5",
                "featured" in plan && plan.featured ? "border-primary/40 bg-primary/5" : "border-border bg-card"
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{plan.name}</p>
                <p className="truncate text-xs text-muted-foreground">{plan.detail}</p>
              </div>
              <p className="shrink-0 text-right text-sm font-bold tabular-nums text-foreground">
                {plan.price}
                <span className="block text-[11px] font-normal text-muted-foreground">{plan.unit}</span>
              </p>
            </div>
          );
        })}
      </div>

      <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
        {[`${PAID_LIMITS.coursesPerMonth} cours/mois`, `${PAID_LIMITS.examsPerMonth} examens et ${PAID_LIMITS.synthesesPerMonth} résumés de module/mois`, "Flashcards, To-Do et Notes illimités"].map((line) => (
          <li key={line} className="flex items-center gap-2">
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
            {line}
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-col gap-2">
        <Button size="lg" className="w-full" onClick={onChoosePlan}>
          Choisir ma formule
        </Button>
        {!locked && (
          <button
            type="button"
            onClick={onBackToCourse}
            className="mx-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" />
            Revenir à mon cours
          </button>
        )}
      </div>
      <p className="mt-3 text-center text-[11px] text-muted-foreground">Paiement sécurisé en DA · Tes cours et notes restent sauvegardés.</p>
    </>
  );
}

function QuotaContent({ view, usage, onClose, onChoosePlan }: { view: PaywallReason; usage: UsageSnapshot | null; onClose: () => void; onChoosePlan: () => void }) {
  const copy = quotaCopy(view, usage);
  return (
    <>
      <DialogPrimitive.Close
        aria-label="Fermer"
        className="touch-target absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-400">
          <CalendarClock className="h-7 w-7" />
        </div>
        <DialogPrimitive.Title className="text-xl font-bold text-foreground">{copy.title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-2 text-balance text-sm leading-relaxed text-muted-foreground">{copy.body}</DialogPrimitive.Description>
      </div>
      <div className="mt-5 space-y-2">
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{copy.reset}</span>
        </div>
        {copy.rule && (
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{copy.rule}</span>
          </div>
        )}
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <Button size="lg" className="w-full" onClick={onClose}>
          J&apos;ai compris
        </Button>
        <button
          type="button"
          onClick={onChoosePlan}
          className="mx-auto min-h-11 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Voir ma formule
        </button>
      </div>
    </>
  );
}

/**
 * Full-screen paywall / limit screen. Trial variants are blocking (no close
 * button, no Escape, no outside click); quota variants are dismissible.
 */
export function PaywallModal({ view, usage, locked, onChoosePlan, onBackToCourse, onClose }: PaywallModalProps) {
  const open = view !== null;
  const dismissible = view !== null && !isTrialView(view) && !locked;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && dismissible) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[200] bg-slate-950/60 backdrop-blur-xl" />
        <DialogPrimitive.Content
          onEscapeKeyDown={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onClick={(event) => {
            // The card sits inside a full-screen Content: a click on the empty area around it is the "backdrop".
            if (dismissible && event.target === event.currentTarget) onClose();
          }}
          className="fixed inset-0 z-[201] flex items-end justify-center overflow-y-auto overscroll-contain p-0 focus:outline-none sm:items-center sm:p-6"
        >
          {view !== null && (
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 280, damping: 28 }}
              className="relative my-auto w-full max-w-md rounded-t-[1.75rem] border border-border bg-card px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-7 shadow-card sm:rounded-3xl sm:px-7 sm:pb-7"
            >
              {view === "trial_exhausted" || isTrialView(view) || locked ? (
                <TrialContent view={view} usage={usage} locked={locked} onChoosePlan={onChoosePlan} onBackToCourse={onBackToCourse} />
              ) : (
                <QuotaContent view={view} usage={usage} onClose={onClose} onChoosePlan={onChoosePlan} />
              )}
            </motion.div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
