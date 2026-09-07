"use client";

import { Kalam } from "next/font/google";
import { ArrowLeftRight, Droplet, Frown, Gauge, Scale, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

const kalam = Kalam({ subsets: ["latin"], weight: ["400", "700"] });

type Tone = "blue" | "orange" | "slate" | "purple";

const RIBBON_BG: Record<Tone, string> = {
  blue: "bg-blue-400 dark:bg-blue-600",
  orange: "bg-orange-300 dark:bg-orange-600",
  slate: "bg-slate-300 dark:bg-slate-700",
  purple: "bg-purple-300 dark:bg-purple-600",
};

const RIBBON_TEXT: Record<Tone, string> = {
  blue: "text-blue-950 dark:text-white",
  orange: "text-orange-950 dark:text-white",
  slate: "text-slate-950 dark:text-white",
  purple: "text-purple-950 dark:text-white",
};

/** Ribbon/banner section header — notched-hexagon clip-path, floating on the paper with no card underneath. Reserved for the 4 major zone titles only, per explicit instruction. */
function Ribbon({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <div
      className={cn("mx-auto mb-5 px-5 py-2 text-center text-sm font-bold uppercase tracking-wide shadow-sm", RIBBON_BG[tone], RIBBON_TEXT[tone], kalam.className)}
      style={{ clipPath: "polygon(0% 15%, 3% 0%, 97% 0%, 100% 15%, 100% 85%, 97% 100%, 3% 100%, 0% 85%)" }}
    >
      {children}
    </div>
  );
}

/** Yellow-highlighter marker effect behind a word. */
function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-block px-1">
      <span className="absolute inset-x-0 bottom-0.5 top-1 -rotate-1 rounded-sm bg-amber-300/80 dark:bg-amber-500/50" />
      <span className="relative">{children}</span>
    </span>
  );
}

/** Hand-drawn squiggle underline. */
function Squiggle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 14" className={cn("h-3 w-full", className)} preserveAspectRatio="none">
      <path d="M2 8 Q 20 2, 40 8 T 80 8 T 120 8 T 160 8 T 198 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Short curved hand-drawn connector arrow between two floating ideas — no box, just a stroke. */
function Connector({ className, flip }: { className?: string; flip?: boolean }) {
  return (
    <svg viewBox="0 0 40 28" className={cn("h-6 w-8 text-gray-300 dark:text-gray-700", className)}>
      <path
        d={flip ? "M36 4 Q 14 4 10 24" : "M4 4 Q 26 4 30 24"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        markerEnd="url(#conn-arrow)"
      />
      <defs>
        <marker id="conn-arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
        </marker>
      </defs>
    </svg>
  );
}

/** Hand-drawn mini lungs with an optional pleural-fluid line — a real illustration, not an icon-in-a-circle. */
function MiniLungs({ fluid, className }: { fluid?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 64 56" className={cn("h-10 w-11 shrink-0", className)}>
      <path d="M32 6 L32 20" stroke="#F87171" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M30 22 Q 8 20 6 40 Q 5 52 16 50 Q 26 48 28 34 Z" fill="#FCA5A5" stroke="#B91C1C" strokeWidth="1.5" />
      <path d="M34 22 Q 56 20 58 40 Q 59 52 48 50 Q 38 48 36 34 Z" fill="#FCA5A5" stroke="#B91C1C" strokeWidth="1.5" />
      {fluid && (
        <>
          <path d="M8 42 Q 16 46 26 42 L 27 49 Q 17 52 9 49 Z" fill="#60A5FA" opacity="0.85" />
          <path d="M38 42 Q 46 46 56 42 L 55 49 Q 45 52 37 49 Z" fill="#60A5FA" opacity="0.85" />
        </>
      )}
    </svg>
  );
}

/** Hand-drawn mini syringe performing a puncture — a real illustration. */
function MiniSyringe({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 26" className={cn("h-6 w-14 shrink-0", className)}>
      <line x1="2" y1="13" x2="14" y2="13" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="14" y="5" width="34" height="16" rx="3" fill="#E0F2FE" stroke="#0369A1" strokeWidth="1.5" />
      <rect x="18" y="8" width="16" height="10" fill="#38BDF8" opacity="0.7" />
      <rect x="48" y="9" width="8" height="8" fill="#CBD5E1" stroke="#64748B" strokeWidth="1" />
      <line x1="56" y1="13" x2="63" y2="13" stroke="#64748B" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Hand-drawn cartoon bacterium — smiling (harmless) or menacing (pathogenic), replacing a generic icon. */
function MiniBacteria({ mood, className }: { mood: "smile" | "danger"; className?: string }) {
  const fill = mood === "smile" ? "#86EFAC" : "#FCA5A5";
  const stroke = mood === "smile" ? "#166534" : "#991B1B";
  return (
    <svg viewBox="0 0 40 40" className={cn("h-8 w-8 shrink-0", className)}>
      <path d="M8 10 Q2 4 6 2" stroke={stroke} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path d="M32 10 Q38 4 34 2" stroke={stroke} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path d="M6 32 Q0 36 4 38" stroke={stroke} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path d="M34 32 Q40 36 36 38" stroke={stroke} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <ellipse cx="20" cy="20" rx="15" ry="13" fill={fill} stroke={stroke} strokeWidth="1.8" />
      {mood === "smile" ? (
        <>
          <circle cx="15" cy="17" r="1.6" fill={stroke} />
          <circle cx="25" cy="17" r="1.6" fill={stroke} />
          <path d="M14 24 Q20 29 26 24" stroke={stroke} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M12 15 L18 18 M18 15 L12 18" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M22 15 L28 18 M28 15 L22 18" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M14 26 Q20 22 26 26" stroke={stroke} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** Hand-drawn magnifying glass over a tiny cell — used for diagnostic/lab bullets. */
function MiniMagnifier({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("h-8 w-8 shrink-0", className)}>
      <circle cx="17" cy="17" r="12" fill="#F0FDF4" stroke="#334155" strokeWidth="2" />
      <line x1="26" y1="26" x2="36" y2="36" stroke="#334155" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="14" cy="15" r="2.5" fill="#4ADE80" />
      <circle cx="20" cy="19" r="1.8" fill="#22C55E" />
    </svg>
  );
}

/** Hand-drawn triangular warning sign — a real sign SHAPE, not a rectangular alert box. */
function WarningSign({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-auto flex flex-col items-center gap-2 text-center">
      <div className="relative flex h-20 w-24 items-center justify-center">
        <svg viewBox="0 0 100 90" className="absolute inset-0 h-full w-full drop-shadow-md">
          <polygon points="50,4 96,86 4,86" fill="#DC2626" stroke="#7F1D1D" strokeWidth="3" strokeLinejoin="round" />
          <text x="50" y="70" textAnchor="middle" fontSize="46" fontWeight="900" fill="white">
            !
          </text>
        </svg>
      </div>
      <p className={cn("text-sm font-black uppercase leading-tight text-red-700 dark:text-red-400", kalam.className)}>{title}</p>
      <p className="max-w-[15rem] text-xs leading-snug text-gray-600 dark:text-gray-400">{body}</p>
    </div>
  );
}

/** A floating idea: a small hand-drawn illustration beside a handwritten label + caption — no wrapping card. */
function FloatingIdea({ illustration, label, detail }: { illustration: React.ReactNode; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      {illustration}
      <div className="min-w-0 pt-0.5">
        <p className="text-sm font-bold leading-tight text-gray-900 dark:text-gray-100">{label}</p>
        {detail && <p className="mt-0.5 text-xs leading-snug text-gray-600 dark:text-gray-400">{detail}</p>}
      </div>
    </div>
  );
}

/** Organic "thought cloud" — an irregular blob with NO rigid border, just a soft tint + shadow, matching the reference's Focus callouts. */
function ThoughtCloud({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="mx-auto max-w-xs bg-white/70 px-5 py-4 shadow-md dark:bg-neutral-950/60"
      style={{ borderRadius: "42% 58% 65% 35% / 45% 45% 55% 55%" }}
    >
      <p className={cn("mb-2 text-center text-sm font-bold uppercase leading-tight text-slate-700 dark:text-slate-300", kalam.className)}>{title}</p>
      {children}
    </div>
  );
}

/** Two soft asymmetric blobs (no rigid border) linked by "vs" — an organic replacement for a comparison table. */
function VersusBubbles() {
  return (
    <div className="mt-2 flex items-start justify-center gap-3">
      <div className="w-[46%] bg-emerald-50/80 p-3 text-center shadow-sm dark:bg-emerald-950/30" style={{ borderRadius: "50% 50% 45% 55% / 60% 55% 45% 40%" }}>
        <p className={cn("text-xs font-black uppercase text-emerald-800 dark:text-emerald-300", kalam.className)}>Transsudat</p>
        <p className="mt-1 text-[10px] leading-snug text-emerald-700 dark:text-emerald-400">
          Protides &lt; 0,5 · LDH &lt; 0,6
          <br />
          Clair, jaune pâle
        </p>
      </div>
      <span className={cn("mt-4 text-lg font-black text-gray-400 dark:text-gray-600", kalam.className)}>vs</span>
      <div className="w-[46%] bg-orange-50/80 p-3 text-center shadow-sm dark:bg-orange-950/30" style={{ borderRadius: "55% 45% 50% 50% / 40% 45% 55% 60%" }}>
        <p className={cn("text-xs font-black uppercase text-orange-800 dark:text-orange-300", kalam.className)}>Exsudat</p>
        <p className="mt-1 text-[10px] leading-snug text-orange-700 dark:text-orange-400">
          Protides &gt; 0,5 · LDH &gt; 0,6
          <br />
          Aspect variable
        </p>
      </div>
    </div>
  );
}

/** Hand-drawn-style curved-arrow diagram for the atélectasie-vs-pleurésie mediastinal-shift trap — floating, no box around each panel. */
function MediastinDiagram() {
  return (
    <div className="mt-2 flex items-start justify-center gap-3">
      <div className="flex flex-col items-center gap-1">
        <svg viewBox="0 0 100 70" className="h-12 w-20">
          <path d="M6 8 h36 v54 h-36 Z" fill="#CBD5E1" opacity="0.6" />
          <path d="M58 12 h30 v46 h-30 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" className="text-slate-400" />
          <path d="M 50 6 Q 34 35 50 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-slate-600 dark:text-slate-300" markerEnd="url(#arrow-atelect)" />
          <defs>
            <marker id="arrow-atelect" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" className="fill-slate-600 dark:fill-slate-300" />
            </marker>
          </defs>
        </svg>
        <p className="text-[9px] font-bold uppercase text-slate-600 dark:text-slate-300">Atélectasie</p>
        <p className="text-[8px] leading-none text-slate-400 dark:text-slate-500">Médiastin ATTIRÉ</p>
      </div>
      <div className="flex flex-col items-center gap-1">
        <svg viewBox="0 0 100 70" className="h-12 w-20">
          <path d="M6 12 h30 v46 h-30 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" className="text-sky-400" />
          <path d="M58 8 h36 v54 h-36 Z" fill="#7DD3FC" opacity="0.7" />
          <path d="M 50 6 Q 66 35 50 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-sky-600 dark:text-sky-300" markerEnd="url(#arrow-pleur)" />
          <defs>
            <marker id="arrow-pleur" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" className="fill-sky-600 dark:fill-sky-300" />
            </marker>
          </defs>
        </svg>
        <p className="text-[9px] font-bold uppercase text-sky-700 dark:text-sky-300">Pleurésie</p>
        <p className="text-[8px] leading-none text-sky-500 dark:text-sky-500">Médiastin REPOUSSÉ</p>
      </div>
    </div>
  );
}

const LIGHT_CRITERIA = [
  { icon: Scale, text: "Protéines pleural / sérique > 0,5" },
  { icon: Droplet, text: "LDH pleural / sérique > 0,6" },
  { icon: Droplet, text: "LDH pleural > 2/3 de la limite sup. sérique" },
];

const LIQUID_ASPECTS = [
  { label: "Clair", color: "text-sky-500" },
  { label: "Hémorragique", color: "text-red-500" },
  { label: "Purulent", color: "text-amber-500" },
];

/**
 * ⚠️ 100% STATIC — hardcoded Masterclass revision sheet for "Pleurésie /
 * Épanchement Pleural", rebuilt to visually match a real NotebookLM-style
 * reference poster the user supplied (organic islands, ribbon banners,
 * thought-cloud callouts, a warning-sign shape — not a rigid card grid).
 * Every word of medical content here is plain React + Tailwind; no image
 * generation is involved at all in this version. Three separate attempts at
 * baking real medical text into a single Ideogram image were tried and
 * reverted (fabricated gibberish, mangled "Critères de Light", typos in
 * even a short title) — seeing this pattern repeat across a totally
 * different prompt each time is why this version drops Ideogram entirely
 * rather than trying a fourth prompt.
 *
 * Note: an even more free-form absolute-positioned "pêle-mêle" layout was
 * tried after this and reverted at the user's request as too disordered —
 * this flex-column-per-zone version (organized, no rigid boxes, but still
 * readable top-to-bottom per zone) is the intended stable baseline.
 */
export function MindMapStudio() {
  return (
    <div className="h-full w-full overflow-y-auto overflow-x-auto bg-[#FDFBF7] dark:bg-neutral-900">
      <div className="min-w-[1040px] p-8">
        {/* Bannière de titre */}
        <div className="mb-8 text-center">
          <h1 className={cn("text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100", kalam.className)}>
            Masterclass : Comprendre la <Highlight>Pleurésie</Highlight> &amp; les Épanchements Pleuraux
          </h1>
          <Squiggle className="mx-auto mt-1 w-64 text-gray-900 dark:text-gray-100" />
        </div>

        {/* Îlots organiques */}
        <div className="flex items-start justify-center gap-5">
          {/* Zone 1 — Fondamentaux & Sémiologie */}
          <div className="flex w-64 flex-1 flex-col gap-4">
            <Ribbon tone="blue">Fondamentaux &amp; Sémiologie</Ribbon>
            <FloatingIdea illustration={<MiniLungs fluid />} label="Triade de l'épanchement" detail="Matité + silence auscultatoire + abolition des VFR." />
            <Connector className="self-start ml-3" />
            <FloatingIdea illustration={<Gauge className="mt-0.5 h-6 w-6 shrink-0 text-blue-500" />} label="Matité franche" detail="À la percussion, sur la zone déclive." />
            <FloatingIdea illustration={<VolumeX className="mt-0.5 h-6 w-6 shrink-0 text-blue-500" />} label="VFR abolies" detail="Vibrations vocales absentes à la palpation." />
            <FloatingIdea illustration={<Frown className="mt-0.5 h-6 w-6 shrink-0 text-blue-500" />} label="Silence auscultatoire" detail="Murmure vésiculaire aboli en regard de l'épanchement." />
            <WarningSign title="Ponction en aveugle : jamais" body="Toujours guider par repérage échographique — risque de pneumothorax ou de plaie hépatique/splénique." />
          </div>

          {/* Zone 2 — Étiologies Exsudat */}
          <div className="flex w-64 flex-1 flex-col gap-4">
            <Ribbon tone="orange">Étiologies Exsudat</Ribbon>
            <FloatingIdea illustration={<MiniBacteria mood="danger" />} label="Pneumonie" detail="Para-pneumonique — liquide à polynucléaires, risque d'empyème." />
            <Connector className="self-end mr-3" flip />
            <FloatingIdea illustration={<MiniBacteria mood="danger" />} label="Cancer" detail="Métastases, mésothéliome — liquide hémorragique, cytologie +." />
            <FloatingIdea illustration={<MiniMagnifier />} label="Tuberculose" detail="Liquide lymphocytaire, ADA élevée." />
            <VersusBubbles />
          </div>

          {/* Zone 3 — Focus / Pièges */}
          <div className="flex w-64 flex-1 flex-col gap-4">
            <Ribbon tone="slate">Focus / Pièges</Ribbon>
            <div className="flex flex-1 items-center justify-center">
              <ThoughtCloud title="Atélectasie vs Pleurésie">
                <p className="mb-1 text-center text-[10px] text-slate-500 dark:text-slate-400">Piège du déplacement médiastinal</p>
                <MediastinDiagram />
              </ThoughtCloud>
            </div>
            <FloatingIdea illustration={<ArrowLeftRight className="mt-0.5 h-6 w-6 shrink-0 text-slate-500" />} label="À retenir" detail="Atélectasie attire le médiastin ; pleurésie le refoule." />
          </div>

          {/* Zone 4 — Critères de Light & Ponction Pleurale */}
          <div className="flex w-64 flex-1 flex-col gap-4">
            <Ribbon tone="purple">Critères de Light</Ribbon>
            <p className="-mt-3 text-center text-[10px] font-bold uppercase text-purple-700 dark:text-purple-400">Un seul critère positif suffit</p>
            <ul className="space-y-2.5">
              {LIGHT_CRITERIA.map((c, i) => {
                const Icon = c.icon;
                return (
                  <li key={i} className="flex items-center gap-2.5">
                    <span className={cn("text-sm font-black text-purple-500", kalam.className)}>{i + 1}.</span>
                    <Icon className="h-4 w-4 shrink-0 text-purple-500" />
                    <p className="text-xs font-semibold leading-snug text-gray-800 dark:text-gray-200">{c.text}</p>
                  </li>
                );
              })}
            </ul>
            <FloatingIdea illustration={<MiniSyringe className="mt-1" />} label="Ponction — Aspect du liquide" detail="Clair, hémorragique ou purulent." />
            <div className="flex justify-around">
              {LIQUID_ASPECTS.map((a, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <Droplet className={cn("h-6 w-6", a.color)} />
                  <p className="text-[9px] font-semibold text-gray-600 dark:text-gray-400">{a.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-[10px] text-gray-400 dark:text-gray-600">Fiche de révision — Med Art AI</p>
      </div>
    </div>
  );
}
