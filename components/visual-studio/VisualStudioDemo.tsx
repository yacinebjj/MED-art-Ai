"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, type Variants } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Droplets,
  Flame,
  Heart,
  Lightbulb,
  MapPin,
  Minus,
  Plus,
  Shield,
  Skull,
  Stethoscope,
  Thermometer,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TOTAL_SLIDES = 4;
const ZOOM_MIN = 100;
const ZOOM_MAX = 300;
const ZOOM_STEP = 25;

const PEARLS = [
  "Astuce du Prof : la base appendiculaire, à la convergence des trois bandelettes coliques, reste le seul repère chirurgical constant.",
  "Astuce du Prof : un tuyau digestif normal a deux issues. L'appendice n'en a qu'une — un vrai cul-de-sac.",
  "Astuce du Prof : une biologie normale n'élimine jamais le diagnostic dans les premières heures.",
  "Astuce du Prof : le signe de Blumberg traduit un péritonisme déjà installé — un signal d'alarme.",
];

/** Orchestrates the cascading stagger — every direct itemVariants child flows in one after another. */
const CONTAINER_VARIANTS: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.15, delayChildren: 0.1 },
  },
};

/** Heavy, liquid-smooth spring entrance for every card / title / SVG node. */
const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 40, filter: "blur(12px)", scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    scale: 1,
    transition: { type: "spring", damping: 20, stiffness: 90, mass: 0.8 },
  },
};

/* ----------------------------------------------------------------------- */
/* Typography hierarchy — precision scale for a dense, typeset infographic. */
/* ----------------------------------------------------------------------- */

function titleClass(dark: boolean) {
  return cn("text-3xl font-black", dark ? "text-white" : "text-slate-900");
}

function cardTitleClass(dark: boolean) {
  return cn("text-lg font-bold", dark ? "text-slate-100" : "text-slate-900");
}

function bodyClass(dark: boolean) {
  return cn("text-[13px] leading-relaxed xl:text-[15px]", dark ? "text-slate-300" : "text-slate-700");
}

function cardBase(dark: boolean) {
  return dark
    ? "bg-slate-900/50 backdrop-blur-xl border border-white/10 shadow-xl"
    : "bg-slate-100/90 backdrop-blur-xl border border-slate-200 shadow-sm";
}

function SlideTitle({ dark, children }: { dark: boolean; children: React.ReactNode }) {
  return (
    <motion.h2 variants={ITEM_VARIANTS} className={cn("mb-2 shrink-0 tracking-tight", titleClass(dark))}>
      {children}
    </motion.h2>
  );
}

/* ----------------------------------------------------------------------- */
/* SLIDE 1 — Cartographie Anatomique (grid-cols-12, fills the 16:9 canvas)  */
/* ----------------------------------------------------------------------- */

function PositionCard({
  icon: Icon,
  tone,
  title,
  desc,
  dark,
}: {
  icon: LucideIcon;
  tone: "cyan" | "amber";
  title: string;
  desc: string;
  dark: boolean;
}) {
  const toneBorder = tone === "cyan" ? "border-l-cyan-400" : "border-l-amber-400";
  const iconClasses =
    tone === "cyan"
      ? dark
        ? "bg-cyan-500/10 text-cyan-400"
        : "bg-cyan-100 text-cyan-600"
      : dark
        ? "bg-amber-500/10 text-amber-400"
        : "bg-amber-100 text-amber-600";
  const bg = dark ? "bg-slate-900/50 backdrop-blur-xl" : "bg-slate-100/90 backdrop-blur-xl";

  return (
    <motion.div
      variants={ITEM_VARIANTS}
      whileHover={{ y: -3, scale: 1.02 }}
      className={cn("h-auto w-full rounded-xl border-l-4 p-2 shadow-sm transition-colors duration-300", bg, toneBorder)}
    >
      <div className={cn("mb-1 flex h-6 w-6 items-center justify-center rounded-md", iconClasses)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <h3 className={cn("mb-0.5 truncate", cardTitleClass(dark))}>{title}</h3>
      <p className={cn(bodyClass(dark), "line-clamp-3")}>{desc}</p>
    </motion.div>
  );
}

function FIDDiagram({ dark }: { dark: boolean }) {
  const dashStroke = dark ? "rgba(255,255,255,0.15)" : "rgba(15,23,42,0.18)";
  const dashStroke2 = dark ? "rgba(255,255,255,0.2)" : "rgba(15,23,42,0.22)";
  const labelDark = dark ? "#67e8f9" : "#0891b2";
  const labelAmber = dark ? "#fcd34d" : "#b45309";

  return (
    <motion.div variants={ITEM_VARIANTS} className="relative flex h-full w-full items-center justify-center">
      <svg viewBox="0 0 400 400" className="h-full max-h-[350px] w-full">
        <defs>
          <radialGradient id="fidGlow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse cx="200" cy="200" rx="170" ry="150" fill="none" stroke={dashStroke} strokeWidth="1.5" strokeDasharray="4 6" />
        <ellipse
          cx="200"
          cy="210"
          rx="130"
          ry="110"
          fill="none"
          stroke={dashStroke2}
          strokeWidth="1.5"
          strokeDasharray="4 6"
          transform="rotate(20 200 200)"
        />
        <ellipse
          cx="200"
          cy="190"
          rx="100"
          ry="130"
          fill="none"
          stroke="rgba(34,211,238,0.3)"
          strokeWidth="1.5"
          strokeDasharray="3 5"
          transform="rotate(-15 200 200)"
        />

        <circle cx="200" cy="200" r="90" fill="url(#fidGlow)" />

        <g>
          <circle cx="120" cy="270" r="6" fill="#22d3ee" />
          <text x="60" y="290" fill={labelDark} fontSize="12" fontFamily="ui-sans-serif, system-ui">
            Iléo-pelvienne
          </text>
        </g>
        <g>
          <circle cx="105" cy="150" r="6" fill="#22d3ee" />
          <text x="20" y="140" fill={labelDark} fontSize="12" fontFamily="ui-sans-serif, system-ui">
            Rétro-cæcale
          </text>
        </g>
        <g>
          <circle cx="295" cy="120" r="6" fill="#fbbf24" />
          <text x="235" y="100" fill={labelAmber} fontSize="12" fontFamily="ui-sans-serif, system-ui">
            Sous-hépatique
          </text>
        </g>
        <g>
          <circle cx="275" cy="245" r="6" fill="#fbbf24" />
          <text x="285" y="270" fill={labelAmber} fontSize="12" fontFamily="ui-sans-serif, system-ui">
            Méso-cœliaque
          </text>
        </g>

        <line x1="200" y1="200" x2="120" y2="270" stroke="rgba(34,211,238,0.35)" strokeWidth="1" />
        <line x1="200" y1="200" x2="105" y2="150" stroke="rgba(34,211,238,0.35)" strokeWidth="1" />
        <line x1="200" y1="200" x2="295" y2="120" stroke="rgba(251,191,36,0.35)" strokeWidth="1" />
        <line x1="200" y1="200" x2="275" y2="245" stroke="rgba(251,191,36,0.35)" strokeWidth="1" />

        <circle cx="200" cy="200" r="14" className="fill-rose-500 animate-pulse" />
        <circle cx="200" cy="200" r="14" fill="none" stroke="#fb7185" strokeWidth="2" opacity="0.5">
          <animate attributeName="r" values="14;30;14" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0.5" dur="2.5s" repeatCount="indefinite" />
        </circle>
      </svg>

      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-bold text-rose-400">
        Base appendiculaire — point fixe
      </div>
    </motion.div>
  );
}

function SlideAnatomy({ dark }: { dark: boolean }) {
  return (
    <div className="flex h-full w-full flex-col">
      <SlideTitle dark={dark}>1. Cartographie Anatomique de l&apos;Appendice</SlideTitle>
      <div className="grid h-full min-h-0 w-full flex-1 grid-cols-12 items-center gap-2">
        <div className="col-span-3 flex flex-col gap-1.5">
          <PositionCard
            dark={dark}
            icon={MapPin}
            tone="cyan"
            title="Iléo-pelvienne"
            desc="La pointe descend vers le petit bassin, longeant l'iléon terminal. Deuxième position la plus fréquente, présente dans environ 30% des cas."
          />
          <PositionCard
            dark={dark}
            icon={Shield}
            tone="cyan"
            title="Rétro-cæcale"
            desc="La plus fréquente, retrouvée chez près de 65% des patients. L'appendice se cache derrière le cæcum, rendant la défense parfois discrète."
          />
        </div>

        <div className="relative col-span-6 flex h-full items-center justify-center">
          <FIDDiagram dark={dark} />
        </div>

        <div className="col-span-3 flex flex-col gap-1.5">
          <PositionCard
            dark={dark}
            icon={AlertTriangle}
            tone="amber"
            title="Sous-hépatique"
            desc="Rare mais trompeuse. L'appendice migre haut sous le foie et la douleur peut simuler une cholécystite aiguë."
          />
          <PositionCard
            dark={dark}
            icon={Zap}
            tone="amber"
            title="Méso-cœliaque"
            desc="Très rare. Nichée au milieu des anses grêles, elle provoque souvent un tableau pseudo-occlusif trompeur."
          />
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* SLIDE 2 — Protocole d'Évolution Physiopathologique                       */
/* ----------------------------------------------------------------------- */

type CascadeTone = "cyan" | "blue" | "orange" | "red";

const CASCADE_TONE_CLASSES: Record<CascadeTone, { border: string; shadow: string; icon: string; text: string }> = {
  cyan: {
    border: "border-cyan-500/30",
    shadow: "shadow-[0_0_30px_-10px_rgba(6,182,212,0.4)]",
    icon: "bg-cyan-500/10 text-cyan-400",
    text: "text-cyan-500",
  },
  blue: {
    border: "border-blue-500/30",
    shadow: "shadow-[0_0_30px_-10px_rgba(59,130,246,0.4)]",
    icon: "bg-blue-500/10 text-blue-400",
    text: "text-blue-500",
  },
  orange: {
    border: "border-orange-500/30",
    shadow: "shadow-[0_0_30px_-10px_rgba(249,115,22,0.4)]",
    icon: "bg-orange-500/10 text-orange-400",
    text: "text-orange-500",
  },
  red: {
    border: "border-red-500/30",
    shadow: "shadow-[0_0_30px_-10px_rgba(239,68,68,0.4)]",
    icon: "bg-red-500/10 text-red-400",
    text: "text-red-500",
  },
};

function CascadeStep({
  number,
  icon: Icon,
  tone,
  title,
  desc,
  dark,
}: {
  number: string;
  icon: LucideIcon;
  tone: CascadeTone;
  title: string;
  desc: string;
  dark: boolean;
}) {
  const t = CASCADE_TONE_CLASSES[tone];
  const bg = dark ? "bg-slate-900/50 backdrop-blur-xl" : "bg-slate-100/90 backdrop-blur-xl";

  return (
    <motion.div
      variants={ITEM_VARIANTS}
      whileHover={{ y: -3, scale: 1.02 }}
      className={cn("relative h-full w-full flex-1 overflow-hidden rounded-xl border p-2", bg, t.border, t.shadow)}
    >
      <span
        className={cn(
          "pointer-events-none absolute right-2 top-0.5 select-none text-5xl font-black",
          dark ? "text-white/5" : "text-slate-900/5"
        )}
      >
        {number}
      </span>
      <div className={cn("relative mb-1 flex h-7 w-7 items-center justify-center rounded-lg", t.icon)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <h3 className={cn("relative mb-0.5 truncate", cardTitleClass(dark))}>{title}</h3>
      <p className={cn("relative", bodyClass(dark), "line-clamp-4")}>{desc}</p>
    </motion.div>
  );
}

function FlowConnector({ tone }: { tone: CascadeTone }) {
  return (
    <motion.svg
      variants={ITEM_VARIANTS}
      viewBox="0 0 24 24"
      className={cn("h-5 w-5 shrink-0 animate-pulse", CASCADE_TONE_CLASSES[tone].text)}
    >
      <path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </motion.svg>
  );
}

function SlidePathophysiology({ dark }: { dark: boolean }) {
  return (
    <div className="flex h-full w-full flex-col">
      <SlideTitle dark={dark}>2. Protocole d&apos;Évolution Physiopathologique</SlideTitle>

      <div className="flex h-full min-h-0 w-full flex-1 flex-row items-stretch justify-between gap-2">
        <CascadeStep
          dark={dark}
          number="1"
          icon={Ban}
          tone="cyan"
          title="Obstruction"
          desc="Un stercolithe durci ou une hyperplasie lymphoïde ferme la lumière appendiculaire, transformant l'organe en un cul-de-sac clos."
        />
        <FlowConnector tone="cyan" />
        <CascadeStep
          dark={dark}
          number="2"
          icon={Droplets}
          tone="blue"
          title="Stase"
          desc="Sans issue, le mucus s'accumule. La pression intraluminale grimpe progressivement et étire la paroi de l'intérieur."
        />
        <FlowConnector tone="blue" />
        <CascadeStep
          dark={dark}
          number="3"
          icon={Activity}
          tone="orange"
          title="Ischémie"
          desc="La pression comprime d'abord les veines, puis les artères. Privée d'oxygène, la paroi s'épaissit et devient fragile."
        />
        <FlowConnector tone="orange" />
        <CascadeStep
          dark={dark}
          number="4"
          icon={Skull}
          tone="red"
          title="Nécrose"
          desc="Les tissus meurent faute de perfusion. Sans prise en charge rapide, la paroi se rompt — perforation et péritonite."
        />
      </div>

      <motion.div
        variants={ITEM_VARIANTS}
        className={cn(
          "mt-1.5 flex w-full shrink-0 items-center gap-2 rounded-xl border p-2",
          dark
            ? "border-white/10 bg-slate-900/60 shadow-[0_0_40px_-15px_rgba(255,255,255,0.1)]"
            : "border-slate-200 bg-slate-100/90 shadow-sm"
        )}
      >
        <h4
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-xs font-bold uppercase tracking-wide",
            dark ? "text-cyan-300" : "text-cyan-700"
          )}
        >
          <Lightbulb className="h-3.5 w-3.5" />
          Le Pourquoi
        </h4>
        <p className={cn(bodyClass(dark), "line-clamp-2")}>
          Contrairement à un tube digestif normal ouvert aux deux bouts, l&apos;appendice n&apos;a qu&apos;une seule
          porte. Dès qu&apos;elle se ferme, la pression n&apos;a nulle part où se libérer.
        </p>
      </motion.div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* SLIDE 3 — Épidémiologie & Répartition Statistique (60/40 split)          */
/* ----------------------------------------------------------------------- */

function StatBar({
  label,
  value,
  displayValue,
  dark,
}: {
  label: string;
  value: number;
  displayValue: string;
  dark: boolean;
}) {
  return (
    <motion.div variants={ITEM_VARIANTS} className="mb-2 last:mb-0">
      <div className="mb-0.5 flex items-end justify-between gap-3">
        <span className={cn("text-xs font-bold", dark ? "text-slate-300" : "text-slate-700")}>{label}</span>
        <span className={cn("shrink-0 text-lg font-black xl:text-xl", dark ? "text-white" : "text-slate-900")}>
          {displayValue}
        </span>
      </div>
      <div className={cn("relative h-2.5 w-full overflow-hidden rounded-full", dark ? "bg-white/5" : "bg-slate-200")}>
        <div
          className="relative h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 shadow-[0_0_20px_rgba(6,182,212,0.5)] transition-all duration-700"
          style={{ width: `${value}%` }}
        >
          <span
            className={cn(
              "absolute -right-1.5 -top-0.5 h-4 w-4 rounded-full border-2 bg-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.8)]",
              dark ? "border-slate-950" : "border-white"
            )}
          />
        </div>
      </div>
    </motion.div>
  );
}

function SlideEpidemiology({ dark }: { dark: boolean }) {
  return (
    <div className="flex h-full w-full flex-col">
      <SlideTitle dark={dark}>3. Épidémiologie &amp; Répartition Statistique</SlideTitle>
      <div className="grid h-full min-h-0 w-full flex-1 grid-cols-5 items-center gap-3">
        <motion.div variants={ITEM_VARIANTS} className={cn("col-span-3 h-auto w-full rounded-xl p-3", cardBase(dark))}>
          <h3 className={cn("mb-2 text-xs font-bold uppercase tracking-widest", dark ? "text-slate-500" : "text-slate-500")}>
            Distribution des Valeurs
          </h3>
          <StatBar dark={dark} label="Risque cumulé sur la vie" value={9} displayValue="8.6%" />
          <StatBar dark={dark} label="Forme rétro-cæcale" value={72} displayValue="72%" />
          <StatBar dark={dark} label="Sex-ratio Homme : Femme" value={58} displayValue="1.4:1" />
          <StatBar dark={dark} label="Sensibilité du Scanner" value={95} displayValue="95%" />
        </motion.div>

        <motion.div
          variants={ITEM_VARIANTS}
          className={cn("col-span-2 flex h-auto w-full flex-col justify-between rounded-xl p-3", cardBase(dark))}
        >
          <div>
            <div
              className={cn(
                "mb-1.5 flex h-8 w-8 items-center justify-center rounded-lg",
                dark ? "bg-cyan-500/10 text-cyan-400" : "bg-cyan-100 text-cyan-600"
              )}
            >
              <BarChart3 className="h-4 w-4" />
            </div>
            <h3 className={cn("mb-0.5", cardTitleClass(dark))}>Synthèse du Risque</h3>
            <p className={cn(bodyClass(dark), "line-clamp-4")}>
              Cette pathologie chirurgicale reste la plus fréquente en contexte d&apos;urgence, avec un pic
              d&apos;incidence marqué entre 10 et 30 ans et une décroissance progressive ensuite.
            </p>
          </div>

          <div className="mt-1.5 flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-emerald-500 shadow-[0_0_25px_-8px_rgba(16,185,129,0.5)]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="text-xs font-bold uppercase tracking-wide">Données Validées</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* SLIDE 4 — Cycle Diagnostique & Signes Cardinaux (strict 50/50 split)     */
/* ----------------------------------------------------------------------- */

type SatelliteTone = "orange" | "blue" | "purple" | "emerald";

const SATELLITE_TONE_CLASSES: Record<SatelliteTone, string> = {
  orange: "border-orange-400 bg-orange-500/10 text-orange-400 shadow-[0_0_30px_rgba(249,115,22,0.4)]",
  blue: "border-blue-400 bg-blue-500/10 text-blue-400 shadow-[0_0_30px_rgba(59,130,246,0.4)]",
  purple: "border-purple-400 bg-purple-500/10 text-purple-400 shadow-[0_0_30px_rgba(168,85,247,0.4)]",
  emerald: "border-emerald-400 bg-emerald-500/10 text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.4)]",
};

const SATELLITE_POSITION_CLASSES = {
  top: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2",
  right: "left-full top-1/2 -translate-x-1/2 -translate-y-1/2",
  bottom: "left-1/2 top-full -translate-x-1/2 -translate-y-1/2",
  left: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2",
} as const;

function SatelliteNode({
  position,
  tone,
  icon: Icon,
  label,
}: {
  position: keyof typeof SATELLITE_POSITION_CLASSES;
  tone: SatelliteTone;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <motion.div
      variants={ITEM_VARIANTS}
      className={cn(
        "absolute z-10 flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 backdrop-blur-sm",
        SATELLITE_POSITION_CLASSES[position],
        SATELLITE_TONE_CLASSES[tone]
      )}
    >
      <Icon className="mb-0.5 h-3.5 w-3.5" />
      <span className="text-[9px] font-bold uppercase tracking-wide">{label}</span>
    </motion.div>
  );
}

function OrbitalDiagram({ dark }: { dark: boolean }) {
  return (
    <div className="relative mx-auto aspect-square h-full max-h-[280px] w-auto">
      <div className="absolute left-1/2 top-1/2 h-1/2 w-px -translate-x-1/2 -translate-y-full bg-gradient-to-t from-cyan-500/60 to-transparent" />
      <div className="absolute left-1/2 top-1/2 h-px w-1/2 -translate-y-1/2 bg-gradient-to-r from-cyan-500/60 to-transparent" />
      <div className="absolute left-1/2 top-1/2 h-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-cyan-500/60 to-transparent" />
      <div className="absolute left-1/2 top-1/2 h-px w-1/2 -translate-x-full -translate-y-1/2 bg-gradient-to-l from-cyan-500/60 to-transparent" />

      <motion.div
        variants={ITEM_VARIANTS}
        className="absolute left-1/2 top-1/2 z-20 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-2 border-cyan-400 bg-cyan-500/10 text-center shadow-[0_0_50px_rgba(6,182,212,0.5)] backdrop-blur-sm"
      >
        <Stethoscope className={cn("mb-1 h-5 w-5", dark ? "text-cyan-300" : "text-cyan-600")} />
        <span className={cn("text-xs font-black uppercase tracking-wide", dark ? "text-white" : "text-slate-900")}>
          Appendicite
        </span>
      </motion.div>

      <SatelliteNode position="top" tone="orange" icon={Flame} label="Douleur" />
      <SatelliteNode position="right" tone="blue" icon={Activity} label="Anorexie" />
      <SatelliteNode position="bottom" tone="purple" icon={Thermometer} label="Fièvre" />
      <SatelliteNode position="left" tone="emerald" icon={Shield} label="Défense" />
    </div>
  );
}

type SignTone = "orange" | "blue" | "rose" | "amber";

const SIGN_TONE_CLASSES: Record<SignTone, string> = {
  orange: "bg-orange-500/10 text-orange-400",
  blue: "bg-blue-500/10 text-blue-400",
  rose: "bg-rose-500/10 text-rose-400",
  amber: "bg-amber-500/10 text-amber-400",
};

function SignRow({
  icon: Icon,
  tone,
  title,
  desc,
  dark,
}: {
  icon: LucideIcon;
  tone: SignTone;
  title: string;
  desc: string;
  dark: boolean;
}) {
  return (
    <motion.div
      variants={ITEM_VARIANTS}
      whileHover={{ y: -3, scale: 1.02 }}
      className={cn("flex h-auto w-full flex-row items-center gap-2.5 rounded-xl p-2.5", cardBase(dark))}
    >
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", SIGN_TONE_CLASSES[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <h4 className={cn("mb-0.5 truncate", cardTitleClass(dark))}>{title}</h4>
        <p className={cn(bodyClass(dark), "line-clamp-2")}>{desc}</p>
      </div>
    </motion.div>
  );
}

function SlideDiagnostic({ dark }: { dark: boolean }) {
  return (
    <div className="flex h-full w-full flex-col">
      <SlideTitle dark={dark}>4. Cycle Diagnostique &amp; Signes Cardinaux</SlideTitle>
      <div className="grid h-full min-h-0 w-full flex-1 grid-cols-2 items-center gap-4">
        <div className="flex h-full items-center justify-center">
          <OrbitalDiagram dark={dark} />
        </div>
        <div className="flex h-full w-full flex-col justify-center gap-1.5">
          <SignRow
            dark={dark}
            icon={Flame}
            tone="orange"
            title="Migration Douloureuse"
            desc="Débute autour de l'ombilic puis migre vers la FID en quelques heures — le signe le plus évocateur (50-60%)."
          />
          <SignRow
            dark={dark}
            icon={Activity}
            tone="blue"
            title="Anorexie Constante"
            desc="Une perte d'appétit quasi systématique, souvent le tout premier symptôme, précédant même la douleur."
          />
          <SignRow
            dark={dark}
            icon={Heart}
            tone="rose"
            title="Irritation Péritonéale"
            desc="Le signe de Blumberg — douleur au relâchement plus intense qu'à la pression — traduit un péritonisme installé."
          />
          <SignRow
            dark={dark}
            icon={Zap}
            tone="amber"
            title="Syndrome Inflammatoire"
            desc="Fièvre modérée (~38°C), hyperleucocytose et CRP élevée reflètent la réponse inflammatoire systémique."
          />
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* SHELL — Strict 16:9 horizontal presentation canvas + zoom/pan engine     */
/* ----------------------------------------------------------------------- */

export function VisualStudioDemo({ dark = true }: { dark?: boolean }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(ZOOM_MIN);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);

  useEffect(() => {
    if (zoomLevel === ZOOM_MIN) {
      dragX.set(0);
      dragY.set(0);
    }
  }, [zoomLevel, dragX, dragY]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        setCurrentSlide((s) => Math.min(TOTAL_SLIDES - 1, s + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentSlide((s) => Math.max(0, s - 1));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function goPrev() {
    setCurrentSlide((s) => Math.max(0, s - 1));
  }

  function goNext() {
    setCurrentSlide((s) => Math.min(TOTAL_SLIDES - 1, s + 1));
  }

  function zoomOut() {
    setZoomLevel((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP));
  }

  function zoomIn() {
    setZoomLevel((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP));
  }

  const isZoomed = zoomLevel > ZOOM_MIN;

  return (
    <div
      className={cn(
        "relative mx-auto flex aspect-video max-h-[80vh] w-full max-w-full flex-col overflow-hidden rounded-2xl transition-colors duration-300",
        dark ? "border border-slate-800 bg-slate-950 text-slate-100" : "border border-slate-200/80 bg-white text-slate-900 shadow-sm"
      )}
    >
      {dark && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-blue-500/10 blur-3xl" />
        </div>
      )}

      {/* Percentage zoom widget */}
      <div className="absolute right-4 top-4 z-50 flex items-center gap-3 rounded-full border border-white/10 bg-slate-900/80 px-4 py-2 shadow-2xl backdrop-blur-xl">
        <button
          type="button"
          onClick={zoomOut}
          disabled={zoomLevel === ZOOM_MIN}
          aria-label="Dézoomer"
          className="flex h-6 w-6 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-cyan-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-300"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-12 text-center text-sm font-bold text-white">{zoomLevel}%</span>
        <button
          type="button"
          onClick={zoomIn}
          disabled={zoomLevel === ZOOM_MAX}
          aria-label="Zoomer"
          className="flex h-6 w-6 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-cyan-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-300"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/*
        Note on the zoom mechanics: the spec called for a raw
        `style={{ transform: 'scale(...)' }}` on the same element that also
        gets Framer's `drag`. That combination fights itself — Framer takes
        ownership of the `transform` property to track drag position and
        would overwrite a hand-set scale() on every frame. Instead, scale is
        driven through Framer's own `animate` prop and pan through its `x`/`y`
        motion values — both compose into one `transform` correctly, and
        `drag` still works. Functionally identical result, no conflict.
      */}
      <div ref={viewportRef} className="relative z-10 min-h-0 flex-1 overflow-hidden p-3 lg:p-5">
        <motion.div
          drag={isZoomed}
          dragConstraints={viewportRef}
          dragElastic={0.05}
          dragMomentum={false}
          style={{ x: dragX, y: dragY }}
          animate={{ scale: zoomLevel / 100 }}
          transition={{ type: "spring", damping: 24, stiffness: 200 }}
          className={cn(
            "h-full min-h-0 origin-center",
            isZoomed ? "cursor-grab active:cursor-grabbing" : "cursor-default"
          )}
        >
          <motion.div
            key={currentSlide}
            variants={CONTAINER_VARIANTS}
            initial="hidden"
            animate="visible"
            className="flex h-full min-h-0 flex-col"
          >
            {currentSlide === 0 && <SlideAnatomy dark={dark} />}
            {currentSlide === 1 && <SlidePathophysiology dark={dark} />}
            {currentSlide === 2 && <SlideEpidemiology dark={dark} />}
            {currentSlide === 3 && <SlideDiagnostic dark={dark} />}
          </motion.div>
        </motion.div>
      </div>

      <div className="relative z-20 flex shrink-0 items-center justify-between gap-3 border-t border-white/5 px-3 py-2 lg:px-5 lg:py-3">
        <div
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-lg border px-3 py-1.5",
            dark ? "border-amber-500/20 bg-amber-500/10 text-amber-400" : "border-amber-300 bg-amber-50 text-amber-700"
          )}
        >
          <Lightbulb className="h-3.5 w-3.5 shrink-0" />
          <p className="truncate text-xs font-bold leading-snug">{PEARLS[currentSlide]}</p>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          <button
            type="button"
            onClick={goPrev}
            disabled={currentSlide === 0}
            aria-label="Slide précédente"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-30",
              dark
                ? "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                : "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          <div className="flex items-center gap-1.5">
            {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentSlide(i)}
                aria-label={`Aller à la diapositive ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === currentSlide
                    ? "w-5 bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.7)]"
                    : dark
                      ? "w-1.5 bg-white/15 hover:bg-white/30"
                      : "w-1.5 bg-slate-300 hover:bg-slate-400"
                )}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={goNext}
            disabled={currentSlide === TOTAL_SLIDES - 1}
            aria-label="Slide suivante"
            className={cn(
              "flex h-7 items-center gap-1 rounded-full px-2.5 transition-all duration-300",
              currentSlide === TOTAL_SLIDES - 1
                ? cn("cursor-not-allowed", dark ? "bg-white/5 text-slate-600" : "bg-slate-100 text-slate-400")
                : "bg-cyan-400 text-slate-900 shadow-[0_0_20px_rgba(6,182,212,0.5)] hover:bg-cyan-300"
            )}
          >
            <ChevronRight className="h-3.5 w-3.5" />
            {currentSlide !== TOTAL_SLIDES - 1 && (
              <span className="hidden items-center gap-0.5 text-[9px] font-bold opacity-70 sm:flex">
                <CornerDownLeft className="h-2.5 w-2.5" />
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
