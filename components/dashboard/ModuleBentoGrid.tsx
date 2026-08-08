"use client";

import Link from "next/link";
import {
  Layers,
  Zap,
  Baby,
  Atom,
  FlaskConical,
  Users,
  FlaskRound,
  Cpu,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Prototype-only, fully static list for the 1ère Année Médecine onboarding
 * experiment — not fetched from `/api/modules` (that's the REAL, per-user
 * module list rendered further down the page in the "Mes Cours Récents"
 * section, completely unrelated to and untouched by this component). Only
 * "Anatomie" is wired to a route for this prototype; every other card is
 * intentionally inert per spec.
 *
 * Strictly the 1ère année modules — no out-of-year additions (e.g.
 * Pneumologie/Pleurésie lives on its own course card in "Mes Cours Récents"
 * instead, see components/dashboard/PublicCourseCard.tsx).
 *
 * Two visual identities coexist here on purpose: Anatomie/Cytologie already
 * have a real Ideogram-generated illustration (`imageUrl`), so they render
 * as a photo card; every other module doesn't have one yet, so it falls
 * back to its gradient + icon identity (`gradient`/`icon`) until its own
 * image is ready — at that point it just needs an `imageUrl` added below,
 * no component changes.
 */
interface BentoModule {
  name: string;
  slug: string;
  imageUrl?: string;
  gradient?: string;
  icon?: LucideIcon;
}

const YEAR_1_MODULES: BentoModule[] = [
  { name: "Anatomie", slug: "anatomie", imageUrl: "/images/modules/anatomie.jpg" },
  { name: "Cytologie", slug: "cytologie", imageUrl: "/images/modules/cytologie.jpg" },
  { name: "Histologie", slug: "histologie", gradient: "from-amber-500/80 to-orange-600/90", icon: Layers },
  { name: "Physiologie", slug: "physiologie", gradient: "from-emerald-500/80 to-teal-600/90", icon: Zap },
  { name: "Embryologie", slug: "embryologie", gradient: "from-pink-400/80 to-rose-500/90", icon: Baby },
  { name: "Biophysique", slug: "biophysique", gradient: "from-cyan-500/80 to-blue-600/90", icon: Atom },
  { name: "Biochimie", slug: "biochimie", gradient: "from-teal-500/80 to-emerald-600/90", icon: FlaskConical },
  { name: "S.S.H", slug: "ssh", gradient: "from-blue-500/80 to-indigo-600/90", icon: Users },
  { name: "Chimie", slug: "chimie", gradient: "from-fuchsia-500/80 to-purple-600/90", icon: FlaskRound },
  { name: "Informatique", slug: "informatique", gradient: "from-slate-600/80 to-zinc-700/90", icon: Cpu },
  { name: "Biostatistiques", slug: "biostatistiques", gradient: "from-sky-500/80 to-blue-600/90", icon: BarChart3 },
];

/** Only this module navigates anywhere for now — "Rend UNIQUEMENT la carte Anatomie cliquable". */
const ACTIVE_MODULE_SLUG = "anatomie";

/**
 * Real mastery %, computed server-side from actual qcm_attempts (see
 * app/dashboard/(shell)/page.tsx's progressByModuleName) — never a fabricated
 * number. `undefined` means "no real module of this name yet, or no QCM
 * attempted in it", rendered as an honest "Pas encore de données" instead of
 * a misleading 0% bar.
 */
function ProgressBlock({ progressPct }: { progressPct: number | undefined }) {
  if (progressPct === undefined) {
    return <p className="text-[11px] font-medium text-white/70">Pas encore de données</p>;
  }

  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-400 to-cyan-300 transition-all duration-500"
          style={{ width: `${Math.round(progressPct)}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] font-semibold text-white/90">{Math.round(progressPct)}% maîtrisé</p>
    </div>
  );
}

function ModuleCard({ mod, progressPct }: { mod: BentoModule; progressPct: number | undefined }) {
  const isActive = mod.slug === ACTIVE_MODULE_SLUG;
  const Icon = mod.icon;

  const card = (
    <div
      className={cn(
        "group relative aspect-[16/9] overflow-hidden rounded-2xl border transition-all duration-300 ease-out",
        // Light mode: crisp white card, subtle royal-blue border, soft ambient shadow at rest.
        "border-blue-300/60 bg-white shadow-xl shadow-blue-500/5 hover:border-blue-500 hover:shadow-[0_0_30px_rgba(59,130,246,0.25)]",
        // Dark mode: jet-black card, electric neon border/glow on hover.
        "dark:border-blue-500/30 dark:bg-slate-950 dark:shadow-none dark:hover:border-blue-400 dark:hover:shadow-[0_0_30px_rgba(59,130,246,0.4)]",
        isActive ? "cursor-pointer hover:scale-[1.02]" : "cursor-default opacity-95"
      )}
    >
      {mod.imageUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mod.imageUrl}
            alt={mod.name}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          {/* Bottom scrim guarantees the title/progress stay legible over the photo. */}
          <div className="absolute inset-x-0 bottom-0 space-y-1.5 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10">
            <p className="text-base font-bold leading-tight text-white drop-shadow-sm">{mod.name}</p>
            <ProgressBlock progressPct={progressPct} />
          </div>
        </>
      ) : (
        <>
          <div className={cn("absolute inset-0 bg-gradient-to-br", mod.gradient)} />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 pb-6">
            <div className="rounded-full bg-white/10 p-3 ring-2 ring-cyan-400/50 shadow-[0_0_20px_rgba(34,211,238,0.5)] backdrop-blur-sm transition-all duration-300 group-hover:scale-110 group-hover:shadow-[0_0_28px_rgba(34,211,238,0.7)]">
              {Icon && <Icon className="h-7 w-7 text-white" strokeWidth={1.5} />}
            </div>
            <p className="text-center text-sm font-bold leading-tight text-white drop-shadow-sm">{mod.name}</p>
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/30 to-transparent px-3 pb-2 pt-4">
            <ProgressBlock progressPct={progressPct} />
          </div>
        </>
      )}

      {!isActive && (
        <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-gray-700 shadow-sm dark:bg-neutral-950/80 dark:text-gray-300">
          Bientôt
        </span>
      )}
    </div>
  );

  if (!isActive) return card;

  return (
    <Link href={`/dashboard/modules/${mod.slug}`} className="block">
      {card}
    </Link>
  );
}

export function ModuleBentoGrid({ progressByModuleName }: { progressByModuleName?: Map<string, number> }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {YEAR_1_MODULES.map((mod) => (
        <ModuleCard
          key={mod.slug}
          mod={mod}
          progressPct={progressByModuleName?.get(mod.name.trim().toLowerCase())}
        />
      ))}
    </div>
  );
}
