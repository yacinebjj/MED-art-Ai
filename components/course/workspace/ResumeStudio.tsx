"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Flame,
  FileText,
  AlertTriangle,
  Stethoscope,
  Microscope,
  CheckCircle2,
  Zap,
  Crosshair,
  ShieldAlert,
  HeartPulse,
  Syringe,
  Clock,
  Activity,
  GraduationCap,
  XCircle,
  Siren,
  ClipboardList,
  Lightbulb,
  Info,
  LayoutGrid,
  Thermometer,
  BookOpen,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RESUME_MODES, RESUME_TOMBABILITE, type ResumeModeId } from "@/lib/demo-resume-content";

/** Only these modes remain selectable — every other mode (Ai Highlight, Clinical, One Page,
 * Color, Visual, DDx, Drug, Research, Patient-Friendly) has been removed from the UI.
 * Each one now renders its own bespoke, "Masterclass"-tier visual component below —
 * none of them fall back to plain markdown anymore. */
const KEPT_MODE_IDS: ResumeModeId[] = ["smart", "exam", "cheatsheet", "guideline", "professor", "astuces"];
const VISIBLE_MODES = RESUME_MODES.filter((m) => KEPT_MODE_IDS.includes(m.id));

/* ----------------------------------------------------------------------- */
/* Shared Framer Motion variants — every mode's content uses these.         */
/* ----------------------------------------------------------------------- */

const STAGGER_CONTAINER = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.1 },
  },
};

const FADE_UP = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 100, damping: 15 } },
};

const SCALE_IN = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 120, damping: 15 } },
};

/* ----------------------------------------------------------------------- */
/* "Smart Summary" mode — the rich, static "Masterclass" visual summary.     */
/* ----------------------------------------------------------------------- */

function MasterclassSummary() {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="w-full mx-auto space-y-10 font-sans text-slate-800 dark:text-slate-200 pb-4"
    >
      {/* 🚀 HEADER: Hero Section */}
      <motion.div variants={SCALE_IN} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 dark:from-slate-950 dark:to-slate-900 p-8 shadow-2xl border border-slate-700/50">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-cyan-500/20 blur-[80px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-64 h-64 bg-rose-500/20 blur-[80px] rounded-full pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="p-4 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-2xl shadow-lg shadow-cyan-500/30 text-white">
            <FileText className="w-10 h-10"/>
          </div>
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-cyan-500/20 text-cyan-300 rounded-full border border-cyan-500/30">
                Urgences Viscérales
              </span>
              <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-rose-500/20 text-rose-300 rounded-full border border-rose-500/30">
                Chirurgie
              </span>
            </div>
            <h1 className="text-3xl md:text-5xl font-black text-white uppercase tracking-tight mb-2 drop-shadow-md">
              MASTERCLASS : APPENDICITE AIGUË
            </h1>
            <p className="text-sm md:text-base font-medium text-slate-300 leading-relaxed max-w-2xl">
              Rapprochez-vous les amis, on va décortiquer ça ensemble. Pas de blabla, pas de remplissage — juste ce qu'il faut savoir, du <span className="text-cyan-400 font-bold">diagnostic clinique</span> jusqu'au <span className="text-rose-400 font-bold">geste opératoire</span>, comme si j'étais assis à côté de vous en salle de garde.
            </p>
          </div>
        </div>
      </motion.div>

      {/* 🚨 SECTION 1: Définitions & Urgences (Cartes Rouges) */}
      <motion.section variants={FADE_UP} className="space-y-5">
        <div className="flex items-center gap-3 border-b-2 border-rose-500/30 pb-3">
          <div className="p-2 bg-rose-500/10 rounded-lg text-rose-500"><AlertTriangle className="w-6 h-6"/></div>
          <h2 className="text-xl md:text-2xl font-black text-rose-600 dark:text-rose-400 uppercase tracking-wide">
            1. Urgence Chirurgicale Absolue
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-slate-900/50 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-rose-300 dark:hover:border-rose-500/50 transition-colors">
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4 text-rose-500"/> L'Essentiel
            </h3>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Si je vous réveille à 3h du matin, vous devez savoir que l'appendicite, c'est l'<span className="text-rose-600 dark:text-rose-400 font-bold">inflammation aiguë de l'appendice vermiforme</span> — la première cause de chirurgie abdominale en urgence au monde. Retenez bien ceci : le diagnostic reste <span className="text-blue-600 dark:text-blue-400 font-bold">clinique avant tout</span>. N'attendez jamais la biologie pour évoquer le tableau, elle arrive toujours trop tard pour vous couvrir.
            </p>
          </div>

          <div className="bg-rose-50 dark:bg-rose-950/40 p-5 rounded-2xl border border-rose-200 dark:border-rose-900/50 shadow-sm relative overflow-hidden">
            <div className="absolute right-0 top-0 w-32 h-32 bg-rose-500/10 blur-2xl rounded-full" />
            <h3 className="text-sm font-black text-rose-700 dark:text-rose-400 uppercase mb-2 flex items-center gap-2 relative z-10">
              <ShieldAlert className="w-4 h-4"/> Contre-indications Absolues
            </h3>
            <ul className="text-sm leading-relaxed text-rose-800 dark:text-rose-300 space-y-2 relative z-10 font-medium">
              <li>❌ Écoutez-moi bien : <span className="text-rose-700 dark:text-rose-300 font-black">jamais</span> de purgatifs ni de lavements devant ce tableau. Vous précipiteriez la <span className="text-rose-700 dark:text-rose-300 font-black">perforation</span> en majorant la pression intraluminale — c'est l'erreur qui transforme un patient stable en urgence vitale.</li>
              <li>❌ Et <span className="text-rose-700 dark:text-rose-300 font-black">jamais</span> d'antalgiques majeurs avant l'examen chirurgical. Ils masquent la défense, vous font perdre le fil, et faussent toute la surveillance évolutive.</li>
            </ul>
          </div>
        </div>
      </motion.section>

      {/* 🧬 SECTION 2: Physiopathologie (Timeline) */}
      <motion.section variants={FADE_UP} className="space-y-5">
        <div className="flex items-center gap-3 border-b-2 border-indigo-500/30 pb-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-500"><HeartPulse className="w-6 h-6"/></div>
          <h2 className="text-xl md:text-2xl font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
            2. Cascade Physiopathologique — Les 4 Stades Anatomo-Cliniques
          </h2>
        </div>

        <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
          Écoutez-moi bien, le mécanisme physiopathologique central ici, c'est tout bête : ça part toujours d'une <span className="text-indigo-600 dark:text-indigo-400 font-bold">obstruction de la lumière appendiculaire</span>. Une fois bouchée, la pression monte, la vascularisation trinque, et la maladie déroule sa cascade en quatre actes précis — je veux que vous puissiez les réciter les yeux fermés.
        </p>

        <div className="overflow-hidden rounded-2xl border border-indigo-100 dark:border-indigo-900/30 bg-white dark:bg-slate-900 shadow-lg">
          <table className="w-full text-left text-sm md:text-base border-collapse">
            <thead>
              <tr className="bg-indigo-50 dark:bg-indigo-950/50">
                <th className="p-4 font-black text-indigo-900 dark:text-indigo-300 border-b border-indigo-200 dark:border-indigo-800/50 w-1/4">Stade Lésionnel</th>
                <th className="p-4 font-black text-indigo-900 dark:text-indigo-300 border-b border-indigo-200 dark:border-indigo-800/50 w-1/3">Mécanisme & Aspect</th>
                <th className="p-4 font-black text-indigo-900 dark:text-indigo-300 border-b border-indigo-200 dark:border-indigo-800/50">Expression Clinique</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="p-4 font-bold text-indigo-600 dark:text-indigo-400">1. Catarrhale</td>
                <td className="p-4 text-slate-600 dark:text-slate-300">Ici, c'est encore discret : congestion vasculaire et <span className="text-indigo-600 dark:text-indigo-400 font-bold">œdème muqueux</span> réactionnels, rien de plus.</td>
                <td className="p-4 text-slate-600 dark:text-slate-300">Une douleur sourde, <span className="text-indigo-600 dark:text-indigo-400 font-bold">péri-ombilicale</span> — le tout premier signal, celui que tout le monde ignore.</td>
              </tr>
              <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="p-4 font-bold text-amber-600 dark:text-amber-500">2. Suppurée (Flegmoneuse)</td>
                <td className="p-4 text-slate-600 dark:text-slate-300">Ça s'aggrave : micro-abcès pariétaux, ulcérations muqueuses et <span className="text-amber-600 dark:text-amber-400 font-bold">fausses membranes</span> fibrino-leucocytaires.</td>
                <td className="p-4 text-slate-600 dark:text-slate-300">La douleur se <span className="text-amber-600 dark:text-amber-400 font-bold">fixe en FID</span>, la défense devient franche, fébricule à 38-38,5°C.</td>
              </tr>
              <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="p-4 font-bold text-orange-600 dark:text-orange-500">3. Gangréneuse</td>
                <td className="p-4 text-slate-600 dark:text-slate-300">Là, on n'a plus le temps de discuter : thrombose des vaisseaux appendiculaires, <span className="text-orange-600 dark:text-orange-400 font-bold">ischémie</span> puis nécrose pariétale transmurale.</td>
                <td className="p-4 text-slate-600 dark:text-slate-300">Fièvre &gt; 39°C, l'état général s'effondre, un <span className="text-orange-600 dark:text-orange-400 font-bold">plastron appendiculaire</span> devient palpable.</td>
              </tr>
              <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors bg-rose-50/50 dark:bg-rose-950/20">
                <td className="p-4 font-black text-rose-600 dark:text-rose-500">4. Perforée</td>
                <td className="p-4 text-slate-600 dark:text-slate-300">Et là, c'est le pire scénario : rupture pariétale, épanchement <span className="text-rose-600 dark:text-rose-400 font-bold">purulent ou stercoral</span> dans toute la cavité péritonéale.</td>
                <td className="p-4 text-rose-700 dark:text-rose-400 font-bold">Péritonite localisée ou généralisée — urgence vitale, on part au bloc immédiatement, sans discuter.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </motion.section>

      {/* 🩺 SECTION 3: Diagnostic (Grid Layout) */}
      <motion.section variants={FADE_UP} className="space-y-5">
        <div className="flex items-center gap-3 border-b-2 border-blue-500/30 pb-3">
          <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500"><Stethoscope className="w-6 h-6"/></div>
          <h2 className="text-xl md:text-2xl font-black text-blue-600 dark:text-blue-400 uppercase tracking-wide">
            3. Arsenal Diagnostique
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-md">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-3 font-black text-lg">1</div>
            <h3 className="font-bold text-slate-900 dark:text-white mb-2">Triade Clinique Classique</h3>
            <ul className="text-sm space-y-1.5 text-slate-600 dark:text-slate-400">
              <li>• Douleur <span className="text-blue-600 dark:text-blue-400 font-bold">migratrice</span> péri-ombilicale → FID</li>
              <li>• <span className="text-blue-600 dark:text-blue-400 font-bold">Anorexie</span> quasi-constante, nausées</li>
              <li>• Fébricule (38-38,5°C)</li>
            </ul>
          </div>

          <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-md">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-3"><Activity className="w-5 h-5"/></div>
            <h3 className="font-bold text-slate-900 dark:text-white mb-2">Biologie (NFS/CRP)</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              <span className="text-blue-600 dark:text-blue-400 font-bold">Hyperleucocytose à PNN</span> &gt; 10 000/mm³, CRP élevée et cinétique ascendante à H12. <br/>
              <span className="text-amber-600 dark:text-amber-400 font-semibold text-xs uppercase mt-2 block">⚠️ Et retenez bien : une biologie strictement normale n'élimine jamais le diagnostic.</span>
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-md">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-3"><Microscope className="w-5 h-5"/></div>
            <h3 className="font-bold text-slate-900 dark:text-white mb-2">Imagerie</h3>
            <ul className="text-sm space-y-1.5 text-slate-600 dark:text-slate-400">
              <li>• <span className="text-blue-600 dark:text-blue-400 font-bold">Échographie :</span> 1ère intention chez l'enfant et la femme enceinte — appendice incompressible, diamètre &gt; 6mm.</li>
              <li>• <span className="text-blue-600 dark:text-blue-400 font-bold">TDM injectée :</span> le gold standard chez l'adulte — sensibilité et spécificité &gt; 95%.</li>
            </ul>
          </div>
        </div>
      </motion.section>

      {/* 🎯 SECTION 4: Formes Cliniques Topographiques */}
      <motion.section variants={FADE_UP} className="space-y-5">
        <div className="flex items-center gap-3 border-b-2 border-amber-500/30 pb-3">
          <div className="p-2 bg-amber-500/10 rounded-lg text-amber-500"><Crosshair className="w-6 h-6"/></div>
          <h2 className="text-xl md:text-2xl font-black text-amber-600 dark:text-amber-400 uppercase tracking-wide">
            4. Formes Topographiques — Les Pièges Diagnostiques
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex gap-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="w-1.5 h-full bg-amber-400 rounded-full shrink-0" />
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white mb-1">Rétro-cæcale (65%)</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400">Celle-là, elle adore se cacher : appendice rétro-cæcal, douleur lombaire, <span className="text-amber-600 dark:text-amber-400 font-bold">psoïtis positif</span> (douleur à l'extension de cuisse). La défense est classiquement absente — le cæcum lui sert de bouclier. Pensez à la <span className="text-amber-600 dark:text-amber-400 font-bold">triade de Dieulafoy</span>, ici souvent incomplète.</p>
            </div>
          </div>

          <div className="flex gap-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="w-1.5 h-full bg-amber-500 rounded-full shrink-0" />
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white mb-1">Pelvienne (30%)</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400">Irritation pelvienne : pollakiurie, ténesme rectal, parfois diarrhée. Le <span className="text-amber-600 dark:text-amber-400 font-bold">toucher rectal</span> déclenche une douleur vive au cul-de-sac de Douglas droit — un piège classique pris pour une simple cystite.</p>
            </div>
          </div>

          <div className="flex gap-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="w-1.5 h-full bg-amber-600 rounded-full shrink-0" />
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white mb-1">Sous-hépatique</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400">Migration ascendante sous le rebord hépatique. Douleur de l'hypochondre droit mimant à s'y méprendre une <span className="text-amber-600 dark:text-amber-400 font-bold">cholécystite aiguë</span> — une échographie hépatobiliaire normale doit vous faire reconsidérer le diagnostic.</p>
            </div>
          </div>

          <div className="flex gap-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="w-1.5 h-full bg-amber-700 rounded-full shrink-0" />
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white mb-1">Méso-cœliaque</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400">Appendice noyé au milieu des anses grêles. Tableau trompeur d'<span className="text-amber-600 dark:text-amber-400 font-bold">occlusion fébrile</span> par iléus réflexe précoce — un piège classique chez le sujet âgé.</p>
            </div>
          </div>
        </div>
      </motion.section>

      {/* 🧮 SECTION 5: Alvarado & Traitement (Split Layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Score d'Alvarado */}
        <motion.section variants={FADE_UP} className="space-y-4 bg-cyan-50 dark:bg-cyan-950/20 p-6 rounded-3xl border border-cyan-100 dark:border-cyan-900/50">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-6 h-6 text-cyan-600 dark:text-cyan-400"/>
            <h2 className="text-lg font-black text-cyan-700 dark:text-cyan-300 uppercase">
              5. Score d'Alvarado (MANTRELS)
            </h2>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Rapprochez-vous, ce chiffre-là décide de tout : trois zones, trois attitudes.
          </p>
          <div className="space-y-3">
            <div className="flex justify-between items-center bg-white dark:bg-slate-900 p-3 rounded-lg shadow-sm">
              <span className="font-bold text-slate-700 dark:text-slate-200">Score &lt; 4</span>
              <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-full">Surveillance simple</span>
            </div>
            <div className="flex justify-between items-center bg-white dark:bg-slate-900 p-3 rounded-lg shadow-sm border-l-4 border-amber-400">
              <span className="font-bold text-slate-700 dark:text-slate-200">Score 5-6</span>
              <span className="px-3 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-bold rounded-full">Imagerie complémentaire</span>
            </div>
            <div className="flex justify-between items-center bg-white dark:bg-slate-900 p-3 rounded-lg shadow-sm border-l-4 border-rose-500">
              <span className="font-bold text-slate-700 dark:text-slate-200">Score ≥ 7</span>
              <span className="px-3 py-1 bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 text-xs font-bold rounded-full">Indication opératoire formelle</span>
            </div>
          </div>
        </motion.section>

        {/* Traitement */}
        <motion.section variants={FADE_UP} className="space-y-4 bg-emerald-50 dark:bg-emerald-950/20 p-6 rounded-3xl border border-emerald-100 dark:border-emerald-900/50">
          <div className="flex items-center gap-2 mb-4">
            <Syringe className="w-6 h-6 text-emerald-600 dark:text-emerald-400"/>
            <h2 className="text-lg font-black text-emerald-700 dark:text-emerald-300 uppercase">
              6. Règles Thérapeutiques — Les Réflexes à Avoir
            </h2>
          </div>
          <ul className="space-y-4 text-sm md:text-base text-slate-700 dark:text-slate-300">
            <li className="flex gap-3 items-start">
              <div className="mt-1 bg-emerald-200 dark:bg-emerald-800/50 p-1 rounded text-emerald-700 dark:text-emerald-400"><Crosshair className="w-3 h-3"/></div>
              <div><span className="text-emerald-600 dark:text-emerald-400 font-bold">Chirurgie :</span> appendicectomie en urgence. La <span className="text-emerald-600 dark:text-emerald-400 font-bold">cœlioscopie</span> est votre voie de référence — exploration complète de la cavité et lavage péritonéal au moindre doute.</div>
            </li>
            <li className="flex gap-3 items-start">
              <div className="mt-1 bg-emerald-200 dark:bg-emerald-800/50 p-1 rounded text-emerald-700 dark:text-emerald-400"><Zap className="w-3 h-3"/></div>
              <div><span className="text-emerald-600 dark:text-emerald-400 font-bold">Antibioprophylaxie :</span> dose unique péri-opératoire systématique (Céphalosporine + Métronidazole), ciblant la flore aéro-anaérobie digestive.</div>
            </li>
            <li className="flex gap-3 items-start">
              <div className="mt-1 bg-emerald-200 dark:bg-emerald-800/50 p-1 rounded text-emerald-700 dark:text-emerald-400"><Clock className="w-3 h-3"/></div>
              <div>Et retenez bien celle-ci, c'est un classique du piège d'examen : le <span className="text-emerald-600 dark:text-emerald-400 font-bold">plastron appendiculaire</span> est une contre-indication formelle à la chirurgie immédiate. Antibiothérapie IV d'abord (« à chaud »), puis appendicectomie différée « à froid » à 2-3 mois.</div>
            </li>
          </ul>
        </motion.section>

      </div>
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* "Exam Summary" mode — high-yield facts, DDx comparison table, exam traps. */
/* ----------------------------------------------------------------------- */

function ExamSummaryContent() {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="w-full mx-auto space-y-10 font-sans text-slate-800 dark:text-slate-200 pb-4"
    >
      <motion.div variants={SCALE_IN} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-600 to-amber-600 dark:from-orange-900 dark:to-amber-950 p-8 shadow-2xl border border-orange-400/30">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-white/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-64 h-64 bg-black/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="p-4 bg-white/20 backdrop-blur-md rounded-2xl shadow-lg text-white">
            <GraduationCap className="w-10 h-10"/>
          </div>
          <div>
            <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-white/20 text-white rounded-full border border-white/30">
              Points Clés ECN
            </span>
            <h1 className="text-3xl md:text-5xl font-black text-white uppercase tracking-tight mt-2 mb-2 drop-shadow-md">
              Exam Summary — Les Incontournables
            </h1>
            <p className="text-sm md:text-base font-medium text-orange-50 leading-relaxed max-w-2xl">
              Écoutez bien les amis : voici tout ce que le jury <strong>adore</strong> vous tendre comme perche, et tout ce que les <strong>pièges</strong> cachent derrière un énoncé qui a l'air anodin. Zéro remplissage, que du <em>haut rendement</em> — le genre de fiche qu'on relit dans le couloir juste avant d'entrer en salle.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Section : DDx */}
      <motion.section variants={FADE_UP} className="space-y-5">
        <div className="flex items-center gap-3 border-b-2 border-orange-500/30 pb-3">
          <div className="p-2 bg-orange-500/10 rounded-lg text-orange-500"><Stethoscope className="w-6 h-6"/></div>
          <h2 className="text-xl md:text-2xl font-black text-orange-600 dark:text-orange-400 uppercase tracking-wide">
            Diagnostics Différentiels — Le Tableau Qui Sauve
          </h2>
        </div>

        <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
          Retenez cette astuce en or avant même d'ouvrir le tableau : la douleur de l'appendicite <strong>migre</strong> parce qu'elle change de nature. Au début, c'est l'appendice enflammé qui tire sur son péritoine viscéral — un tissu peu innervé, incapable de localiser précisément la douleur, qui l'envoie donc en <em>vague et diffuse</em> autour de l'ombilic (le fameux territoire du nerf splanchnique, celui de tout l'intestin moyen embryonnaire). Puis, quand l'inflammation gagne le péritoine pariétal en regard — richement innervé, lui, par les nerfs somatiques de la paroi — la douleur devient brutalement <strong>précise, ponctuelle, en FID</strong>. C'est cette bascule viscéro-pariétale qui explique la fameuse migration décrite par toutes les études : elle n'est pas un détail anecdotique, elle est la <em>signature physiopathologique</em> de la maladie. Gardez ce mécanisme en tête pour chaque ligne du tableau ci-dessous : c'est lui qui distingue une urgence chirurgicale d'un simple mal de ventre.
        </p>

        <div className="overflow-hidden rounded-2xl border border-orange-100 dark:border-orange-900/30 shadow-lg">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-gradient-to-r from-orange-600 to-amber-600 dark:from-orange-800 dark:to-amber-800">
                <th className="p-3 font-black text-white">Diagnostic</th>
                <th className="p-3 font-black text-white">Douleur</th>
                <th className="p-3 font-black text-white">Signe Clé</th>
                <th className="p-3 font-black text-white">Ce Qui Distingue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
              <tr className="bg-rose-50/60 dark:bg-rose-950/30">
                <td className="p-3 font-black text-rose-600 dark:text-rose-400">Appendicite Aiguë</td>
                <td className="p-3 text-slate-700 dark:text-slate-300">Péri-ombilicale <strong>migrant</strong> vers la FID en 12-24h</td>
                <td className="p-3 text-slate-700 dark:text-slate-300">Blumberg +, McBurney +, Rovsing +</td>
                <td className="p-3 text-slate-700 dark:text-slate-300">Hyperleucocytose à PNN + CRP ↑ en cinétique — c'est <em>la</em> référence à laquelle on compare toutes les lignes suivantes</td>
              </tr>
              <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="p-3 font-bold text-slate-800 dark:text-slate-200">Gastro-Entérite Aiguë</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Diffuse, crampes, précède les vomissements</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Diarrhée <strong>précoce</strong>, contexte de collectivité</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Le piège classique : ici, la douleur ne <em>fixe</em> jamais en FID et l'abdomen reste souple à la palpation</td>
              </tr>
              <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="p-3 font-bold text-slate-800 dark:text-slate-200">Salpingite (IGH)</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Pelvienne bilatérale, post-coïtale parfois</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Douleur à la mobilisation utérine, leucorrhées</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Contexte à risque IST, <strong>bilatéralité</strong> — l'appendicite, elle, ne fait jamais mal à gauche</td>
              </tr>
              <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="p-3 font-bold text-slate-800 dark:text-slate-200">Colique Néphrétique Droite</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Lombaire, à paroxysmes, irradiant vers les OGE</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Patient <em>agité</em>, incapable de tenir en place</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">L'appendiculaire, lui, reste <strong>immobile</strong>, recroquevillé — une différence sémiologique qui saute aux yeux dès l'entrée dans la chambre</td>
              </tr>
              <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="p-3 font-bold text-slate-800 dark:text-slate-200">GEU (Grossesse Extra-Utérine)</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">FID/pelvienne, parfois brutale et syncopale</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Retard de règles, métrorragies noirâtres</td>
                <td className="p-3 text-slate-600 dark:text-slate-400"><strong>β-hCG systématique</strong> chez toute femme en âge de procréer — ici, on ne pardonne pas l'oubli</td>
              </tr>
              <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="p-3 font-bold text-slate-800 dark:text-slate-200">Torsion d'Annexe</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Brutale, syncopale, en coup de poignard</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Masse annexielle échographique, Doppler pauvre</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Doppler ovarien absent = urgence chirurgicale <em>immédiate</em>, chaque minute compte pour sauver l'ovaire</td>
              </tr>
              <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="p-3 font-bold text-slate-800 dark:text-slate-200">Diverticule de Meckel (compliqué)</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Péri-ombilicale, FID — un vrai sosie clinique</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Rectorragies possibles chez l'enfant</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Diagnostic souvent <em>peropératoire</em> : on l'évoque quand l'appendice retiré est macroscopiquement sain</td>
              </tr>
              <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="p-3 font-bold text-slate-800 dark:text-slate-200">Adénolymphite Mésentérique</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Diffuse, mobile, typique de l'enfant</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Contexte viral ORL récent, fièvre modérée</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Échographie : ganglions mésentériques hypertrophiés, appendice <strong>sain</strong> — le piège pédiatrique numéro un</td>
              </tr>
              <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="p-3 font-bold text-slate-800 dark:text-slate-200">Pyélonéphrite Droite</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Lombaire, irradiant parfois en FID</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">Fièvre élevée en clocher, brûlures mictionnelles</td>
                <td className="p-3 text-slate-600 dark:text-slate-400">BU/ECBU positive, <strong>contact lombaire</strong> douloureux — pensez toujours à la bandelette avant de courir au bloc</td>
              </tr>
            </tbody>
          </table>
        </div>
      </motion.section>

      {/* Section : Pièges — master-grid exhaustif, catégorisé */}
      <motion.section variants={FADE_UP} className="space-y-8">
        <div className="flex items-center gap-3 border-b-2 border-rose-500/30 pb-3">
          <div className="p-2 bg-rose-500/10 rounded-lg text-rose-500"><AlertTriangle className="w-6 h-6"/></div>
          <h2 className="text-xl md:text-2xl font-black text-rose-600 dark:text-rose-400 uppercase tracking-wide">
            Pièges à l'Examen — Le Master-Grid Complet
          </h2>
        </div>

        <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
          La biologie ne fait pas le diagnostic, retenez bien ça : l'appendicite se joue à l'oreille et à la main, pas au labo. Voici quinze pièges classés par famille — cliniques, biologiques, radiologiques, et terrain particulier — pour que plus rien ne puisse vous surprendre le jour J.
        </p>

        {/* Catégorie : Pièges Cliniques */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-rose-600 text-white text-xs font-black uppercase tracking-wide">Pièges Cliniques</span>
            <span className="h-px flex-1 bg-rose-200 dark:bg-rose-900/40" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative overflow-hidden p-5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-300 dark:border-rose-500/40 shadow-[0_0_25px_-8px_rgba(244,63,94,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-rose-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-rose-700 dark:text-rose-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°1</h3>
              <p className="text-sm text-rose-800 dark:text-rose-300 relative z-10">Confondre la phase <strong>viscérale</strong> (péri-ombilicale, floue) et la phase <strong>pariétale</strong> (FID, précise) : si vous ne savez pas expliquer <em>pourquoi</em> la douleur migre, vous ne comprenez pas la maladie — vous ne faites que la réciter.</p>
            </div>

            <div className="relative overflow-hidden p-5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-300 dark:border-rose-500/40 shadow-[0_0_25px_-8px_rgba(244,63,94,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-rose-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-rose-700 dark:text-rose-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°2</h3>
              <p className="text-sm text-rose-800 dark:text-rose-300 relative z-10">Écoutez-moi bien les amis, le piège mortel ici c'est la forme <strong>rétro-cæcale</strong> : le cæcum fait écran, la défense pariétale classique <em>n'apparaît quasiment jamais</em>. Le seul signal qui reste, c'est le psoïtis — douleur à l'extension passive de la cuisse droite. Si vous ne le cherchez pas, vous passez à côté.</p>
            </div>

            <div className="relative overflow-hidden p-5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-300 dark:border-rose-500/40 shadow-[0_0_25px_-8px_rgba(244,63,94,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-rose-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-rose-700 dark:text-rose-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°3</h3>
              <p className="text-sm text-rose-800 dark:text-rose-300 relative z-10">Ne vous faites jamais avoir par une forme <strong>pelvienne</strong> : l'appendice irrite le rectum et la vessie, pas la paroi antérieure. Ténesme rectal et pollakiurie sont pris à tort pour une cystite ou une rectite — l'abdomen, lui, reste étonnamment souple.</p>
            </div>

            <div className="relative overflow-hidden p-5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-300 dark:border-rose-500/40 shadow-[0_0_25px_-8px_rgba(244,63,94,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-rose-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-rose-700 dark:text-rose-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°4</h3>
              <p className="text-sm text-rose-800 dark:text-rose-300 relative z-10">Le QCM classique va essayer de vous piéger sur la forme <strong>sous-hépatique</strong> : migration ascendante de l'appendice sous le rebord hépatique, douleur de l'hypochondre droit mimant à s'y méprendre une <em>cholécystite aiguë</em>. Une échographie hépatobiliaire normale doit vous faire reconsidérer le diagnostic.</p>
            </div>
          </div>
        </div>

        {/* Catégorie : Pièges Biologiques */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-blue-600 text-white text-xs font-black uppercase tracking-wide">Pièges Biologiques</span>
            <span className="h-px flex-1 bg-blue-200 dark:bg-blue-900/40" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative overflow-hidden p-5 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border-2 border-blue-300 dark:border-blue-500/40 shadow-[0_0_25px_-8px_rgba(59,130,246,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-blue-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-blue-700 dark:text-blue-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°5</h3>
              <p className="text-sm text-blue-800 dark:text-blue-300 relative z-10">La biologie ne fait pas le diagnostic, retenez bien ça : une NFS-CRP <strong>normale</strong> n'élimine <em>jamais</em> le diagnostic dans les 6 premières heures d'évolution. La biologie a besoin de temps pour s'affoler — le patient, lui, n'attend pas.</p>
            </div>

            <div className="relative overflow-hidden p-5 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border-2 border-blue-300 dark:border-blue-500/40 shadow-[0_0_25px_-8px_rgba(59,130,246,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-blue-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-blue-700 dark:text-blue-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°6</h3>
              <p className="text-sm text-blue-800 dark:text-blue-300 relative z-10">Ne vous faites jamais avoir par une CRP isolée : c'est la <strong>cinétique</strong> qui parle, pas le chiffre unique. Un premier dosage normal suivi d'un second en hausse pèse plus lourd qu'une valeur ponctuelle rassurante à H2.</p>
            </div>

            <div className="relative overflow-hidden p-5 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border-2 border-blue-300 dark:border-blue-500/40 shadow-[0_0_25px_-8px_rgba(59,130,246,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-blue-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-blue-700 dark:text-blue-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°7</h3>
              <p className="text-sm text-blue-800 dark:text-blue-300 relative z-10">Oublier le <strong>β-hCG</strong> chez toute femme en âge de procréer — la GEU tue plus vite qu'elle n'attend, et le jury adore glisser une héroïne de 22 ans dans l'énoncé pour voir qui l'a oublié.</p>
            </div>

            <div className="relative overflow-hidden p-5 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border-2 border-blue-300 dark:border-blue-500/40 shadow-[0_0_25px_-8px_rgba(59,130,246,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-blue-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-blue-700 dark:text-blue-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°8</h3>
              <p className="text-sm text-blue-800 dark:text-blue-300 relative z-10">Attention au piège de la bandelette urinaire faussement positive : un appendice enflammé au contact de l'uretère droit peut irriter la voie urinaire et donner quelques leucocytes dans les urines — on vous tend alors le tableau d'une pyélonéphrite pour vous détourner du bon diagnostic.</p>
            </div>
          </div>
        </div>

        {/* Catégorie : Pièges Radiologiques */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-purple-600 text-white text-xs font-black uppercase tracking-wide">Pièges Radiologiques</span>
            <span className="h-px flex-1 bg-purple-200 dark:bg-purple-900/40" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative overflow-hidden p-5 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border-2 border-purple-300 dark:border-purple-500/40 shadow-[0_0_25px_-8px_rgba(168,85,247,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-purple-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-purple-700 dark:text-purple-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°9</h3>
              <p className="text-sm text-purple-800 dark:text-purple-300 relative z-10">Ne vous faites jamais avoir par une échographie « non concluante » : appendice non visualisé ne veut pas dire appendice sain. Une écho qui ne conclut pas doit systématiquement pousser vers une TDM chez l'adulte, pas vers un retour à domicile rassurant.</p>
            </div>

            <div className="relative overflow-hidden p-5 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border-2 border-purple-300 dark:border-purple-500/40 shadow-[0_0_25px_-8px_rgba(168,85,247,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-purple-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-purple-700 dark:text-purple-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°10</h3>
              <p className="text-sm text-purple-800 dark:text-purple-300 relative z-10">Le QCM classique va essayer de vous piéger sur l'irradiation chez la femme enceinte : le réflexe scanner systématique est une faute. L'échographie reste la première intention, l'IRM le recours en cas de doute — la TDM injectée n'est envisagée qu'en dernier ressort.</p>
            </div>

            <div className="relative overflow-hidden p-5 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border-2 border-purple-300 dark:border-purple-500/40 shadow-[0_0_25px_-8px_rgba(168,85,247,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-purple-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-purple-700 dark:text-purple-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°11</h3>
              <p className="text-sm text-purple-800 dark:text-purple-300 relative z-10">Attention au diamètre « limite » : un appendice mesuré à 5-6mm est une <em>zone grise</em>, pas un résultat négatif. Sans compressibilité normale et sans contexte clinique rassurant, ce chiffre-frontière ne doit jamais clore le dossier à lui seul.</p>
            </div>
          </div>
        </div>

        {/* Catégorie : Terrain Particulier */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-amber-500 text-white text-xs font-black uppercase tracking-wide">Terrain Particulier</span>
            <span className="h-px flex-1 bg-amber-200 dark:bg-amber-900/40" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative overflow-hidden p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-500/40 shadow-[0_0_25px_-8px_rgba(245,158,11,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-amber-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°12</h3>
              <p className="text-sm text-amber-800 dark:text-amber-300 relative z-10">Attention au tableau trompeur chez le sujet âgé : pas de fièvre franche, pas de défense franche, et pourtant le péritoine se remplit en silence. On parle d'appendicite <strong>torpide</strong> — c'est la population où l'on perfore le plus, précisément parce qu'on la sous-estime.</p>
            </div>

            <div className="relative overflow-hidden p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-500/40 shadow-[0_0_25px_-8px_rgba(245,158,11,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-amber-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°13</h3>
              <p className="text-sm text-amber-800 dark:text-amber-300 relative z-10">Chez la <strong>femme enceinte</strong>, l'appendice migre avec l'utérus qui le repousse — au 3ème trimestre, il peut se loger sous les côtes droites. Ne vous faites jamais avoir : une douleur haute chez une femme enceinte n'élimine pas l'appendicite, elle la déplace juste sur l'organigramme.</p>
            </div>

            <div className="relative overflow-hidden p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-500/40 shadow-[0_0_25px_-8px_rgba(245,158,11,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-amber-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°14</h3>
              <p className="text-sm text-amber-800 dark:text-amber-300 relative z-10">Chez l'enfant de moins de 5 ans, oubliez la triade classique — diarrhée et irritabilité isolée doivent déjà alerter. Imaginez un peu la scène : un enfant fébrile, un rhume la semaine passée, un ventre diffusément sensible — avant de crier à l'appendicite, pensez à l'adénolymphite mésentérique, sinon c'est une appendicectomie blanche qui vous attend.</p>
            </div>

            <div className="relative overflow-hidden p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-500/40 shadow-[0_0_25px_-8px_rgba(245,158,11,0.4)]">
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-amber-500/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="font-black text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-2 relative z-10"><XCircle className="w-4 h-4"/> Piège n°15</h3>
              <p className="text-sm text-amber-800 dark:text-amber-300 relative z-10">Quel que soit le terrain, un score d'Alvarado <strong>≥ 7</strong> impose l'avis chirurgical direct — n'attendez pas l'imagerie pour faire plaisir au radiologue. Ici, on ne pardonne pas l'erreur de temporisation : l'avis chirurgical prime toujours sur le bilan complémentaire.</p>
            </div>
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* "Cheat Sheet" mode — dense, color-coded dashboard grid.                  */
/* ----------------------------------------------------------------------- */

function CheatSheetContent() {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="w-full mx-auto space-y-8 font-sans text-slate-800 dark:text-slate-200 pb-4"
    >
      <motion.div variants={SCALE_IN} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 to-indigo-950 dark:from-slate-950 dark:to-indigo-950 p-6 shadow-2xl border border-indigo-500/20">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-56 h-56 bg-indigo-500/20 blur-[80px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-3 bg-white/10 backdrop-blur-md rounded-xl text-white"><LayoutGrid className="w-8 h-8"/></div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-white uppercase tracking-tight">Cheat Sheet — Vue Dashboard</h1>
            <p className="text-xs md:text-sm text-indigo-200 mt-1">Tout ce qu'il faut avoir en tête <strong>trente secondes avant d'entrer en garde.</strong> Zéro superflu, que des chiffres qui comptent.</p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Symptômes — rouge */}
        <motion.div variants={FADE_UP} className="rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 p-4 shadow-md">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-rose-500 rounded-lg text-white"><Thermometer className="w-4 h-4"/></div>
            <h3 className="font-black text-rose-700 dark:text-rose-400 text-sm uppercase">Symptômes</h3>
          </div>
          <div className="space-y-1.5">
            <span className="block px-2 py-1 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-xs font-bold">Douleur péri-ombilicale → FID en 12-24h</span>
            <span className="block px-2 py-1 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-xs font-bold">Anorexie quasi-constante (90%)</span>
            <span className="block px-2 py-1 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-xs font-bold">Nausées / vomissements <em>après</em> la douleur</span>
            <span className="block px-2 py-1 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-xs font-bold">Fébricule 38-38,5°C — jamais très haut</span>
            <span className="block px-2 py-1 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-xs font-bold">Blumberg +, Rovsing +, Psoas +</span>
            <span className="block px-2 py-1 rounded-full bg-rose-200 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200 text-xs font-black">🚨 Défense = urgence, pas de délai</span>
            <span className="block px-2 py-1 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-xs italic">🧠 Mnémo : « anorexie sans douleur = pas d'appendicite »</span>
          </div>
        </motion.div>

        {/* Labs — bleu */}
        <motion.div variants={FADE_UP} className="rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 p-4 shadow-md">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-blue-500 rounded-lg text-white"><Activity className="w-4 h-4"/></div>
            <h3 className="font-black text-blue-700 dark:text-blue-400 text-sm uppercase">Labos</h3>
          </div>
          <div className="space-y-1.5">
            <span className="block px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold">Hyperleucocytose &gt; 10 000/mm³ à PNN</span>
            <span className="block px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold">CRP ↑ en cinétique ascendante à H12</span>
            <span className="block px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold">β-hCG systématique (femme en âge de procréer)</span>
            <span className="block px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold">BU/ECBU pour éliminer pyélonéphrite</span>
            <span className="block px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold">Bilan pré-opératoire (groupe, RAI, hémostase)</span>
            <span className="block px-2 py-1 rounded-full bg-blue-200 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 text-xs font-black">Biologie normale ≠ diagnostic éliminé</span>
            <span className="block px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs italic">🧠 Mnémo : « CRP qui monte vaut mieux que CRP unique »</span>
          </div>
        </motion.div>

        {/* Imagerie — violet */}
        <motion.div variants={FADE_UP} className="rounded-2xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/40 p-4 shadow-md">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-purple-500 rounded-lg text-white"><Microscope className="w-4 h-4"/></div>
            <h3 className="font-black text-purple-700 dark:text-purple-400 text-sm uppercase">Imagerie</h3>
          </div>
          <div className="space-y-1.5">
            <span className="block px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs font-bold">Écho : 1ère intention enfant / femme enceinte</span>
            <span className="block px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs font-bold">TDM injectée : gold standard adulte</span>
            <span className="block px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs font-bold">IRM : alternative si doute + grossesse</span>
            <span className="block px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs font-bold">Sensibilité/spécificité TDM &gt; 95%</span>
            <span className="block px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs font-bold">Appendice incompressible à l'écho</span>
            <span className="block px-2 py-1 rounded-full bg-purple-200 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200 text-xs font-black">Seuil retenu : diamètre &gt; 6mm</span>
            <span className="block px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs italic">🧠 Mnémo : « pas d'écho concluante = TDM, pas de round 2 »</span>
          </div>
        </motion.div>

        {/* Traitement — émeraude */}
        <motion.div variants={FADE_UP} className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 p-4 shadow-md">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-emerald-500 rounded-lg text-white"><Syringe className="w-4 h-4"/></div>
            <h3 className="font-black text-emerald-700 dark:text-emerald-400 text-sm uppercase">Traitement</h3>
          </div>
          <div className="space-y-1.5">
            <span className="block px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold">Appendicectomie cœlioscopique en urgence</span>
            <span className="block px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold">Antibioprophylaxie : dose unique péri-op</span>
            <span className="block px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold">Céphalosporine + Métronidazole (aéro-anaérobie)</span>
            <span className="block px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold">Plastron : ATB IV « à chaud », chirurgie à 2-3 mois « à froid »</span>
            <span className="block px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold">Lavage péritonéal systématique si perforation</span>
            <span className="block px-2 py-1 rounded-full bg-emerald-200 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 text-xs font-black">Urgence chirurgicale, jamais différée</span>
            <span className="block px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs italic">🧠 Mnémo : « purgatif = pousser vers la perforation »</span>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* "Guideline Summary" mode — vertical clinical-pathway timeline.           */
/* ----------------------------------------------------------------------- */

function GuidelineSummaryContent() {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="w-full mx-auto space-y-8 font-sans text-slate-800 dark:text-slate-200 pb-4"
    >
      <motion.div variants={SCALE_IN} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 to-cyan-700 dark:from-teal-900 dark:to-cyan-950 p-8 shadow-2xl border border-teal-400/30">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-white/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-4 bg-white/15 backdrop-blur-md rounded-2xl shadow-lg text-white">
            <ClipboardList className="w-10 h-10"/>
          </div>
          <div>
            <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-white/20 text-white rounded-full border border-white/30">
              Parcours Clinique Officiel
            </span>
            <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-tight mt-2">
              Guideline Summary
            </h1>
            <p className="text-sm text-teal-50 mt-1 max-w-xl">Imaginez un peu la scène : un algorithme décisionnel complet, du <strong>triage</strong> au <strong>bloc opératoire</strong>, celui qu'applique un vrai service de chirurgie viscérale à chaque patient qui franchit la porte des urgences.</p>
          </div>
        </div>
      </motion.div>

      <motion.section variants={FADE_UP} className="relative pl-10">
        <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gradient-to-b from-teal-400 via-cyan-400 to-emerald-400 rounded-full" />

        <div className="relative mb-8">
          <div className="absolute -left-10 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-teal-500 text-white font-black text-sm shadow-lg shadow-teal-500/40">1</div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-teal-100 dark:border-teal-900/30 p-5 shadow-md">
            <h3 className="font-black text-teal-700 dark:text-teal-400 flex items-center gap-2 mb-1"><Siren className="w-4 h-4"/> Arrivée du Patient & Triage</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">Douleur en FID, fébrile ou non → suspicion d'appendicite dès la porte. L'interne évalue la <strong>triade clinique</strong> : douleur migratrice, anorexie, fébricule. Bilan initial systématique dès cette étape : <strong>NFS, CRP, β-hCG</strong> (chez toute femme en âge de procréer), bandelette urinaire pour éliminer une piste rénale. Retenez cette astuce en or : on prescrit le bilan <em>en même temps</em> qu'on examine, on ne perd jamais de temps en série.</p>
          </div>
        </div>

        <div className="relative mb-8">
          <div className="absolute -left-10 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500 text-white font-black text-sm shadow-lg shadow-cyan-500/40">2</div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-cyan-100 dark:border-cyan-900/30 p-5 shadow-md">
            <h3 className="font-black text-cyan-700 dark:text-cyan-400 flex items-center gap-2 mb-1"><CheckCircle2 className="w-4 h-4"/> Stratification par Score d'Alvarado</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">C'est ici que se joue tout le raisonnement. Score <strong>&lt; 4</strong> : la probabilité est faible, on surveille et on réévalue à quelques heures d'intervalle — pas d'imagerie inutile. Score <strong>5-6</strong> : la zone grise, celle qui angoisse tout le monde — on demande une imagerie complémentaire pour trancher. Score <strong>≥ 7</strong> : n'attendez rien de plus, l'avis chirurgical est direct et sans délai. Ici, on ne pardonne pas l'erreur de temporisation face à un score élevé.</p>
          </div>
        </div>

        <div className="relative mb-8">
          <div className="absolute -left-10 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-white font-black text-sm shadow-lg shadow-blue-500/40">3</div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-blue-100 dark:border-blue-900/30 p-5 shadow-md">
            <h3 className="font-black text-blue-700 dark:text-blue-400 flex items-center gap-2 mb-1"><Microscope className="w-4 h-4"/> Choisir la Bonne Imagerie</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed"><strong>Échographie</strong> en 1ère intention chez l'enfant et la femme enceinte — non irradiante, elle cherche un appendice incompressible de diamètre <strong>&gt; 6mm</strong>. <strong>TDM injectée</strong> chez l'adulte en cas de doute persistant : c'est le <em>gold standard</em>, avec une sensibilité et une spécificité dépassant les 95%. Retenez la règle : jamais de TDM systématique chez l'enfant ou la femme enceinte si l'écho suffit à trancher.</p>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -left-10 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white font-black text-sm shadow-lg shadow-emerald-500/40">4</div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-emerald-100 dark:border-emerald-900/30 p-5 shadow-md">
            <h3 className="font-black text-emerald-700 dark:text-emerald-400 flex items-center gap-2 mb-1"><Crosshair className="w-4 h-4"/> Prise en Charge Thérapeutique</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">Le geste de référence : appendicectomie <strong>cœlioscopique</strong> en urgence, sous couverture antibiotique péri-opératoire à dose unique. Mais attention à l'exception que tout le monde oublie : en cas de <strong>plastron appendiculaire</strong> constitué, la chirurgie immédiate est <em>contre-indiquée</em> — on refroidit d'abord avec une antibiothérapie IV, et on opère « à froid » deux à trois mois plus tard, sur un terrain apaisé. Confondre les deux situations, c'est le genre d'erreur qui coûte cher à l'examen comme au bloc.</p>
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* "Professor Notes" mode — notepad/quote style, clinical pearls.           */
/* ----------------------------------------------------------------------- */

function ProfessorNotesContent() {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="w-full mx-auto space-y-8 font-sans text-slate-800 dark:text-slate-200 pb-4"
    >
      <motion.div variants={SCALE_IN} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800 p-8 shadow-xl border border-slate-300 dark:border-slate-700">
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-4 bg-slate-800 dark:bg-slate-700 rounded-2xl shadow-lg text-white">
            <BookOpen className="w-10 h-10"/>
          </div>
          <div>
            <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-slate-800/10 dark:bg-white/10 text-slate-700 dark:text-slate-300 rounded-full border border-slate-400/30">
              Notes de Stage
            </span>
            <h1 className="text-2xl md:text-4xl font-black text-slate-900 dark:text-white tracking-tight mt-2">
              Professor Notes — Ce Que Dit Le Chef de Service
            </h1>
          </div>
        </div>
      </motion.div>

      <motion.section variants={FADE_UP} className="space-y-4">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border-l-4 border-slate-400 dark:border-slate-600 p-6 shadow-sm">
          <p className="italic text-slate-700 dark:text-slate-300 text-base leading-relaxed">
            « Un interne m'a dit un jour : "Chef, la biologie est normale." Je lui ai répondu : <strong>"Et alors ? Regardez le patient, pas les chiffres."</strong> La biologie raconte ce qui s'est passé il y a six heures. Le patient, lui, vous raconte ce qui se passe maintenant. »
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-2 uppercase tracking-wide">— Sur l'examen clinique avant tout</p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border-l-4 border-slate-400 dark:border-slate-600 p-6 shadow-sm">
          <p className="italic text-slate-700 dark:text-slate-300 text-base leading-relaxed">
            « Au bloc, si vous ne trouvez pas l'appendice, <strong>suivez les bandelettes coliques</strong> : elles convergent toujours vers sa base, quelle que soit la position dans laquelle il se cache. C'est la seule chose fixe dans cette histoire — retenez cette astuce en or, elle vous sauvera d'une exploration qui tourne en rond. »
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-2 uppercase tracking-wide">— Sur l'anatomie chirurgicale</p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border-l-4 border-slate-400 dark:border-slate-600 p-6 shadow-sm">
          <p className="italic text-slate-700 dark:text-slate-300 text-base leading-relaxed">
            « Un score d'Alvarado à 7, je n'attends pas le scanner pour vous faire plaisir. <em>Chaque heure de retard</em> est une heure de plus vers la perforation. Ici, on ne pardonne pas l'erreur de temporisation — la montre tourne dès que le patient franchit la porte. »
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-2 uppercase tracking-wide">— Sur la décision opératoire</p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border-l-4 border-slate-400 dark:border-slate-600 p-6 shadow-sm">
          <p className="italic text-slate-700 dark:text-slate-300 text-base leading-relaxed">
            « Imaginez un peu la scène aux urgences à 3h du matin : une patiente de 84 ans, un peu confuse, sans fièvre, avec juste "un peu mal au ventre depuis trois jours". Chez elle, l'appendicite ne <em>crie</em> pas, elle chuchote — on parle d'appendicite <strong>torpide</strong>. Pas de fièvre franche, pas de défense franche, et pourtant le péritoine se remplit en silence. C'est la population où l'on perfore le plus, précisément parce qu'on la sous-estime. »
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-2 uppercase tracking-wide">— Sur le piège du sujet âgé</p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border-l-4 border-slate-400 dark:border-slate-600 p-6 shadow-sm">
          <p className="italic text-slate-700 dark:text-slate-300 text-base leading-relaxed">
            « Retenez cette astuce en or pour l'appendice rétro-cæcal : il se cache <em>derrière</em> le cæcum, alors la défense pariétale classique n'apparaît quasiment jamais — le cæcum fait écran. Le seul signal qui vous reste, c'est le <strong>psoïtis</strong> : douleur à l'extension passive de la cuisse droite, parce que le muscle psoas frotte contre un appendice enflammé qu'on ne peut pas palper directement. Si vous ne cherchez pas ce signe-là, vous passez à côté. »
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-2 uppercase tracking-wide">— Sur le piège de la forme rétro-cæcale</p>
        </div>
      </motion.section>

      <motion.section variants={FADE_UP} className="space-y-3">
        <div className="flex items-center gap-3 border-b-2 border-amber-500/30 pb-3">
          <div className="p-2 bg-amber-500/10 rounded-lg text-amber-500"><Lightbulb className="w-6 h-6"/></div>
          <h2 className="text-xl font-black text-amber-600 dark:text-amber-400 uppercase tracking-wide">Perles Cliniques</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40">
            <Lightbulb className="w-5 h-5 text-amber-500 shrink-0 mt-0.5"/>
            <p className="text-sm text-amber-900 dark:text-amber-200"><strong>Perle :</strong> chez la femme enceinte, la douleur monte avec l'utérus qui repousse l'appendice — au 3ème trimestre, elle peut se loger sous les côtes droites, mimant une cholécystite ou une pyélonéphrite haute.</p>
          </div>
          <div className="flex gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40">
            <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5"/>
            <p className="text-sm text-amber-900 dark:text-amber-200"><strong>Astuce :</strong> le signe de Rovsing (douleur en FID à la palpation de la FIG) traduit une irritation péritonéale <em>diffuse</em>, pas une localisation gauche — ne vous laissez jamais piéger par le côté de la palpation.</p>
          </div>
          <div className="flex gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40">
            <Lightbulb className="w-5 h-5 text-amber-500 shrink-0 mt-0.5"/>
            <p className="text-sm text-amber-900 dark:text-amber-200"><strong>Perle :</strong> chez l'enfant de moins de 5 ans, oubliez la triade classique — diarrhée et irritabilité isolée doivent déjà alerter, le tableau ressemble souvent à une simple gastro-entérite.</p>
          </div>
          <div className="flex gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40">
            <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5"/>
            <p className="text-sm text-amber-900 dark:text-amber-200"><strong>Astuce :</strong> une CRP qui monte à deux dosages successifs vaut plus qu'une valeur unique, même normale au départ — c'est la <em>cinétique</em> qui parle, pas le chiffre isolé.</p>
          </div>
          <div className="flex gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40">
            <Lightbulb className="w-5 h-5 text-amber-500 shrink-0 mt-0.5"/>
            <p className="text-sm text-amber-900 dark:text-amber-200"><strong>Perle :</strong> l'appendice en position pelvienne ne touche jamais la paroi antérieure — il irrite directement le rectum et la vessie, donnant un <em>ténesme rectal</em> et une pollakiurie qui font suspecter à tort une cystite ou une rectite.</p>
          </div>
          <div className="flex gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40">
            <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5"/>
            <p className="text-sm text-amber-900 dark:text-amber-200"><strong>Astuce :</strong> chez le sujet âgé, une fièvre <em>absente</em> associée à un iléus fébrile trompeur doit faire craindre une péritonite déjà généralisée — l'organisme n'a plus la réserve immunitaire pour monter une vraie réponse inflammatoire.</p>
          </div>
          <div className="flex gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40">
            <Lightbulb className="w-5 h-5 text-amber-500 shrink-0 mt-0.5"/>
            <p className="text-sm text-amber-900 dark:text-amber-200"><strong>Perle :</strong> le toucher rectal reste précieux dans les formes pelviennes — une douleur vive au cul-de-sac de Douglas droit oriente immédiatement le diagnostic quand l'abdomen reste étonnamment souple.</p>
          </div>
          <div className="flex gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40">
            <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5"/>
            <p className="text-sm text-amber-900 dark:text-amber-200"><strong>Astuce :</strong> devant tout tableau abdominal atypique chez une personne âgée, pensez toujours « appendicite jusqu'à preuve du contraire » — c'est la population où le retard diagnostique tue le plus souvent.</p>
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* "Astuces Mnémotechniques" mode — clever mnemonics, acronyms, associations. */
/* ----------------------------------------------------------------------- */

function AstucesContent() {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="w-full mx-auto space-y-8 font-sans text-slate-800 dark:text-slate-200 pb-4"
    >
      <motion.div variants={SCALE_IN} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 to-orange-600 dark:from-amber-900 dark:to-orange-950 p-8 shadow-2xl border border-amber-400/30">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-white/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-64 h-64 bg-black/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="p-4 bg-white/20 backdrop-blur-md rounded-2xl shadow-lg text-white">
            <Brain className="w-10 h-10"/>
          </div>
          <div>
            <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-white/20 text-white rounded-full border border-white/30">
              Mémorisation Éclair
            </span>
            <h1 className="text-3xl md:text-5xl font-black text-white uppercase tracking-tight mt-2 mb-2 drop-shadow-md">
              Astuces Mnémotechniques
            </h1>
            <p className="text-sm md:text-base font-medium text-amber-50 leading-relaxed max-w-2xl">
              Rapprochez-vous les amis : treize astuces pour ne plus jamais bafouiller devant un jury ou un patient. Des acronymes, des images absurdes, des comptines, des règles chiffrées — le genre de trucs stupides en apparence, mais qu'on n'oublie plus jamais une fois qu'on les a en tête.
            </p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* 1. Acronyme — F.A.I.M. */}
        <motion.div variants={FADE_UP} className="group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500"/>
            <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">Astuce n°1 — L'Acronyme</h3>
          </div>
          <p className="text-2xl font-black tracking-tight mb-3">
            <span className="text-rose-600 dark:text-rose-400">F</span>
            <span className="text-amber-600 dark:text-amber-400">.</span>
            <span className="text-blue-600 dark:text-blue-400">A</span>
            <span className="text-amber-600 dark:text-amber-400">.</span>
            <span className="text-emerald-600 dark:text-emerald-400">I</span>
            <span className="text-amber-600 dark:text-amber-400">.</span>
            <span className="text-purple-600 dark:text-purple-400">M</span>
            <span className="text-amber-600 dark:text-amber-400">.</span>
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Imaginez la scène : votre patient a mal, mais surtout, il n'a plus <strong>F</strong>aim. Retenez la triade avec ce clin d'œil ironique — la seule fois où avoir faim, c'est de ne plus avoir faim !
          </p>
          <ul className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-500">
            <li><span className="text-rose-600 dark:text-rose-400 font-bold">F</span> = Fébricule (38-38,5°C)</li>
            <li><span className="text-blue-600 dark:text-blue-400 font-bold">A</span> = Anorexie quasi-constante</li>
            <li><span className="text-emerald-600 dark:text-emerald-400 font-bold">I</span> = Immobilité (le patient reste recroquevillé)</li>
            <li><span className="text-purple-600 dark:text-purple-400 font-bold">M</span> = Migration de la douleur (nombril → FID)</li>
          </ul>
        </motion.div>

        {/* 2. Association visuelle — Point de McBurney */}
        <motion.div variants={FADE_UP} className="group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500"/>
            <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">Astuce n°2 — L'Image Mentale</h3>
          </div>
          <p className="font-black text-slate-900 dark:text-white mb-2">Le point de McBurney, planté comme une punaise</p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Imaginez un patient allongé, et vous, vous tracez une ligne imaginaire entre son <span className="text-amber-600 dark:text-amber-400 font-bold">nombril</span> et l'<span className="text-amber-600 dark:text-amber-400 font-bold">épine iliaque antéro-supérieure droite</span> — l'os pointu qu'on sent sous la peau, en haut de la hanche. Maintenant, plantez mentalement une punaise au <strong>tiers externe</strong> de cette ligne. Voilà, vous venez de retrouver le point de McBurney — le point le plus sensible de tout l'abdomen.
          </p>
        </motion.div>

        {/* 3. Règle chiffrée — Le chiffre 3 */}
        <motion.div variants={FADE_UP} className="group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500"/>
            <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">Astuce n°3 — La Règle Numérique</h3>
          </div>
          <p className="text-4xl font-black text-amber-600 dark:text-amber-400 mb-2">La règle du 3</p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Trois signes cliniques cardinaux (douleur migratrice, anorexie, fébricule), trois examens biologiques réflexes (<strong>NFS</strong>, <strong>CRP</strong>, <strong>β-hCG</strong>), trois options d'imagerie (échographie, TDM, IRM). Trois par trois, tout se range tout seul dans votre tête.
          </p>
        </motion.div>

        {/* 4. Comptine rimée — formes atypiques */}
        <motion.div variants={FADE_UP} className="group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500"/>
            <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">Astuce n°4 — La Comptine</h3>
          </div>
          <p className="italic text-lg font-bold text-slate-900 dark:text-white mb-2">« Rétro sans défense, pelvien sans tension »</p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Répétez-la comme une rime : la forme <strong>rétro-cæcale</strong> n'a pas de défense (le cæcum sert de bouclier), la forme <strong>pelvienne</strong> laisse l'abdomen souple et sans tension (le rectum et la vessie trinquent à sa place). Deux formes, une seule petite phrase.
          </p>
        </motion.div>

        {/* 5. Acronyme DDx — GASP */}
        <motion.div variants={FADE_UP} className="md:col-span-2 group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500"/>
            <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">Astuce n°5 — L'Acronyme des Imposteurs</h3>
          </div>
          <p className="text-2xl font-black tracking-tight mb-3">
            <span className="text-rose-600 dark:text-rose-400">G</span>
            <span className="text-blue-600 dark:text-blue-400">A</span>
            <span className="text-emerald-600 dark:text-emerald-400">S</span>
            <span className="text-purple-600 dark:text-purple-400">P</span>
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
            Quand le diagnostic hésite devant une douleur en FID, pensez à respirer... et à <strong>GASP</strong> — les quatre imposteurs classiques qui adorent se déguiser en appendicite.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-500 dark:text-slate-500">
            <span><span className="text-rose-600 dark:text-rose-400 font-bold">G</span> = GEU (Grossesse Extra-Utérine)</span>
            <span><span className="text-blue-600 dark:text-blue-400 font-bold">A</span> = Adénolymphite mésentérique</span>
            <span><span className="text-emerald-600 dark:text-emerald-400 font-bold">S</span> = Salpingite</span>
            <span><span className="text-purple-600 dark:text-purple-400 font-bold">P</span> = Pyélonéphrite droite</span>
          </div>
        </motion.div>

        {/* 6. Acronyme — les 4 stades, C.S.G.P. */}
        <motion.div variants={FADE_UP} className="md:col-span-2 group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500"/>
            <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">Astuce n°6 — La Phrase des 4 Stades</h3>
          </div>
          <p className="text-lg font-black tracking-tight mb-3">
            « <span className="text-indigo-600 dark:text-indigo-400 font-black text-xl">C</span>haque <span className="text-amber-600 dark:text-amber-400 font-black text-xl">S</span>tade <span className="text-orange-600 dark:text-orange-400 font-black text-xl">G</span>agne en <span className="text-rose-600 dark:text-rose-400 font-black text-xl">P</span>anique »
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
            Une phrase toute bête, mais qui range les 4 stades dans le bon ordre — et la maladie « panique » vraiment de plus en plus à chaque lettre.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-500 dark:text-slate-500">
            <span><span className="text-indigo-600 dark:text-indigo-400 font-bold">C</span> = Catarrhale (discrète, douleur sourde)</span>
            <span><span className="text-amber-600 dark:text-amber-400 font-bold">S</span> = Suppurée (défense franche, fébricule)</span>
            <span><span className="text-orange-600 dark:text-orange-400 font-bold">G</span> = Gangréneuse (nécrose, plastron)</span>
            <span><span className="text-rose-600 dark:text-rose-400 font-bold">P</span> = Perforée (péritonite, bloc immédiat)</span>
          </div>
        </motion.div>

        {/* 7. Image absurde — la souris apeurée */}
        <motion.div variants={FADE_UP} className="group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500"/>
            <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">Astuce n°7 — La Souris Apeurée</h3>
          </div>
          <p className="font-black text-slate-900 dark:text-white mb-2">Une souris qui détale se cacher en bas à droite</p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Imaginez une scène absurde : une petite souris part du <span className="text-amber-600 dark:text-amber-400 font-bold">nombril</span>, hésite une seconde au milieu du ventre, puis détale terrifiée se réfugier dans le coin en bas à droite. C'est exactement le trajet de la douleur — péri-ombilicale d'abord, <span className="text-amber-600 dark:text-amber-400 font-bold">fixée en FID</span> ensuite, en 12 à 24 heures.
          </p>
        </motion.div>

        {/* 8. Acronyme — populations à risque, VIP */}
        <motion.div variants={FADE_UP} className="group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500"/>
            <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">Astuce n°8 — Les VIP du Piège</h3>
          </div>
          <p className="text-3xl font-black tracking-tight mb-3">
            <span className="text-rose-600 dark:text-rose-400">V</span>
            <span className="text-blue-600 dark:text-blue-400">I</span>
            <span className="text-emerald-600 dark:text-emerald-400">P</span>
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
            Vos trois <strong>VIP</strong> — pas parce qu'on les chouchoute, mais parce qu'ils trichent tous avec la clinique classique.
          </p>
          <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-500">
            <li><span className="text-rose-600 dark:text-rose-400 font-bold">V</span> = Vieillards (tableau torpide, peu fébrile)</li>
            <li><span className="text-blue-600 dark:text-blue-400 font-bold">I</span> = Infans (moins de 5 ans, triade absente)</li>
            <li><span className="text-emerald-600 dark:text-emerald-400 font-bold">P</span> = Parturientes (l'appendice qui migre)</li>
          </ul>
        </motion.div>

        {/* 9. Image absurde — le tir au but invisible (psoïtis) */}
        <motion.div variants={FADE_UP} className="group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500"/>
            <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">Astuce n°9 — Le Tir au But Invisible</h3>
          </div>
          <p className="font-black text-slate-900 dark:text-white mb-2">Un tir au but contre un ballon imaginaire</p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Imaginez une scène absurde : un patient allongé, jambe droite tendue, qui mime un <span className="text-amber-600 dark:text-amber-400 font-bold">tir au but</span> contre un ballon invisible au plafond. La douleur fulgurante qui jaillit à ce geste, c'est le <span className="text-amber-600 dark:text-amber-400 font-bold">psoïtis</span> — le seul signal qui trahit un appendice caché derrière le cæcum.
          </p>
        </motion.div>

        {/* 10. Acronyme — traitement, ACID */}
        <motion.div variants={FADE_UP} className="md:col-span-2 group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500"/>
            <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">Astuce n°10 — Le Traitement Qui Pique : ACID</h3>
          </div>
          <p className="text-2xl font-black tracking-tight mb-3">
            <span className="text-rose-600 dark:text-rose-400">A</span>
            <span className="text-blue-600 dark:text-blue-400">C</span>
            <span className="text-emerald-600 dark:text-emerald-400">I</span>
            <span className="text-purple-600 dark:text-purple-400">D</span>
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
            Un acronyme qui tombe bien pour une maladie digestive — <strong>ACID</strong>, comme le suc qui ronge, sauf qu'ici c'est vous qui rongez le protocole par cœur.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-500 dark:text-slate-500">
            <span><span className="text-rose-600 dark:text-rose-400 font-bold">A</span> = Antibioprophylaxie (dose unique péri-op)</span>
            <span><span className="text-blue-600 dark:text-blue-400 font-bold">C</span> = Chirurgie cœlioscopique en urgence</span>
            <span><span className="text-emerald-600 dark:text-emerald-400 font-bold">I</span> = Irrigation péritonéale si perforation</span>
            <span><span className="text-purple-600 dark:text-purple-400 font-bold">D</span> = Différée « à froid » si plastron</span>
          </div>
        </motion.div>

        {/* 11. Comptine — seuils du score d'Alvarado */}
        <motion.div variants={FADE_UP} className="group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500"/>
            <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">Astuce n°11 — La Comptine du Score</h3>
          </div>
          <p className="italic text-base font-bold text-slate-900 dark:text-white mb-2">« Sous <span className="text-slate-500 dark:text-slate-400 font-black">4</span>, on regarde. Entre <span className="text-amber-600 dark:text-amber-400 font-black">5</span> et <span className="text-amber-600 dark:text-amber-400 font-black">6</span>, on radiographie. Dès <span className="text-rose-600 dark:text-rose-400 font-black">7</span>, on répare ! »</p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Une petite rime pour ne plus jamais hésiter sur la conduite à tenir face à un score d'Alvarado — surveillance, imagerie, ou bloc opératoire direct.
          </p>
        </motion.div>

        {/* 12. Règle chiffrée — le duo 6-95 */}
        <motion.div variants={FADE_UP} className="group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500"/>
            <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">Astuce n°12 — Le Duo 6-95</h3>
          </div>
          <p className="text-4xl font-black text-amber-600 dark:text-amber-400 mb-2">6 · 95</p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Retenez ce duo comme un code de coffre-fort : diamètre appendiculaire pathologique dès <strong>6 mm</strong> à l'échographie, sensibilité et spécificité de la TDM au-delà de <strong>95%</strong>. Le 6 ouvre le diagnostic, le 95 le verrouille.
          </p>
        </motion.div>

        {/* 13. Acronyme — signaux d'urgence absolue, STOP */}
        <motion.div variants={FADE_UP} className="md:col-span-2 group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500"/>
            <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">Astuce n°13 — Le Feu Rouge : STOP</h3>
          </div>
          <p className="text-2xl font-black tracking-tight mb-3">
            <span className="text-rose-600 dark:text-rose-400">S</span>
            <span className="text-blue-600 dark:text-blue-400">T</span>
            <span className="text-emerald-600 dark:text-emerald-400">O</span>
            <span className="text-purple-600 dark:text-purple-400">P</span>
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
            Un seul de ces quatre signaux, et c'est <strong>STOP</strong> : plus une minute à perdre, direction le bloc.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-500 dark:text-slate-500">
            <span><span className="text-rose-600 dark:text-rose-400 font-bold">S</span> = Signes de choc (tachycardie, hypotension)</span>
            <span><span className="text-blue-600 dark:text-blue-400 font-bold">T</span> = Température &gt; 39°C avec altération franche</span>
            <span><span className="text-emerald-600 dark:text-emerald-400 font-bold">O</span> = Occlusion fébrile associée</span>
            <span><span className="text-purple-600 dark:text-purple-400 font-bold">P</span> = Plastron palpable</span>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* Shell — tombabilité badge + pill nav + mode dispatch.                    */
/* ----------------------------------------------------------------------- */

export function ResumeStudio() {
  const [activeModeId, setActiveModeId] = useState(VISIBLE_MODES[0].id);

  return (
    <div className="animate-fade-in">
      {/* Badge de tombabilité */}
      <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-red-500/30">
        <Flame className="h-4 w-4" />
        Tombabilité à l&apos;examen : {RESUME_TOMBABILITE}%
      </div>

      {/* Navigation en pills, défilement horizontal — seulement les modes conservés */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
        {VISIBLE_MODES.map((m) => {
          const isActive = m.id === activeModeId;
          return (
            <button
              key={m.id}
              onClick={() => setActiveModeId(m.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200",
                isActive
                  ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              <m.icon className="h-3.5 w-3.5" />
              {m.label}
            </button>
          );
        })}
      </div>

      {activeModeId === "smart" && <MasterclassSummary />}
      {activeModeId === "exam" && <ExamSummaryContent />}
      {activeModeId === "cheatsheet" && <CheatSheetContent />}
      {activeModeId === "guideline" && <GuidelineSummaryContent />}
      {activeModeId === "professor" && <ProfessorNotesContent />}
      {activeModeId === "astuces" && <AstucesContent />}
    </div>
  );
}
