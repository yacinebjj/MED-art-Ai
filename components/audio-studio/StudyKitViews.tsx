"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Download, Loader2, NotebookPen, RefreshCw, RotateCcw, Sparkles, Target } from "lucide-react";
import type { LectureStudyKit } from "@/types/lecture-study-kit";
import { cn } from "@/lib/utils";
import { putSyncDoc, reconcileValue, type SyncedValue } from "@/lib/user-sync";

const KIT_CACHE_PREFIX = "medart:lecture-kit:";
/** Cross-device copy (lib/user-sync.ts), keyed by the same Smart Notes hash. */
const KIT_SYNC_NS = "lecture-kit";

/** Small stable hash so a kit is cached per exact Smart Notes text. */
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function useStudyKit(smartNotes: string | null) {
  const [kit, setKit] = useState<LectureStudyKit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncKey = smartNotes ? hashText(smartNotes) : null;
  const key = syncKey ? `${KIT_CACHE_PREFIX}${syncKey}` : null;

  useEffect(() => {
    setKit(null);
    setError(null);
    if (!key || !syncKey) return;
    let local: SyncedValue<LectureStudyKit> | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const cached = JSON.parse(raw) as LectureStudyKit;
        setKit(cached);
        // The local cache has no timestamp: 0 lets a remote copy win, and
        // still uploads it when the server has none.
        local = { value: cached, savedAt: 0 };
      }
    } catch {
      // No cache available — generated on demand.
    }
    // A kit generated on another device appears here without regenerating.
    let cancelled = false;
    void reconcileValue<LectureStudyKit>(KIT_SYNC_NS, syncKey, local).then((winner) => {
      if (cancelled || !winner || winner === local || !winner.value) return;
      setKit((current) => current ?? winner.value);
      try {
        window.localStorage.setItem(key, JSON.stringify(winner.value));
      } catch {
        // Not cached on this device; still shown.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key, syncKey]);

  const generate = useCallback(async () => {
    if (!smartNotes || !key || !syncKey) return;
    setLoading(true);
    setError(null);
    try {
      // Generated on another device since this page loaded? Use it instead of a new AI run.
      const remote = await reconcileValue<LectureStudyKit>(KIT_SYNC_NS, syncKey, null);
      if (remote?.value) {
        setKit(remote.value);
        try {
          window.localStorage.setItem(key, JSON.stringify(remote.value));
        } catch {
          // Not cached on this device; still shown.
        }
        return;
      }
      const res = await fetch("/api/lecture-notes/study-kit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ smartNotes }) });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; kit?: LectureStudyKit; error?: string };
      if (!res.ok || !data.success || !data.kit) throw new Error(data.error ?? "La génération du kit a échoué.");
      setKit(data.kit);
      putSyncDoc(KIT_SYNC_NS, syncKey, { value: data.kit, savedAt: Date.now() } satisfies SyncedValue<LectureStudyKit>, true);
      try {
        window.localStorage.setItem(key, JSON.stringify(data.kit));
      } catch {
        // Not cached on this device; still shown.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }, [smartNotes, key, syncKey]);

  return { kit, loading, error, generate };
}

export function KitGate({ loading, error, onGenerate, what }: { loading: boolean; error: string | null; onGenerate: () => void; what: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500/20 to-amber-500/20 text-rose-600 dark:text-rose-300">
        {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Sparkles className="h-6 w-6" />}
      </span>
      <div>
        <p className="text-sm font-bold text-foreground">{loading ? "Préparation du kit de révision…" : `Générer ${what}`}</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">Flashcards, points High-Yield et carte mentale sont créés ensemble, uniquement à partir de tes Smart Notes, puis gardés sur ton compte (retrouvés sur tous tes appareils).</p>
      </div>
      {error && <p className="text-xs font-semibold text-destructive">{error}</p>}
      <button
        type="button"
        onClick={onGenerate}
        disabled={loading}
        className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-orange-500 px-5 text-sm font-bold text-white shadow-[0_10px_30px_-12px_rgba(244,63,94,0.9)] transition hover:-translate-y-0.5 disabled:opacity-60"
      >
        {error ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        {error ? "Réessayer" : "Générer le kit"}
      </button>
    </div>
  );
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function FlashcardsView({ kit, title, onPushToNotes }: { kit: LectureStudyKit; title: string; onPushToNotes: (markdown: string, label: string) => void }) {
  const cards = kit.flashcards;
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const [review, setReview] = useState<Set<number>>(new Set());

  if (cards.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">Aucune flashcard n&apos;a pu être tirée de ces notes.</p>;
  const card = cards[index];

  function go(delta: number) {
    setFlipped(false);
    setIndex((i) => (i + delta + cards.length) % cards.length);
  }
  function mark(set: "known" | "review") {
    setKnown((prev) => {
      const next = new Set(prev);
      if (set === "known") next.add(index);
      else next.delete(index);
      return next;
    });
    setReview((prev) => {
      const next = new Set(prev);
      if (set === "review") next.add(index);
      else next.delete(index);
      return next;
    });
    go(1);
  }
  function exportCsv() {
    // Anki "Importer" accepts this directly (champs séparés par des virgules, guillemets échappés).
    const csv = cards.map((c) => `${csvCell(c.front)},${csvCell(c.back)}`).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[\\/:*?"<>|]/g, "").trim() || "flashcards"} - flashcards.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex w-full items-center justify-between text-xs font-bold text-muted-foreground">
        <span className="tabular-nums">
          Carte {index + 1}/{cards.length}
        </span>
        <span className="flex gap-3 tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">✓ {known.size} sues</span>
          <span className="text-amber-600 dark:text-amber-400">↻ {review.size} à revoir</span>
        </span>
      </div>

      <button type="button" onClick={() => setFlipped((f) => !f)} className="w-full max-w-xl [perspective:1400px]" aria-label={flipped ? "Voir la question" : "Voir la réponse"}>
        <motion.div animate={{ rotateY: flipped ? 180 : 0 }} transition={{ type: "spring", stiffness: 260, damping: 26 }} className="relative min-h-[15rem] w-full [transform-style:preserve-3d]">
          <div className="absolute inset-0 flex flex-col justify-center gap-3 rounded-3xl border border-amber-300/60 bg-gradient-to-br from-amber-50 to-orange-50 p-6 text-left shadow-[0_20px_50px_-24px_rgba(245,158,11,0.7)] [backface-visibility:hidden] dark:border-amber-400/25 dark:from-amber-500/10 dark:to-orange-500/5">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600 dark:text-amber-300">Question</span>
            <p className="text-lg font-bold leading-snug text-foreground">{card.front}</p>
            <span className="mt-auto text-[11px] text-muted-foreground">Touche la carte pour voir la réponse</span>
          </div>
          <div className="absolute inset-0 flex flex-col justify-center gap-3 rounded-3xl border border-emerald-300/60 bg-gradient-to-br from-emerald-50 to-cyan-50 p-6 text-left shadow-[0_20px_50px_-24px_rgba(16,185,129,0.7)] [backface-visibility:hidden] [transform:rotateY(180deg)] dark:border-emerald-400/25 dark:from-emerald-500/10 dark:to-cyan-500/5">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-300">Réponse</span>
            <p className="text-base leading-relaxed text-foreground">{card.back}</p>
          </div>
        </motion.div>
      </button>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={() => go(-1)} aria-label="Carte précédente" className="flex h-11 w-11 items-center justify-center rounded-full border border-border hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => mark("review")} className="flex min-h-11 items-center gap-1.5 rounded-full bg-amber-500/15 px-4 text-sm font-bold text-amber-700 hover:bg-amber-500/25 dark:text-amber-300">
          <RotateCcw className="h-4 w-4" /> À revoir
        </button>
        <button type="button" onClick={() => mark("known")} className="flex min-h-11 items-center gap-1.5 rounded-full bg-emerald-500/15 px-4 text-sm font-bold text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300">
          <Check className="h-4 w-4" /> Je savais
        </button>
        <button type="button" onClick={() => go(1)} aria-label="Carte suivante" className="flex h-11 w-11 items-center justify-center rounded-full border border-border hover:bg-accent">
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap justify-center gap-2 border-t border-border pt-4">
        <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-foreground hover:bg-accent">
          <Download className="h-3.5 w-3.5" /> Export Anki (.csv)
        </button>
        <button
          type="button"
          onClick={() => onPushToNotes(`# Flashcards — ${title}\n\n${cards.map((c, i) => `**${i + 1}. ${c.front}**\n\n${c.back}`).join("\n\n---\n\n")}`, "Flashcards")}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-foreground hover:bg-accent"
        >
          <NotebookPen className="h-3.5 w-3.5" /> Ajouter à Mes Notes
        </button>
      </div>
    </div>
  );
}

export function HighYieldView({ kit }: { kit: LectureStudyKit }) {
  if (kit.highYield.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">Aucun point High-Yield n&apos;a pu être tiré de ces notes.</p>;
  return (
    <ol className="space-y-3">
      {kit.highYield.map((item, i) => (
        <li key={i} className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 pl-14 shadow-soft">
          <span className={cn("absolute left-3 top-4 flex h-8 w-8 items-center justify-center rounded-xl text-sm font-black text-white", i < 3 ? "bg-gradient-to-br from-rose-500 to-orange-500" : "bg-slate-500 dark:bg-slate-600")}>{i + 1}</span>
          <p className="flex items-start gap-2 font-bold leading-snug text-foreground">
            {i < 3 && <Target className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />}
            {item.point}
          </p>
          {item.why && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.why}</p>}
          {item.trap && (
            <p className="mt-2.5 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong className="font-bold">Piège : </strong>
                {item.trap}
              </span>
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

const BRANCH_TINTS = [
  "border-violet-400/50 bg-violet-500/10 text-violet-800 dark:text-violet-200",
  "border-cyan-400/50 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200",
  "border-emerald-400/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  "border-amber-400/50 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  "border-rose-400/50 bg-rose-500/10 text-rose-800 dark:text-rose-200",
  "border-blue-400/50 bg-blue-500/10 text-blue-800 dark:text-blue-200",
  "border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-800 dark:text-fuchsia-200",
  "border-lime-400/50 bg-lime-500/10 text-lime-800 dark:text-lime-200",
];

/** Tree layout (center → branches → notions) that stays readable from a phone to a wide screen. */
export function MindmapView({ kit }: { kit: LectureStudyKit }) {
  const { center, branches } = kit.mindmap;
  if (branches.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">Carte mentale indisponible pour ces notes.</p>;
  return (
    <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-center">
      <div className="flex justify-center md:w-48 md:shrink-0">
        <span className="rounded-3xl bg-gradient-to-br from-violet-600 to-fuchsia-600 px-5 py-4 text-center text-base font-black leading-tight text-white shadow-[0_16px_40px_-14px_rgba(139,92,246,0.9)]">{center}</span>
      </div>
      <div className="relative flex-1 space-y-3 border-violet-300/50 md:border-l-2 md:pl-6 dark:border-violet-400/25">
        {branches.map((branch, i) => (
          <div key={i} className="relative">
            <span aria-hidden className="absolute -left-6 top-5 hidden h-0.5 w-6 bg-violet-300/60 md:block dark:bg-violet-400/30" />
            <div className={cn("rounded-2xl border p-3", BRANCH_TINTS[i % BRANCH_TINTS.length])}>
              <p className="text-sm font-black">{branch.label}</p>
              {branch.children.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {branch.children.map((child, j) => (
                    <span key={j} className="rounded-full border border-black/10 bg-white/70 dark:border-white/15 dark:bg-white/5 px-2.5 py-1 text-xs font-medium text-foreground">
                      {child}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
