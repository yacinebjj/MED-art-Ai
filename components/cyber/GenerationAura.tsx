"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Generation-in-progress screen: pulsing AI aura, the real steps of the
 * pipeline cycling as captions (never a fake percentage — the server answers
 * in one response), telemetry chips and content skeletons.
 */
export function GenerationAura({
  title,
  steps,
  chips,
  accent = "cyan",
  className,
}: {
  title: string;
  steps: string[];
  chips?: ReactNode;
  accent?: "cyan" | "violet" | "amber";
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (steps.length < 2) return;
    const id = window.setInterval(() => setStepIndex((i) => (i + 1) % steps.length), 2800);
    return () => window.clearInterval(id);
  }, [steps.length]);

  const tone = accent === "violet" ? "from-violet-400 to-fuchsia-500" : accent === "amber" ? "from-amber-300 to-orange-500" : "from-cyan-300 to-sky-500";
  const ring = accent === "violet" ? "border-violet-400/40" : accent === "amber" ? "border-amber-400/40" : "border-cyan-400/40";

  return (
    <div className={cn("flex flex-col items-center gap-6 px-4 py-10 text-center sm:py-14", className)} role="status" aria-live="polite">
      <div className="relative flex h-28 w-28 items-center justify-center">
        {!reduce &&
          [0, 1, 2].map((i) => (
            <motion.span
              key={i}
              aria-hidden
              className={cn("absolute inset-0 rounded-full border", ring)}
              initial={{ scale: 0.6, opacity: 0.7 }}
              animate={{ scale: 1.6, opacity: 0 }}
              transition={{ duration: 2.4, delay: i * 0.8, repeat: Infinity, ease: "easeOut" }}
            />
          ))}
        <span aria-hidden className={cn("absolute inset-4 rounded-full bg-gradient-to-br opacity-30 blur-xl", tone)} />
        <span className={cn("relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br text-slate-950 shadow-[0_0_40px_rgba(34,211,238,0.45)]", tone)}>
          <motion.span animate={reduce ? undefined : { rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }}>
            <Sparkles className="h-7 w-7" />
          </motion.span>
        </span>
      </div>

      <div className="max-w-md">
        <p className="text-base font-black text-foreground">{title}</p>
        <motion.p key={stepIndex} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-1.5 text-sm text-muted-foreground">
          {steps[stepIndex]}
        </motion.p>
      </div>

      {chips && <div className="flex flex-wrap justify-center gap-2">{chips}</div>}

      <div className="w-full max-w-lg space-y-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.08]" style={{ animationDelay: `${i * 0.2}s` }} />
            <div className="h-3 w-full animate-pulse rounded bg-white/[0.06]" style={{ animationDelay: `${i * 0.2 + 0.1}s` }} />
            <div className="h-3 w-5/6 animate-pulse rounded bg-white/[0.06]" style={{ animationDelay: `${i * 0.2 + 0.2}s` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Small telemetry chip ("6 cours • ~50 QCM"). */
export function TelemetryChip({ icon: Icon, children }: { icon: typeof Sparkles; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-foreground">
      <Icon className="h-3.5 w-3.5 text-cyan-400" />
      {children}
    </span>
  );
}
