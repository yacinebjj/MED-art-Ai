import { AlertOctagon, Lightbulb, ShieldAlert } from "lucide-react";
import type { PearlsSlide } from "@/lib/presentation-types";

/** Tone recipe kept identical to every other Visual Studio content panel (chip / border / heading / bullet), each paired with a dark-mode-safe variant. */
const TONE_CLASSES = {
  emerald: {
    border: "border-emerald-200 dark:border-emerald-500/25",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    heading: "text-emerald-700 dark:text-emerald-300",
    chip: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
    bullet: "bg-emerald-500 dark:bg-emerald-400",
  },
  amber: {
    border: "border-amber-200 dark:border-amber-500/25",
    bg: "bg-amber-50 dark:bg-amber-500/10",
    heading: "text-amber-700 dark:text-amber-300",
    chip: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
    bullet: "bg-amber-500 dark:bg-amber-400",
  },
  rose: {
    border: "border-rose-200 dark:border-rose-500/25",
    bg: "bg-rose-50 dark:bg-rose-500/10",
    heading: "text-rose-700 dark:text-rose-300",
    chip: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
    bullet: "bg-rose-500 dark:bg-rose-400",
  },
} as const;

function PearlColumn({
  title,
  icon: Icon,
  items,
  tone,
}: {
  title: string;
  icon: typeof Lightbulb;
  items: string[];
  tone: keyof typeof TONE_CLASSES;
}) {
  const toneClasses = TONE_CLASSES[tone];

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors duration-300 ${toneClasses.border} ${toneClasses.bg}`}
    >
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneClasses.chip}`}>
          <Icon className="h-4 w-4" />
        </span>
        <h4 className={`text-xs font-bold uppercase tracking-wide ${toneClasses.heading}`}>{title}</h4>
      </div>
      <ul className="space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm leading-snug text-foreground/90">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${toneClasses.bullet}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ClinicalPearlsPanel({ slide }: { slide: PearlsSlide }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <PearlColumn title="Perles Cliniques" icon={Lightbulb} items={slide.pearls} tone="emerald" />
      <PearlColumn title="Pièges à Éviter" icon={ShieldAlert} items={slide.pitfalls} tone="amber" />
      <PearlColumn title="Erreurs Fréquentes" icon={AlertOctagon} items={slide.mistakes} tone="rose" />
    </div>
  );
}
