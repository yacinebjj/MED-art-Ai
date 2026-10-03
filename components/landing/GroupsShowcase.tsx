"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { AtSign, BarChart3, CheckCheck, FileText, FolderOpen, Link2, Lock, MessagesSquare, Reply, Smile, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import { GradientText, Reveal, SectionHeading, TiltCard } from "./primitives";

const FEATURES = [
  { icon: MessagesSquare, fr: "Temps réel : messages, « en train d'écrire », en ligne", en: "Real time: messages, typing, who's online" },
  { icon: CheckCheck, fr: "Accusés ✓ envoyé, ✓✓ distribué, ✓✓ vu", en: "Receipts: ✓ sent, ✓✓ delivered, ✓✓ seen" },
  { icon: BarChart3, fr: "Sondages aux résultats en direct", en: "Polls with live results" },
  { icon: FileText, fr: "PDF, Word, PowerPoint, vocaux, images", en: "PDF, Word, PowerPoint, voice notes, images" },
  { icon: AtSign, fr: "@mentions avec notification push", en: "@mentions with push notifications" },
  { icon: Reply, fr: "Réponses citées, glisser pour répondre", en: "Quoted replies, swipe to reply" },
  { icon: Smile, fr: "Réactions médicales 🔥 🧠 🩺", en: "Medical reactions 🔥 🧠 🩺" },
  { icon: FolderOpen, fr: "Bibliothèque : docs, médias, liens", en: "Library: docs, media, links" },
  { icon: Lock, fr: "Groupes privés sur invitation, admin qui valide", en: "Private, invite-only groups with admin approval" },
];

const LOOP_STEPS = 7;
const STEP_MS = 1300;

function ChatSimulation({ fr }: { fr: boolean }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-80px" });
  const [step, setStep] = useState(reduce ? LOOP_STEPS : 0);

  useEffect(() => {
    if (reduce || !inView) return;
    const id = window.setInterval(() => setStep((s) => (s >= LOOP_STEPS + 2 ? 0 : s + 1)), STEP_MS);
    return () => window.clearInterval(id);
  }, [inView, reduce]);

  const votes = step >= 6 ? [5, 2] : step >= 5 ? [3, 1] : [1, 0];
  const total = votes[0] + votes[1];

  return (
    <div ref={ref} className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
        <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 text-sm font-black text-white">
          C
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-slate-950" />
        </span>
        <div>
          <p className="text-sm font-bold text-white">{fr ? "Cardio — Promo 4A" : "Cardio — Class 4A"}</p>
          <p className="text-[11px] text-emerald-300">{step === 1 || step === 4 ? (fr ? "Sara est en train d'écrire…" : "Sara is typing…") : fr ? "7 en ligne" : "7 online"}</p>
        </div>
        <Users className="ml-auto h-4 w-4 text-slate-400" />
      </div>

      <div className="flex flex-1 flex-col gap-2.5 overflow-hidden p-3 text-[12px]">
        <AnimatePresence initial={false}>
          {step >= 2 && (
            <motion.div key="m1" layout initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} className="max-w-[85%] rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.07] px-3 py-2 text-slate-100">
              <p className="text-[10px] font-bold text-cyan-300">Sara</p>
              {fr ? "Voilà la fiche " : "Here's the "}
              <b>{fr ? "choc cardiogénique" : "cardiogenic shock"}</b>
              {fr ? " 👇" : " sheet 👇"}
              <span className="mt-1.5 flex items-center gap-2 rounded-xl bg-black/25 px-2.5 py-1.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500 text-white">
                  <FileText className="h-3.5 w-3.5" />
                </span>
                <span>
                  <span className="block text-[11px] font-semibold">choc-cardiogenique.pdf</span>
                  <span className="block text-[10px] text-slate-400">PDF · 1.8 Mo</span>
                </span>
              </span>
              {step >= 3 && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="mt-1.5 flex gap-1">
                  <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">🔥 4</span>
                  <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">🧠 2</span>
                  <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">🩺 3</span>
                </motion.span>
              )}
            </motion.div>
          )}
          {step >= 4 && (
            <motion.div key="m2" layout initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} className="ml-auto w-[82%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-cyan-500 to-blue-600 px-3 py-2 text-white shadow-lg shadow-cyan-900/40">
              <p className="flex items-center gap-1.5 font-bold">
                <BarChart3 className="h-3.5 w-3.5" /> {fr ? "On révise quoi ce soir ?" : "What do we review tonight?"}
              </p>
              <p className="text-[10px] text-cyan-100">
                {total} {fr ? "votants" : "voters"}
              </p>
              {[fr ? "Cardiologie" : "Cardiology", fr ? "Pneumologie" : "Pulmonology"].map((label, i) => {
                const pct = total ? Math.round((votes[i] / total) * 100) : 0;
                return (
                  <span key={label} className="relative mt-1.5 block overflow-hidden rounded-lg bg-white/15 px-2 py-1">
                    <motion.span className="absolute inset-y-0 left-0 bg-white/30" animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
                    <span className="relative flex justify-between font-semibold">
                      {label}
                      <span>{pct}%</span>
                    </span>
                  </span>
                );
              })}
              <span className="mt-1 flex justify-end">
                <CheckCheck className={cn("h-3.5 w-3.5 transition-colors", step >= 6 ? "text-cyan-100" : "text-white/60")} />
              </span>
            </motion.div>
          )}
          {step >= 7 && (
            <motion.div key="m3" layout initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} className="max-w-[85%] rounded-2xl rounded-tl-sm border border-amber-300/50 bg-amber-300/10 px-3 py-2 text-amber-50 ring-1 ring-amber-300/30">
              <p className="text-[10px] font-bold text-amber-200">Amine</p>
              <span className="rounded bg-amber-300/40 px-1 font-bold text-amber-950">@{fr ? "toi" : "you"}</span> {fr ? "tu prends le cas clinique demain ? 🩺" : "can you take the clinical case tomorrow? 🩺"}
            </motion.div>
          )}
        </AnimatePresence>
        {(step === 1 || step === 4) && (
          <div className="flex w-14 items-center gap-1 rounded-2xl bg-white/[0.07] px-3 py-2.5">
            {[0, 1, 2].map((d) => (
              <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: `${d * 0.15}s` }} />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-white/10 p-3">
        <span className="flex h-9 flex-1 items-center rounded-full bg-white/[0.06] px-3 text-[11px] text-slate-500">{fr ? "Message · **gras** · @mention" : "Message · **bold** · @mention"}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 text-white">
          <Link2 className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

export function GroupsShowcase() {
  const { language } = useLanguage();
  const fr = language === "fr";
  return (
    <section id="groupes" className="relative scroll-mt-24 px-4 py-24 sm:px-6 lg:px-8">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600/10 blur-[120px]" />
      <SectionHeading
        eyebrow={fr ? "Nouveau · Groupes d'étude" : "New · Study groups"}
        title={
          fr ? (
            <>
              Ta promo. <GradientText>En temps réel.</GradientText>
            </>
          ) : (
            <>
              Your class. <GradientText>In real time.</GradientText>
            </>
          )
        }
        subtitle={
          fr
            ? "Un espace privé pour réviser ensemble : partager les cours, trancher en un sondage, se répartir les cas cliniques — sans jamais quitter MedArt."
            : "A private space to revise together: share courses, decide in a poll, split the clinical cases — without ever leaving MedArt."
        }
      />
      <div className="mx-auto mt-14 grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map((feature, i) => (
            <Reveal key={feature.fr} delay={Math.min(i * 0.05, 0.3)}>
              <div className="flex h-full items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-violet-400/30 hover:bg-violet-400/[0.04]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/30 to-cyan-500/20 text-cyan-200">
                  <feature.icon className="h-4 w-4" />
                </span>
                <p className="text-sm font-medium leading-snug text-slate-200">{feature[language]}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.15} className="mx-auto">
          <TiltCard max={8} className="rounded-[2.6rem]">
            <div className="relative h-[34rem] w-[19rem] overflow-hidden rounded-[2.6rem] border-[6px] border-slate-800 bg-slate-950 shadow-[0_40px_100px_-20px_rgba(139,92,246,0.55)] sm:w-[20rem]">
              <div aria-hidden className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-slate-800" />
              <div className="flex h-full flex-col pt-7">
                <ChatSimulation fr={fr} />
              </div>
            </div>
          </TiltCard>
        </Reveal>
      </div>
    </section>
  );
}
