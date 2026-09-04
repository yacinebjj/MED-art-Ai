"use client";

import { motion } from "framer-motion";
import { Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudioClinicalRelevanceData } from "@/lib/course-slug-content";

const STAGGER_CONTAINER = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const FADE_UP = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 110, damping: 16 } },
};

/**
 * 1ère année's replacement for the "Cas Clinique" tile — a motivational
 * essay ("pourquoi dois-je étudier ce cours ?"), never a fabricated patient.
 * Deliberately its own small component rather than inlined in
 * app/dashboard/module/[id]/page.tsx (unlike explication/exemples_analogies,
 * which ARE inlined there) — this shape is genuinely distinct content
 * (title + paragraphs, no Markdown source), and keeping it separate avoids
 * growing that page's already-large render logic further.
 *
 * See STUDIO_CAS_CLINIQUE_YEAR1_SYSTEM_PROMPT (lib/ai/studio-prompts.ts) and
 * StudioClinicalRelevanceSchema (lib/ai/studio-schemas.ts) for the prompt/
 * schema this data comes from.
 */
export function ClinicalRelevanceStudio({ data }: { data: StudioClinicalRelevanceData }) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={STAGGER_CONTAINER}
      className="w-full mx-auto max-w-3xl space-y-6 font-sans text-slate-800 dark:text-slate-200 animate-fade-in"
    >
      <motion.div variants={FADE_UP} className="flex items-start gap-3 border-b border-amber-200/60 pb-4 dark:border-amber-900/40">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 shadow-sm dark:bg-amber-950/40 dark:text-amber-400">
          <Compass className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">Utilité Clinique</p>
          <h2 className="text-xl font-black leading-snug text-slate-900 dark:text-slate-100 sm:text-2xl">{data.titre}</h2>
        </div>
      </motion.div>

      <div className="space-y-5">
        {data.paragraphes.map((paragraphe, i) => (
          <motion.p
            key={i}
            variants={FADE_UP}
            dir="auto"
            className={cn(
              "text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 sm:text-base",
              // The very first paragraph reads as the hook — a touch larger
              // and bolder, matching how the rest of Studio (GastriteResumeStudio's
              // hero, GastriteCasCliniqueStudio's title) always gives its
              // opening line more visual weight than the body.
              i === 0 && "text-base font-medium text-slate-800 dark:text-slate-200 sm:text-lg"
            )}
          >
            {paragraphe}
          </motion.p>
        ))}
      </div>
    </motion.div>
  );
}
