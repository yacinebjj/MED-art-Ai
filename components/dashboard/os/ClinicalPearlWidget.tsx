"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Lightbulb, Stethoscope, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import { localDayKey } from "@/providers/PomodoroProvider";
import { pearlOfTheDay } from "@/lib/dashboard/clinical-pearls";
import { onLocalActivitySynced, readPearlAnswer, writePearlAnswer } from "@/lib/dashboard/local-activity";
import { tCockpit } from "@/lib/translations/cockpit";
import { OsCard, WidgetSkeleton, useNow } from "./primitives";

const LETTERS = ["A", "B", "C", "D"];

/** "Cas Flash du Jour": one hand-written clinical question per day, answered in 30 s — no AI call, no credit. */
export function ClinicalPearlWidget({ userId }: { userId: string | null }) {
  const { language } = useLanguage();
  const now = useNow();
  const day = now ? localDayKey(now) : null;
  const pearl = useMemo(() => (now ? pearlOfTheDay(now) : null), [day]); // eslint-disable-line react-hooks/exhaustive-deps
  const [choice, setChoice] = useState<number | null>(null);

  useEffect(() => {
    if (!userId || !day || !pearl) return;
    setChoice(readPearlAnswer(userId, day, pearl.id));
    // Answered on another device (cross-device sync).
    return onLocalActivitySynced(() => setChoice(readPearlAnswer(userId, day, pearl.id)));
  }, [userId, day, pearl]);

  if (!pearl || !day) return <WidgetSkeleton />;
  const answered = choice !== null;
  const correct = choice === pearl.answer;

  function pick(index: number) {
    if (answered || !pearl || !day) return;
    setChoice(index);
    if (userId) writePearlAnswer(userId, day, pearl.id, index);
  }

  return (
    <OsCard
      icon={Stethoscope}
      iconClassName="from-emerald-500 to-teal-500"
      title={tCockpit("pearlTitle", language)}
      glow="hover:shadow-emerald-500/15"
      action={<span className="truncate rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">{pearl.tag[language]}</span>}
    >
      <p className="text-sm font-semibold leading-snug text-foreground">{pearl.question[language]}</p>
      <div className="mt-3 grid gap-1.5">
        {pearl.options[language].map((option, index) => {
          const isAnswer = index === pearl.answer;
          const isChoice = index === choice;
          return (
            <motion.button
              key={index}
              type="button"
              disabled={answered}
              onClick={() => pick(index)}
              whileTap={answered ? undefined : { scale: 0.98 }}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-all duration-200",
                !answered && "border-border/70 bg-background/50 text-foreground hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50/60 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/30",
                answered && isAnswer && "border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
                answered && isChoice && !isAnswer && "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300",
                answered && !isAnswer && !isChoice && "border-border/50 text-muted-foreground opacity-60"
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold",
                  answered && isAnswer ? "bg-emerald-500 text-white" : answered && isChoice ? "bg-rose-500 text-white" : "bg-muted text-muted-foreground"
                )}
              >
                {LETTERS[index]}
              </span>
              <span className="flex-1">{option}</span>
              {answered && isAnswer && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
              {answered && isChoice && !isAnswer && <XCircle className="h-4 w-4 shrink-0 text-rose-500" />}
            </motion.button>
          );
        })}
      </div>
      <AnimatePresence>
        {answered && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="overflow-hidden">
            <div className={cn("mt-3 flex gap-2 rounded-xl p-3 text-xs leading-relaxed", correct ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-amber-500/10 text-amber-800 dark:text-amber-200")}>
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <span className="font-bold">{correct ? tCockpit("pearlCorrect", language) : tCockpit("pearlWrong", language)} </span>
                {pearl.explanation[language]}
              </p>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">{tCockpit("pearlNext", language)}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </OsCard>
  );
}
