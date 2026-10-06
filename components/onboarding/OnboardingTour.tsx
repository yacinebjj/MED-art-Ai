"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "framer-motion";
import { ArrowLeft, ArrowRight, BookOpenText, ClipboardCheck, FlaskConical, GraduationCap, Sparkles, Trophy, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { ONBOARDING_ROUTE, useOnboarding } from "@/lib/onboarding/onboarding-context";

// ─── Content ────────────────────────────────────────────────────────────────

interface TourStep {
  id: string;
  /** `data-tour` values, in priority order: the first VISIBLE one is spotlighted (desktop sidebar vs mobile dock…). None visible → centered card. */
  targets: string[];
  icon: LucideIcon;
  /** Badge chip gradient + glow color of this workspace. */
  gradient: string;
  glow: string;
  badge: Record<Language, string>;
  title: Record<Language, string>;
  body: Record<Language, string>;
}

const STEPS: TourStep[] = [
  {
    id: "studio",
    targets: ["studio"],
    icon: GraduationCap,
    gradient: "from-emerald-400 to-teal-500",
    glow: "rgba(16,185,129,0.55)",
    badge: { fr: "Studio", en: "Studio" },
    title: { fr: "Ton programme, ton Studio", en: "Your curriculum, your Studio" },
    body: {
      fr: "Choisis un module et importe ton polycopié (PDF, Word, photo). En quelques secondes il devient un cours structuré, prêt à réviser.",
      en: "Pick a module and import your handout (PDF, Word, photo). Within seconds it becomes a structured course, ready to study.",
    },
  },
  {
    id: "explication",
    targets: ["explication"],
    icon: BookOpenText,
    gradient: "from-cyan-400 to-sky-500",
    glow: "rgba(34,211,238,0.55)",
    badge: { fr: "Explication", en: "Explanation" },
    title: { fr: "L'Explication Ultra-Détaillée", en: "The Ultra-Detailed Explanation" },
    body: {
      fr: "Chaque chapitre décortiqué : physiopathologie, clinique, pièges. Et tu reprends toujours là où tu t'es arrêté(e), en un clic.",
      en: "Every chapter broken down: pathophysiology, presentation, pitfalls. And you always pick up where you left off, in one tap.",
    },
  },
  {
    id: "lab",
    targets: ["lab"],
    icon: FlaskConical,
    gradient: "from-violet-400 to-fuchsia-500",
    glow: "rgba(167,139,250,0.55)",
    badge: { fr: "MedArt Lab", en: "MedArt Lab" },
    title: { fr: "Le Lab : pratique comme en stage", en: "The Lab: practice like on rounds" },
    body: {
      fr: "Patient virtuel pour t'entraîner au diagnostic, cartes mentales et matrices pharmaco / diagnostic différentiel — générés depuis TON cours.",
      en: "A virtual patient to train your diagnosis, mind maps and pharmacology / differential matrices — built from YOUR course.",
    },
  },
  {
    id: "exam",
    targets: ["exam"],
    icon: ClipboardCheck,
    gradient: "from-amber-400 to-orange-500",
    glow: "rgba(251,191,36,0.55)",
    badge: { fr: "Examen", en: "Exam" },
    title: { fr: "Le simulateur d'examen", en: "The exam simulator" },
    body: {
      fr: "Des QCM style concours sur tout un module, chronométrés et corrigés. Chaque erreur devient une notion à revoir.",
      en: "Exam-style MCQs across a whole module, timed and corrected. Every mistake becomes a topic to review.",
    },
  },
  {
    id: "chat",
    targets: ["chat"],
    icon: Sparkles,
    gradient: "from-fuchsia-400 to-pink-500",
    glow: "rgba(232,121,249,0.55)",
    badge: { fr: "Copilot IA", en: "AI Copilot" },
    title: { fr: "Ton Copilot clinique, 24h/24", en: "Your clinical Copilot, 24/7" },
    body: {
      fr: "Une question en pleine garde ? Demande. Il répond à partir de tes cours, explique, compare et te fait réciter.",
      en: "A question mid-shift? Ask. It answers from your courses, explains, compares and quizzes you.",
    },
  },
];

const XP_PER_STEP = 20;

const COPY = {
  skip: { fr: "Passer", en: "Skip" },
  next: { fr: "Suivant", en: "Next" },
  back: { fr: "Retour", en: "Back" },
  finish: { fr: "Terminer", en: "Finish" },
  step: { fr: "Étape", en: "Step" },
  of: { fr: "sur", en: "of" },
  keys: { fr: "← → pour naviguer · Échap pour passer", en: "← → to navigate · Esc to skip" },
  finaleKicker: { fr: "Badge débloqué", en: "Badge unlocked" },
  finaleTitle: { fr: "Prêt pour le Majorat !", en: "Ready for the top rank!" },
  finaleBody: {
    fr: "Tu connais les 5 armes de MedArt AI. Importe ton premier cours et laisse le Studio faire le reste.",
    en: "You know MedArt AI's 5 weapons. Import your first course and let the Studio do the rest.",
  },
  launch: { fr: "C'est parti !", en: "Let's go!" },
  dialog: { fr: "Visite guidée de MedArt AI", en: "MedArt AI guided tour" },
} satisfies Record<string, Record<Language, string>>;

// ─── Geometry ───────────────────────────────────────────────────────────────

const HOLE_PADDING = 8;
const VIEWPORT_MARGIN = 12;
const CARD_GAP = 16;
const MOBILE_BREAKPOINT = 640;
const DESKTOP_CARD_WIDTH = 368;
/** Phone dock distance from the screen edge (clears notches / home indicators). */
const MOBILE_DOCK_INSET = 20;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
}

function findTarget(keys: string[]): HTMLElement | null {
  for (const key of keys) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`));
    const visible = candidates.find(isVisible);
    if (visible) return visible;
  }
  return null;
}

function holeOf(el: HTMLElement | null): Box | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left - HOLE_PADDING, y: rect.top - HOLE_PADDING, w: rect.width + HOLE_PADDING * 2, h: rect.height + HOLE_PADDING * 2 };
}

/** Evenodd path: the whole viewport minus a rounded-rect hole — used as the dim/blur layer's clip-path, so the hole is genuinely clear (and clipped for hit-testing too). */
function holeClipPath(x: number, y: number, w: number, h: number, vw: number, vh: number): string {
  const outer = `M0 0H${vw}V${vh}H0Z`;
  if (w < 4 || h < 4) return `path(evenodd, "${outer}")`;
  const r = Math.min(18, w / 2, h / 2);
  const hole = `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  return `path(evenodd, "${outer} ${hole}")`;
}

type CardPlacement = { mode: "float"; top: number; left: number; width: number };

/**
 * Viewport-collision-aware placement: below → above → right → left of the
 * target, else centered. Always numeric on "float", so the card springs
 * between positions instead of jumping. Phones dock the card to the screen
 * edge AWAY from the target, so it never covers what it is describing.
 */
function placeCard(hole: Box | null, cardHeight: number, vw: number, vh: number): CardPlacement {
  const width = Math.min(DESKTOP_CARD_WIDTH, vw - VIEWPORT_MARGIN * 2);
  const centered: CardPlacement = { mode: "float", width, left: (vw - width) / 2, top: Math.max(VIEWPORT_MARGIN, (vh - cardHeight) / 2) };
  if (!hole) return centered;
  if (vw < MOBILE_BREAKPOINT) {
    // Docked full-width to the edge away from the target (numeric, so it springs too).
    const dockTop = hole.y + hole.h / 2 > vh * 0.5;
    return { mode: "float", width: vw - VIEWPORT_MARGIN * 2, left: VIEWPORT_MARGIN, top: dockTop ? MOBILE_DOCK_INSET : Math.max(MOBILE_DOCK_INSET, vh - cardHeight - MOBILE_DOCK_INSET) };
  }
  const clampLeft = (left: number) => Math.min(Math.max(VIEWPORT_MARGIN, left), vw - width - VIEWPORT_MARGIN);
  const clampTop = (top: number) => Math.min(Math.max(VIEWPORT_MARGIN, top), vh - cardHeight - VIEWPORT_MARGIN);
  const centerX = hole.x + hole.w / 2;
  const centerY = hole.y + hole.h / 2;

  if (hole.y + hole.h + CARD_GAP + cardHeight <= vh - VIEWPORT_MARGIN) return { mode: "float", top: hole.y + hole.h + CARD_GAP, left: clampLeft(centerX - width / 2), width };
  if (hole.y - CARD_GAP - cardHeight >= VIEWPORT_MARGIN) return { mode: "float", top: hole.y - CARD_GAP - cardHeight, left: clampLeft(centerX - width / 2), width };
  if (hole.x + hole.w + CARD_GAP + width <= vw - VIEWPORT_MARGIN) return { mode: "float", top: clampTop(centerY - cardHeight / 2), left: hole.x + hole.w + CARD_GAP, width };
  if (hole.x - CARD_GAP - width >= VIEWPORT_MARGIN) return { mode: "float", top: clampTop(centerY - cardHeight / 2), left: hole.x - CARD_GAP - width, width };
  // Nothing fits cleanly (short window, huge target): hug the edge with the
  // most room so as little of the target as possible is covered.
  const spaceAbove = hole.y;
  const spaceBelow = vh - (hole.y + hole.h);
  return { mode: "float", width, left: clampLeft(centerX - width / 2), top: spaceAbove >= spaceBelow ? VIEWPORT_MARGIN : clampTop(vh - cardHeight - VIEWPORT_MARGIN) };
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

const SPRING = { stiffness: 260, damping: 30, mass: 0.9 };

function XpBar({ step, total, reduceMotion }: { step: number; total: number; reduceMotion: boolean }) {
  const pct = ((step + 1) / total) * 100;
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step + 1}>
      <motion.div
        className="relative h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-fuchsia-400 shadow-[0_0_14px_rgba(52,211,153,0.8)]"
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 140, damping: 20 }}
      >
        {!reduceMotion && (
          <motion.span
            aria-hidden
            className="absolute inset-y-0 w-10 bg-gradient-to-r from-transparent via-white/70 to-transparent"
            animate={{ x: ["-40px", "400px"] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.6 }}
          />
        )}
      </motion.div>
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => {
        const angle = (i / 42) * Math.PI * 2 + Math.random() * 0.4;
        const distance = 120 + Math.random() * 170;
        return {
          id: i,
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance - 60,
          rotate: Math.random() * 720 - 360,
          color: ["#34d399", "#22d3ee", "#e879f9", "#fbbf24", "#a78bfa", "#f472b6"][i % 6],
          size: 6 + Math.random() * 6,
          round: i % 3 === 0,
          // Bursts once the card has sprung into its finale position.
          delay: 0.3 + Math.random() * 0.15,
        };
      }),
    []
  );
  return (
    <div aria-hidden className="pointer-events-none relative h-0 w-0">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className={cn("absolute block", p.round ? "rounded-full" : "rounded-[2px]")}
          style={{ width: p.size, height: p.round ? p.size : p.size * 0.45, backgroundColor: p.color, boxShadow: `0 0 8px ${p.color}` }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.4 }}
          animate={{ x: p.x, y: [0, p.y, p.y + 160], opacity: [1, 1, 0], rotate: p.rotate, scale: 1 }}
          transition={{ duration: 1.6, delay: p.delay, ease: [0.16, 1, 0.3, 1], times: [0, 0.55, 1] }}
        />
      ))}
    </div>
  );
}

function FinaleMedal({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <div className="relative mx-auto mb-4 h-24 w-24">
      {!reduceMotion && (
        <motion.div
          aria-hidden
          className="absolute -inset-3 rounded-full bg-[conic-gradient(from_0deg,#34d399,#22d3ee,#e879f9,#fbbf24,#34d399)] opacity-70 blur-md"
          animate={{ rotate: 360 }}
          transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
        />
      )}
      <motion.div
        className="relative flex h-24 w-24 items-center justify-center rounded-full border-2 border-amber-300/80 bg-gradient-to-br from-amber-300 via-amber-500 to-orange-600 shadow-[0_0_40px_rgba(251,191,36,0.6),inset_0_2px_0_rgba(255,255,255,0.5)]"
        initial={reduceMotion ? false : { scale: 0, rotate: -40 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.1 }}
      >
        <Trophy className="h-11 w-11 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]" strokeWidth={2.2} />
      </motion.div>
    </div>
  );
}

// ─── Tour ───────────────────────────────────────────────────────────────────

/**
 * Gamified first-run tour of the dashboard. Rendered once by the shell
 * layout; shows only while useOnboarding().active on ONBOARDING_ROUTE.
 *
 * Mechanics:
 *  - Spotlight: a fixed dim + blur layer whose clip-path is the viewport
 *    minus a rounded hole. The hole's box is four springs (x/y/w/h), so it
 *    glides elastically from one target to the next instead of jumping.
 *    A transparent layer underneath swallows every click: the tour is
 *    guided, nothing navigates away mid-step.
 *  - Targets: `data-tour="…"` attributes; the first VISIBLE match wins (the
 *    desktop sidebar or the mobile dock). No visible target → the hole
 *    closes and the card centers itself.
 *  - Tracking: re-measured on resize, on any scroll (capture phase, so the
 *    shell's own scrolling <main> counts), on target resize, and every
 *    frame for ~1s after a step change while smooth-scrolling settles.
 *  - Card: collision-aware placement (below/above/right/left, else
 *    centered); docked to the screen edge away from the target on phones.
 *  - Keyboard: Esc = skip, ←/→ = back/next; focus moves to the primary
 *    button on every step.
 */
export function OnboardingTour() {
  const { active, finish } = useOnboarding();
  const pathname = usePathname();
  const show = active && pathname === ONBOARDING_ROUTE;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(<AnimatePresence>{show && <TourLayer key="tour" onDone={finish} />}</AnimatePresence>, document.body);
}

function TourLayer({ onDone }: { onDone: () => void }) {
  const { language } = useLanguage();
  const reduceMotion = useReducedMotion() ?? false;
  const [step, setStep] = useState(0);
  const [finale, setFinale] = useState(false);
  const [placement, setPlacement] = useState<CardPlacement>(() =>
    typeof window === "undefined" ? { mode: "float", width: DESKTOP_CARD_WIDTH, left: 0, top: 0 } : placeCard(null, 300, window.innerWidth, window.innerHeight)
  );
  const [initialPlacement] = useState(placement);
  const [hasTarget, setHasTarget] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const holeRef = useRef<Box | null>(null);

  const vw = useMotionValue(typeof window === "undefined" ? 1280 : window.innerWidth);
  const vh = useMotionValue(typeof window === "undefined" ? 800 : window.innerHeight);
  const springConfig = reduceMotion ? { stiffness: 1000, damping: 100 } : SPRING;
  const hx = useSpring(vw.get() / 2, springConfig);
  const hy = useSpring(vh.get() / 2, springConfig);
  const hw = useSpring(0, springConfig);
  const hh = useSpring(0, springConfig);
  const clipPath = useTransform([hx, hy, hw, hh, vw, vh] as MotionValue<number>[], ([x, y, w, h, width, height]: number[]) => holeClipPath(x, y, w, h, width, height));

  const current = STEPS[step];
  const total = STEPS.length;

  const measure = useCallback(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    vw.set(width);
    vh.set(height);
    const hole = finale ? null : holeOf(targetRef.current && targetRef.current.isConnected ? targetRef.current : null);
    holeRef.current = hole;
    if (hole) {
      hx.set(hole.x);
      hy.set(hole.y);
      hw.set(hole.w);
      hh.set(hole.h);
    } else {
      hx.set(width / 2);
      hy.set(height / 2);
      hw.set(0);
      hh.set(0);
    }
    const cardHeight = cardRef.current?.offsetHeight ?? 260;
    const next = placeCard(hole, cardHeight, width, height);
    setPlacement((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    setHasTarget(Boolean(hole));
  }, [finale, hx, hy, hw, hh, vw, vh]);

  // Resolve + scroll to this step's target, then follow it for ~1s while smooth-scroll settles.
  useLayoutEffect(() => {
    targetRef.current = finale ? null : findTarget(current.targets);
    const target = targetRef.current;
    if (target) {
      const rect = target.getBoundingClientRect();
      const outOfView = rect.top < VIEWPORT_MARGIN || rect.bottom > window.innerHeight - VIEWPORT_MARGIN;
      if (outOfView) target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center", inline: "nearest" });
    }
    measure();
    let frame = 0;
    const until = performance.now() + 1000;
    const tick = () => {
      measure();
      if (performance.now() < until) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [step, finale, current.targets, measure, reduceMotion]);

  // Keep tracking afterwards: resize, any scroll (capture), target size changes.
  useEffect(() => {
    let scheduled = 0;
    const schedule = () => {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        measure();
      });
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (targetRef.current) observer?.observe(targetRef.current);
    if (cardRef.current) observer?.observe(cardRef.current);
    return () => {
      cancelAnimationFrame(scheduled);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, { capture: true });
      observer?.disconnect();
    };
  }, [measure, step, finale]);

  const goNext = useCallback(() => {
    haptic(8);
    if (step < total - 1) setStep((s) => s + 1);
    else setFinale(true);
  }, [step, total]);

  const goBack = useCallback(() => {
    if (finale) {
      setFinale(false);
      return;
    }
    if (step > 0) {
      haptic(6);
      setStep((s) => s - 1);
    }
  }, [finale, step]);

  // Keyboard control.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDone();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (finale) onDone();
        else goNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goBack();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finale, goBack, goNext, onDone]);

  // Focus follows the step (keyboard / screen-reader users land on the action).
  useEffect(() => {
    const id = window.setTimeout(() => primaryRef.current?.focus({ preventScroll: true }), 120);
    return () => window.clearTimeout(id);
  }, [step, finale]);

  const Icon = current.icon;
  const xp = (finale ? total : step + 1) * XP_PER_STEP;

  const cardStyle = { width: placement.width };
  const cardAnimate = { opacity: 1, scale: 1, left: placement.left, top: placement.top };
  const cardInitial = { opacity: 0, scale: 0.92, left: initialPlacement.left, top: initialPlacement.top };

  return (
    <motion.div
      className="fixed inset-0 z-[95]"
      role="dialog"
      aria-modal="true"
      aria-label={COPY.dialog[language]}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.25 }}
    >
      {/* Swallows every click/tap: a guided tour never navigates away mid-step. */}
      <div className="absolute inset-0" onPointerDown={(event) => event.preventDefault()} />

      {/* Dim + blur everywhere except the hole. */}
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 bg-black/60 backdrop-blur-sm" style={{ clipPath }} />

      {/* Pulsing glow hugging the active feature. */}
      <AnimatePresence>
        {hasTarget && !finale && (
          <motion.div
            key="glow"
            aria-hidden
            className="pointer-events-none absolute rounded-[18px] border-2"
            style={{ left: hx, top: hy, width: hw, height: hh, borderColor: current.glow }}
            initial={{ opacity: 0 }}
            animate={
              reduceMotion
                ? { opacity: 1, boxShadow: `0 0 0 4px ${current.glow.replace("0.55", "0.2")}, 0 0 28px ${current.glow}` }
                : {
                    opacity: 1,
                    boxShadow: [
                      `0 0 0 2px ${current.glow.replace("0.55", "0.15")}, 0 0 18px ${current.glow}`,
                      `0 0 0 8px ${current.glow.replace("0.55", "0.08")}, 0 0 42px ${current.glow}`,
                      `0 0 0 2px ${current.glow.replace("0.55", "0.15")}, 0 0 18px ${current.glow}`,
                    ],
                  }
            }
            exit={{ opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { boxShadow: { duration: 1.8, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 0.2 } }}
          />
        )}
      </AnimatePresence>

      {/* Finale burst — outside the card, which clips its own overflow. */}
      {finale && !reduceMotion && (
        <div aria-hidden className="pointer-events-none absolute z-10" style={{ left: placement.left + placement.width / 2, top: placement.top + 64 }}>
          <Confetti />
        </div>
      )}

      {/* The card. */}
      <motion.div
        ref={cardRef}
        className={cn(
          "absolute overflow-hidden rounded-2xl border border-emerald-500/30 bg-slate-900/90 p-5 text-white shadow-2xl shadow-black/60 backdrop-blur-xl",
          "max-h-[calc(100dvh-2rem)] overflow-y-auto ring-1 ring-inset ring-white/5"
        )}
        style={cardStyle}
        initial={cardInitial}
        animate={cardAnimate}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 210, damping: 24 }}
      >
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full opacity-40 blur-3xl" style={{ background: finale ? "rgba(251,191,36,0.6)" : current.glow }} />

        <AnimatePresence mode="wait" initial={false}>
          {finale ? (
            <motion.div
              key="finale"
              className="relative text-center"
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <FinaleMedal reduceMotion={reduceMotion} />
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">{COPY.finaleKicker[language]}</p>
              <h2 className="mt-1 text-xl font-extrabold tracking-tight">{COPY.finaleTitle[language]}</h2>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-300">{COPY.finaleBody[language]}</p>
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-300">
                <Sparkles className="h-3.5 w-3.5" /> {xp} XP
              </p>
              <button
                ref={primaryRef}
                type="button"
                onClick={onDone}
                className="press-feedback mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 via-cyan-400 to-fuchsia-400 text-[15px] font-extrabold text-slate-950 shadow-[0_0_30px_rgba(52,211,153,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {COPY.launch[language]}
                <ArrowRight className="h-4 w-4" />
              </button>
            </motion.div>
          ) : (
            <motion.div
              key={current.id}
              className="relative"
              initial={reduceMotion ? false : { opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -18 }}
              transition={{ duration: 0.2 }}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  {COPY.step[language]} {step + 1} {COPY.of[language]} {total}
                </span>
                <button
                  type="button"
                  onClick={onDone}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold text-slate-300 transition-colors hover:border-white/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  {COPY.skip[language]}
                  <X className="h-3 w-3" />
                </button>
              </div>

              <XpBar step={step} total={total} reduceMotion={reduceMotion} />
              <div className="mt-1.5 flex justify-end">
                <motion.span
                  key={xp}
                  className="text-[10px] font-bold tabular-nums text-emerald-300"
                  initial={reduceMotion ? false : { opacity: 0, y: 6, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 18 }}
                >
                  +{XP_PER_STEP} XP · {xp}/{total * XP_PER_STEP}
                </motion.span>
              </div>

              <div className="mt-2 flex items-start gap-3">
                <motion.span
                  className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white", current.gradient)}
                  style={{ boxShadow: `0 0 22px ${current.glow}, inset 0 1px 0 rgba(255,255,255,0.4)` }}
                  initial={reduceMotion ? false : { scale: 0.4, rotate: -25 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 380, damping: 16 }}
                >
                  <Icon className="h-5 w-5" strokeWidth={2.3} />
                </motion.span>
                <div className="min-w-0">
                  <span className={cn("inline-block rounded-md bg-gradient-to-r bg-clip-text text-[11px] font-black uppercase tracking-[0.14em] text-transparent", current.gradient)}>
                    {current.badge[language]}
                  </span>
                  <h2 className="text-[17px] font-extrabold leading-snug tracking-tight">{current.title[language]}</h2>
                </div>
              </div>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-300">{current.body[language]}</p>

              <div className="mt-5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={goBack}
                  disabled={step === 0}
                  aria-label={COPY.back[language]}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition-colors hover:border-white/25 hover:text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button
                  ref={primaryRef}
                  type="button"
                  onClick={goNext}
                  className="press-feedback flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 text-sm font-extrabold text-slate-950 shadow-[0_0_24px_rgba(52,211,153,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {step === total - 1 ? COPY.finish[language] : COPY.next[language]}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-3 hidden text-center text-[10px] text-slate-500 sm:block">{COPY.keys[language]}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
