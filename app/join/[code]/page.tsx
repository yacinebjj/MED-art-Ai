"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Clock, Loader2, LogIn, ShieldCheck, Sparkles, Undo2, UserPlus, Users } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { CyberPanel, CyberStage } from "@/components/cyber/primitives";
import { GROUP_SIZE, PLANS, POOL_DEADLINE_DAYS, PROMO_SIZE, REFUND_DELAY_LABEL, formatDZD } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/client";

/** Read back after sign-up (RegisterForm has no `next` param yet) to send the student to their tracker. */
const PENDING_POOL_KEY = "medart:pending-pool-code";

type InviteKind = "promo" | "group" | "lead" | "unknown";

function parseKind(raw: string | null): InviteKind {
  return raw === "promo" || raw === "group" || raw === "lead" ? raw : "unknown";
}

function sanitizeCode(raw: string | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

interface InviteCopy {
  kicker: string;
  title: string;
  lead: string;
  points: { icon: typeof Users; text: string }[];
}

function copyFor(kind: InviteKind): InviteCopy {
  const solo = formatDZD(PLANS.individual_monthly.priceDZD);
  const promo = formatDZD(PLANS.promo_monthly.priceDZD);
  const group = formatDZD(PLANS.group_monthly.priceDZD);
  const refund = {
    icon: Undo2,
    text: `Objectif non atteint sous ${POOL_DEADLINE_DAYS} jours ? Le remboursement est déclenché automatiquement, reçu sous ${REFUND_DELAY_LABEL}.`,
  };
  const secure = { icon: ShieldCheck, text: "Paiement sécurisé par Chargily Pay (Edahabia / CIB) — ta place est réservée 30 minutes pendant le paiement." };

  switch (kind) {
    case "promo":
      return {
        kicker: `Groupe · ${PROMO_SIZE} personnes`,
        title: "Ton groupe débloque MedArt AI ensemble",
        lead: `Un ami a lancé un Groupe de ${PROMO_SIZE} : chacun paie dès ${promo} par mois au lieu de ${solo}, pour un accès complet. L'accès démarre pour tout le monde dès que la jauge atteint ${PROMO_SIZE}/${PROMO_SIZE}.`,
        points: [{ icon: Users, text: `Il faut être exactement ${PROMO_SIZE} : chaque inscription fait avancer la jauge en direct.` }, secure, refund],
      };
    case "group":
      return {
        kicker: `Groupe · ${GROUP_SIZE} personnes`,
        title: "Ton groupe débloque MedArt AI",
        lead: `On t'invite dans un Groupe de ${GROUP_SIZE} : chacun paie ${group} par mois au lieu de ${solo}. L'accès démarre pour les ${GROUP_SIZE} dès que le groupe est complet.`,
        points: [{ icon: Users, text: `Il faut être exactement ${GROUP_SIZE} : chaque inscription fait avancer la jauge en direct.` }, secure, refund],
      };
    case "lead":
      return {
        kicker: `Groupe · ${GROUP_SIZE} personnes`,
        title: "Une place MedArt AI t'attend",
        lead: "Le créateur de ce groupe a déjà payé toutes les places. Crée ton compte (ou connecte-toi) puis rejoins le groupe : tu n'as rien à payer.",
        points: [
          { icon: ShieldCheck, text: "Place déjà payée : aucun paiement ne te sera demandé." },
          { icon: Sparkles, text: "Accès complet : Studio, examens, résumés de module, Copilot IA." },
        ],
      };
    case "unknown":
      return {
        kicker: "Invitation",
        title: "On t'invite à débloquer MedArt AI ensemble",
        lead: `En Groupe de ${PROMO_SIZE} (${promo}/mois chacun) ou en Groupe de ${GROUP_SIZE} (${group}/mois chacun), MedArt AI revient bien moins cher qu'en individuel (${solo}/mois).`,
        points: [secure, refund],
      };
  }
}

function JoinLanding() {
  const params = useParams<{ code: string }>();
  const code = sanitizeCode(params?.code);
  const kind = parseKind(useSearchParams().get("k"));
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  const trackerPath = `/dashboard/billing/pool/${code}`;

  useEffect(() => {
    if (!code) {
      setChecking(false);
      return;
    }
    try {
      window.localStorage.setItem(PENDING_POOL_KEY, code);
    } catch {
      // Private mode / storage disabled — the login `next` param still works.
    }
    let cancelled = false;
    // Local session read only (no network): a logged-in visitor goes straight to the tracker.
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.session) router.replace(trackerPath);
        else setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, router, trackerPath]);

  const copy = copyFor(kind);
  const next = encodeURIComponent(trackerPath);

  return (
    <div className="min-h-dvh px-3 py-6 sm:px-6 sm:py-10">
      <CyberStage accent="violet" className="mx-auto max-w-xl rounded-[1.75rem] border p-5 max-md:rounded-[1.75rem] max-md:border-x max-sm:mx-0 sm:max-md:mx-auto sm:p-8">
        <div className="flex justify-center">
          <Logo size="md" />
        </div>

        {!code ? (
          <div className="mt-6 text-center">
            <h1 className="text-xl font-black text-white">Lien d&apos;invitation incomplet</h1>
            <p className="mt-2 text-sm text-slate-400">Demande à la personne qui t&apos;a invité(e) de te renvoyer le lien.</p>
            <Link href="/" className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-cyan-300 hover:underline">
              Découvrir MedArt AI <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
            <p className="cyber-kicker mt-6 text-center">{copy.kicker}</p>
            <h1 className="cyber-title mt-2 text-center text-2xl font-black leading-tight tracking-tight sm:text-3xl">{copy.title}</h1>
            <p className="mt-3 text-center text-sm leading-relaxed text-slate-300">{copy.lead}</p>

            <CyberPanel className="mt-6 p-4 sm:p-5">
              <ul className="space-y-3">
                {copy.points.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-3 text-[13px] leading-relaxed text-slate-300">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                      <Icon className="h-4 w-4 text-emerald-300" />
                    </span>
                    <span className="pt-1">{text}</span>
                  </li>
                ))}
              </ul>
            </CyberPanel>

            <p className="mt-5 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Code d&apos;invitation <span className="ml-1 font-mono text-sm normal-case tracking-[0.2em] text-slate-200">{code}</span>
            </p>

            {checking ? (
              <div className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Vérification de ta session…
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                <Link
                  href={`/register?next=${next}`}
                  className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-400 text-base font-black text-slate-950 shadow-[0_0_30px_rgba(139,92,246,0.35)] transition-transform active:scale-[0.98]"
                >
                  <UserPlus className="h-5 w-5" />
                  Créer mon compte
                </Link>
                <Link
                  href={`/login?next=${next}`}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.04] text-sm font-bold text-slate-100 transition-colors hover:bg-white/10"
                >
                  <LogIn className="h-4 w-4" />
                  J&apos;ai déjà un compte
                </Link>
                <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-[11px] text-slate-500">
                  <Clock className="h-3.5 w-3.5" />
                  Une fois connecté(e), tu verras la jauge du groupe en direct.
                </p>
              </div>
            )}
          </motion.div>
        )}
      </CyberStage>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinLanding />
    </Suspense>
  );
}
