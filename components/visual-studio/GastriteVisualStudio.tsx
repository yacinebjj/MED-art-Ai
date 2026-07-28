"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, type Variants } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Lightbulb,
  Minus,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveLucideIcon } from "@/lib/lucide-icon-lookup";
import type {
  GastriteCentralNode,
  GastriteModeVisuelData,
  GastriteOrbitNode,
  GastriteSign,
  GastriteSlide,
} from "@/lib/course-slug-content";

const ZOOM_MIN = 100;
const ZOOM_MAX = 300;
const ZOOM_STEP = 25;

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
/* Tone class maps — indexed by the literal string tones already used in   */
/* the validated JSON. Falls back to a neutral tone if an unknown string   */
/* ever shows up, rather than throwing.                                    */
/* ----------------------------------------------------------------------- */

const RING_TONE_CLASSES: Record<string, string> = {
  emerald: "border-emerald-400 bg-emerald-500/10 text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.4)]",
  red: "border-red-400 bg-red-500/10 text-red-400 shadow-[0_0_30px_rgba(239,68,68,0.4)]",
  orange: "border-orange-400 bg-orange-500/10 text-orange-400 shadow-[0_0_30px_rgba(249,115,22,0.4)]",
  cyan: "border-cyan-400 bg-cyan-500/10 text-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.4)]",
  blue: "border-blue-400 bg-blue-500/10 text-blue-400 shadow-[0_0_30px_rgba(59,130,246,0.4)]",
  purple: "border-purple-400 bg-purple-500/10 text-purple-400 shadow-[0_0_30px_rgba(168,85,247,0.4)]",
};

const SIDE_CARD_TONE_CLASSES: Record<string, { border: string; iconBg: (dark: boolean) => string }> = {
  emerald: { border: "border-l-emerald-400", iconBg: (dark) => (dark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-100 text-emerald-600") },
  cyan: { border: "border-l-cyan-400", iconBg: (dark) => (dark ? "bg-cyan-500/10 text-cyan-400" : "bg-cyan-100 text-cyan-600") },
  red: { border: "border-l-red-400", iconBg: (dark) => (dark ? "bg-red-500/10 text-red-400" : "bg-red-100 text-red-600") },
  orange: { border: "border-l-orange-400", iconBg: (dark) => (dark ? "bg-orange-500/10 text-orange-400" : "bg-orange-100 text-orange-600") },
};

const CASCADE_TONE_CLASSES: Record<string, { border: string; shadow: string; icon: string; text: string }> = {
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

const SIGN_TONE_CLASSES: Record<string, string> = {
  orange: "bg-orange-500/10 text-orange-400",
  blue: "bg-blue-500/10 text-blue-400",
  rose: "bg-rose-500/10 text-rose-400",
  amber: "bg-amber-500/10 text-amber-400",
};

const RING_POSITION_CLASSES = {
  top: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2",
  right: "left-full top-1/2 -translate-x-1/2 -translate-y-1/2",
  bottom: "left-1/2 top-full -translate-x-1/2 -translate-y-1/2",
  left: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2",
} as const;

/* ----------------------------------------------------------------------- */
/* LAYOUT "orbital" — central node + 4 orbit nodes + 4 side detail cards.   */
/* ----------------------------------------------------------------------- */

function OrbitNode({
  position,
  tone,
  icon: Icon,
  label,
}: {
  position: keyof typeof RING_POSITION_CLASSES;
  tone: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <motion.div
      variants={ITEM_VARIANTS}
      className={cn(
        "absolute z-10 flex h-16 w-16 flex-col items-center justify-center rounded-full border-2 text-center backdrop-blur-sm",
        RING_POSITION_CLASSES[position],
        RING_TONE_CLASSES[tone] ?? RING_TONE_CLASSES.cyan
      )}
    >
      <Icon className="mb-0.5 h-4 w-4" />
      <span className="px-1 text-[8px] font-bold uppercase leading-tight tracking-wide">{label}</span>
    </motion.div>
  );
}

/** Splits a central-node label into a bold first line + a smaller accent second line, e.g. "Équilibre Gastrique" → "Équilibre" / "Gastrique". */
function splitCentralLabel(label: string): [string, string | null] {
  const [first, ...rest] = label.split(" ");
  return [first, rest.length ? rest.join(" ") : null];
}

/** Older/hand-edited rows in Supabase sometimes still store `central_node` as null rather than an empty-shape object — fall back rather than crash. */
const FALLBACK_CENTRAL_NODE: GastriteCentralNode = { label: "", icon: "stethoscope" };

function FortressDiagram({ central, orbitNodes, dark }: { central: GastriteCentralNode; orbitNodes: GastriteOrbitNode[]; dark: boolean }) {
  const [line1, line2] = splitCentralLabel(central.label);
  const CentralIcon = resolveLucideIcon(central.icon);
  return (
    <div className="relative mx-auto aspect-square h-full max-h-[300px] w-auto">
      <div className="absolute left-1/2 top-1/2 h-1/2 w-px -translate-x-1/2 -translate-y-full bg-gradient-to-t from-teal-500/60 to-transparent" />
      <div className="absolute left-1/2 top-1/2 h-px w-1/2 -translate-y-1/2 bg-gradient-to-r from-teal-500/60 to-transparent" />
      <div className="absolute left-1/2 top-1/2 h-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-teal-500/60 to-transparent" />
      <div className="absolute left-1/2 top-1/2 h-px w-1/2 -translate-x-full -translate-y-1/2 bg-gradient-to-l from-teal-500/60 to-transparent" />

      <motion.div
        variants={ITEM_VARIANTS}
        className="absolute left-1/2 top-1/2 z-20 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-2 border-teal-400 bg-teal-500/10 text-center shadow-[0_0_50px_rgba(20,184,166,0.5)] backdrop-blur-sm"
      >
        <CentralIcon className={cn("mb-1 h-5 w-5", dark ? "text-teal-300" : "text-teal-600")} />
        <span className={cn("text-xs font-black uppercase tracking-wide", dark ? "text-white" : "text-slate-900")}>
          {line1}
        </span>
        {line2 && (
          <span className={cn("text-[9px] font-bold uppercase tracking-wide", dark ? "text-teal-300" : "text-teal-600")}>
            {line2}
          </span>
        )}
      </motion.div>

      {orbitNodes.map((node) => (
        <OrbitNode key={node.label} position={node.position} tone={node.tone} icon={resolveLucideIcon(node.icon)} label={node.label} />
      ))}
    </div>
  );
}

function SlideOrbital({ slide, dark }: { slide: GastriteSlide; dark: boolean }) {
  const half = Math.ceil(slide.side_cards.length / 2);
  const leftCards = slide.side_cards.slice(0, half);
  const rightCards = slide.side_cards.slice(half);

  function renderCard(card: GastriteSlide["side_cards"][number]) {
    const Icon = resolveLucideIcon(card.icon);
    const tone = SIDE_CARD_TONE_CLASSES[card.tone] ?? SIDE_CARD_TONE_CLASSES.cyan;
    return (
      <motion.div
        key={card.titre}
        variants={ITEM_VARIANTS}
        whileHover={{ y: -3, scale: 1.02 }}
        className={cn("h-auto w-full rounded-xl border-l-4 p-2 shadow-sm", tone.border, cardBase(dark))}
      >
        <div className={cn("mb-1 flex h-6 w-6 items-center justify-center rounded-md", tone.iconBg(dark))}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <h3 className={cn("mb-0.5 truncate", cardTitleClass(dark))}>{card.titre}</h3>
        <p className={cn(bodyClass(dark), "line-clamp-3")}>{card.description}</p>
      </motion.div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <SlideTitle dark={dark}>
        {slide.numero}. {slide.titre}
      </SlideTitle>
      <div className="grid h-full min-h-0 w-full flex-1 grid-cols-12 items-center gap-2">
        <div className="col-span-3 flex flex-col gap-1.5">{leftCards.map(renderCard)}</div>
        <div className="relative col-span-6 flex h-full items-center justify-center">
          <FortressDiagram central={slide.central_node ?? FALLBACK_CENTRAL_NODE} orbitNodes={slide.orbit_nodes} dark={dark} />
        </div>
        <div className="col-span-3 flex flex-col gap-1.5">{rightCards.map(renderCard)}</div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* LAYOUT "cascade" — a horizontal chain of steps + a "Le Pourquoi" callout. */
/* ----------------------------------------------------------------------- */

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
  tone: string;
  title: string;
  desc: string;
  dark: boolean;
}) {
  const t = CASCADE_TONE_CLASSES[tone] ?? CASCADE_TONE_CLASSES.cyan;
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

function FlowConnector({ tone }: { tone: string }) {
  return (
    <motion.svg
      variants={ITEM_VARIANTS}
      viewBox="0 0 24 24"
      className={cn("h-5 w-5 shrink-0 animate-pulse", (CASCADE_TONE_CLASSES[tone] ?? CASCADE_TONE_CLASSES.cyan).text)}
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

function SlideCascade({ slide, dark }: { slide: GastriteSlide; dark: boolean }) {
  return (
    <div className="flex h-full w-full flex-col">
      <SlideTitle dark={dark}>
        {slide.numero}. {slide.titre}
      </SlideTitle>

      <div className="flex h-full min-h-0 w-full flex-1 flex-row items-stretch justify-between gap-2">
        {slide.steps.map((step, i) => (
          <Fragment key={step.titre}>
            <CascadeStep
              dark={dark}
              number={step.numero}
              icon={resolveLucideIcon(step.icon)}
              tone={step.tone}
              title={step.titre}
              desc={step.description}
            />
            {i < slide.steps.length - 1 && <FlowConnector tone={step.tone} />}
          </Fragment>
        ))}
      </div>

      {slide.le_pourquoi && (
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
              dark ? "text-teal-300" : "text-teal-700"
            )}
          >
            <Lightbulb className="h-3.5 w-3.5" />
            Le Pourquoi
          </h4>
          <p className={cn(bodyClass(dark), "line-clamp-2")}>{slide.le_pourquoi}</p>
        </motion.div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* LAYOUT "stats" — a stat-bar panel + a synthesis card.                    */
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
          className="relative h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-600 shadow-[0_0_20px_rgba(20,184,166,0.5)] transition-all duration-700"
          style={{ width: `${value}%` }}
        >
          <span
            className={cn(
              "absolute -right-1.5 -top-0.5 h-4 w-4 rounded-full border-2 bg-teal-300 shadow-[0_0_15px_rgba(45,212,191,0.8)]",
              dark ? "border-slate-950" : "border-white"
            )}
          />
        </div>
      </div>
    </motion.div>
  );
}

function SlideStats({ slide, dark }: { slide: GastriteSlide; dark: boolean }) {
  return (
    <div className="flex h-full w-full flex-col">
      <SlideTitle dark={dark}>
        {slide.numero}. {slide.titre}
      </SlideTitle>
      <div className="grid h-full min-h-0 w-full flex-1 grid-cols-5 items-center gap-3">
        <motion.div variants={ITEM_VARIANTS} className={cn("col-span-3 h-auto w-full rounded-xl p-3", cardBase(dark))}>
          <h3 className={cn("mb-2 text-xs font-bold uppercase tracking-widest", dark ? "text-slate-500" : "text-slate-500")}>
            Distribution des Valeurs
          </h3>
          {slide.stat_bars.map((bar) => (
            <StatBar key={bar.label} dark={dark} label={bar.label} value={bar.value} displayValue={bar.display} />
          ))}
        </motion.div>

        {slide.synthese?.titre && (
          <motion.div
            variants={ITEM_VARIANTS}
            className={cn("col-span-2 flex h-auto w-full flex-col justify-between rounded-xl p-3", cardBase(dark))}
          >
            <div>
              <div
                className={cn(
                  "mb-1.5 flex h-8 w-8 items-center justify-center rounded-lg",
                  dark ? "bg-teal-500/10 text-teal-400" : "bg-teal-100 text-teal-600"
                )}
              >
                {(() => {
                  const Icon = resolveLucideIcon("bar-chart-3");
                  return <Icon className="h-4 w-4" />;
                })()}
              </div>
              <h3 className={cn("mb-0.5", cardTitleClass(dark))}>{slide.synthese.titre}</h3>
              <p className={cn(bodyClass(dark), "line-clamp-4")}>{slide.synthese.description}</p>
            </div>

            <div className="mt-1.5 flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-emerald-500 shadow-[0_0_25px_-8px_rgba(16,185,129,0.5)]">
              {(() => {
                const Icon = resolveLucideIcon("check-circle-2");
                return <Icon className="h-3.5 w-3.5" />;
              })()}
              <span className="text-xs font-bold uppercase tracking-wide">{slide.synthese.badge}</span>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* LAYOUT "orbital_signs" — smaller orbital diagram + a list of sign rows.  */
/* ----------------------------------------------------------------------- */

function SatelliteNode({
  position,
  tone,
  icon: Icon,
  label,
}: {
  position: keyof typeof RING_POSITION_CLASSES;
  tone: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <motion.div
      variants={ITEM_VARIANTS}
      className={cn(
        "absolute z-10 flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 backdrop-blur-sm",
        RING_POSITION_CLASSES[position],
        RING_TONE_CLASSES[tone] ?? RING_TONE_CLASSES.cyan
      )}
    >
      <Icon className="mb-0.5 h-3.5 w-3.5" />
      <span className="text-[9px] font-bold uppercase tracking-wide">{label}</span>
    </motion.div>
  );
}

function OrbitalDiagram({ central, orbitNodes, dark }: { central: GastriteCentralNode; orbitNodes: GastriteOrbitNode[]; dark: boolean }) {
  const [line1] = splitCentralLabel(central.label);
  const CentralIcon = resolveLucideIcon(central.icon);
  return (
    <div className="relative mx-auto aspect-square h-full max-h-[280px] w-auto">
      <div className="absolute left-1/2 top-1/2 h-1/2 w-px -translate-x-1/2 -translate-y-full bg-gradient-to-t from-teal-500/60 to-transparent" />
      <div className="absolute left-1/2 top-1/2 h-px w-1/2 -translate-y-1/2 bg-gradient-to-r from-teal-500/60 to-transparent" />
      <div className="absolute left-1/2 top-1/2 h-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-teal-500/60 to-transparent" />
      <div className="absolute left-1/2 top-1/2 h-px w-1/2 -translate-x-full -translate-y-1/2 bg-gradient-to-l from-teal-500/60 to-transparent" />

      <motion.div
        variants={ITEM_VARIANTS}
        className="absolute left-1/2 top-1/2 z-20 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-2 border-teal-400 bg-teal-500/10 text-center shadow-[0_0_50px_rgba(20,184,166,0.5)] backdrop-blur-sm"
      >
        <CentralIcon className={cn("mb-1 h-5 w-5", dark ? "text-teal-300" : "text-teal-600")} />
        <span className={cn("text-xs font-black uppercase tracking-wide", dark ? "text-white" : "text-slate-900")}>
          {line1}
        </span>
      </motion.div>

      {orbitNodes.map((node) => (
        <SatelliteNode key={node.label} position={node.position} tone={node.tone} icon={resolveLucideIcon(node.icon)} label={node.label} />
      ))}
    </div>
  );
}

function SignRow({
  icon: Icon,
  tone,
  title,
  desc,
  dark,
}: {
  icon: LucideIcon;
  tone: string;
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
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", SIGN_TONE_CLASSES[tone] ?? SIGN_TONE_CLASSES.blue)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <h4 className={cn("mb-0.5 truncate", cardTitleClass(dark))}>{title}</h4>
        <p className={cn(bodyClass(dark), "line-clamp-2")}>{desc}</p>
      </div>
    </motion.div>
  );
}

function SlideOrbitalSigns({ slide, dark }: { slide: GastriteSlide; dark: boolean }) {
  return (
    <div className="flex h-full w-full flex-col">
      <SlideTitle dark={dark}>
        {slide.numero}. {slide.titre}
      </SlideTitle>
      <div className="grid h-full min-h-0 w-full flex-1 grid-cols-2 items-center gap-4">
        <div className="flex h-full items-center justify-center">
          <OrbitalDiagram central={slide.central_node ?? FALLBACK_CENTRAL_NODE} orbitNodes={slide.orbit_nodes} dark={dark} />
        </div>
        <div className="flex h-full w-full flex-col justify-center gap-1.5">
          {slide.signs.map((sign: GastriteSign) => (
            <SignRow
              key={sign.titre}
              dark={dark}
              icon={resolveLucideIcon(sign.icon)}
              tone={sign.tone}
              title={sign.titre}
              desc={sign.description}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Layout dispatcher — picks the right renderer for a slide's `layout`.     */
/* ----------------------------------------------------------------------- */

function SlideRenderer({ slide, dark }: { slide: GastriteSlide; dark: boolean }) {
  switch (slide.layout) {
    case "orbital":
      return <SlideOrbital slide={slide} dark={dark} />;
    case "cascade":
      return <SlideCascade slide={slide} dark={dark} />;
    case "stats":
      return <SlideStats slide={slide} dark={dark} />;
    case "orbital_signs":
      return <SlideOrbitalSigns slide={slide} dark={dark} />;
    default:
      return null;
  }
}

/* ----------------------------------------------------------------------- */
/* SHELL — Strict 16:9 horizontal presentation canvas + zoom/pan engine     */
/* ----------------------------------------------------------------------- */

export function GastriteVisualStudio({ data, dark = true }: { data: GastriteModeVisuelData; dark?: boolean }) {
  const totalSlides = data.slides.length;
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
        setCurrentSlide((s) => Math.min(totalSlides - 1, s + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentSlide((s) => Math.max(0, s - 1));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [totalSlides]);

  function goPrev() {
    setCurrentSlide((s) => Math.max(0, s - 1));
  }

  function goNext() {
    setCurrentSlide((s) => Math.min(totalSlides - 1, s + 1));
  }

  function zoomOut() {
    setZoomLevel((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP));
  }

  function zoomIn() {
    setZoomLevel((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP));
  }

  const isZoomed = zoomLevel > ZOOM_MIN;
  const slide = data.slides[currentSlide];

  return (
    <div
      className={cn(
        "relative mx-auto flex aspect-video max-h-[80vh] w-full max-w-full flex-col overflow-hidden rounded-2xl transition-colors duration-300",
        dark ? "border border-slate-800 bg-slate-950 text-slate-100" : "border border-slate-200/80 bg-white text-slate-900 shadow-sm"
      )}
    >
      {dark && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-teal-500/10 blur-3xl" />
          <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        </div>
      )}

      {/* Percentage zoom widget */}
      <div className="absolute right-4 top-4 z-50 flex items-center gap-3 rounded-full border border-white/10 bg-slate-900/80 px-4 py-2 shadow-2xl backdrop-blur-xl">
        <button
          type="button"
          onClick={zoomOut}
          disabled={zoomLevel === ZOOM_MIN}
          aria-label="Dézoomer"
          className="flex h-6 w-6 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-teal-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-300"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-12 text-center text-sm font-bold text-white">{zoomLevel}%</span>
        <button
          type="button"
          onClick={zoomIn}
          disabled={zoomLevel === ZOOM_MAX}
          aria-label="Zoomer"
          className="flex h-6 w-6 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-teal-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-300"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

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
            {slide && <SlideRenderer slide={slide} dark={dark} />}
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
          <p className="truncate text-xs font-bold leading-snug">{data.pearls[currentSlide]}</p>
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
            {Array.from({ length: totalSlides }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentSlide(i)}
                aria-label={`Aller à la diapositive ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === currentSlide
                    ? "w-5 bg-teal-400 shadow-[0_0_10px_rgba(45,212,191,0.7)]"
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
            disabled={currentSlide === totalSlides - 1}
            aria-label="Slide suivante"
            className={cn(
              "flex h-7 items-center gap-1 rounded-full px-2.5 transition-all duration-300",
              currentSlide === totalSlides - 1
                ? cn("cursor-not-allowed", dark ? "bg-white/5 text-slate-600" : "bg-slate-100 text-slate-400")
                : "bg-teal-400 text-slate-900 shadow-[0_0_20px_rgba(45,212,191,0.5)] hover:bg-teal-300"
            )}
          >
            <ChevronRight className="h-3.5 w-3.5" />
            {currentSlide !== totalSlides - 1 && (
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
