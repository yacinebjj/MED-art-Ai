"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { formatClock, parseTranscript, toSentences } from "@/lib/lecture-transcript";
import { cn } from "@/lib/utils";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Accent/case-insensitive normalisation so « oedeme » finds « œdème ». */
function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/œ/g, "oe").replace(/æ/g, "ae").toLowerCase();
}

/**
 * Verbatim transcript, one row per sentence. The time chip at the start of
 * each segment is exact (the chunk boundary); the others are interpolated
 * within the 4-minute segment and marked « ≈ ». Clicking any chip seeks the
 * player there. The search box highlights every occurrence (accents and
 * case ignored) with previous/next navigation.
 */
export function TranscriptPanel({
  transcript,
  durationSec,
  currentTime,
  onSeek,
}: {
  transcript: string;
  durationSec: number | null;
  currentTime: number;
  onSeek: (seconds: number) => void;
}) {
  const sentences = useMemo(() => toSentences(parseTranscript(transcript), durationSec), [transcript, durationSec]);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);

  const matches = useMemo(() => {
    const q = fold(query.trim());
    if (q.length < 2) return [] as number[];
    return sentences.map((s, i) => (fold(s.text).includes(q) ? i : -1)).filter((i) => i >= 0);
  }, [sentences, query]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (matches.length === 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${matches[cursor]}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [cursor, matches]);

  let activeIndex = -1;
  for (let i = 0; i < sentences.length; i++) {
    if (sentences[i].startSec <= currentTime) activeIndex = i;
    else break;
  }

  useEffect(() => {
    if (!follow || matches.length > 0 || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, follow, matches.length]);

  if (sentences.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Aucune transcription disponible pour cet enregistrement.</p>;
  }

  const highlightRe = query.trim().length >= 2 ? new RegExp(`(${escapeRegExp(query.trim())})`, "gi") : null;
  const matchSet = new Set(matches);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card/95 p-2 backdrop-blur">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches.length > 0) {
                e.preventDefault();
                setCursor((c) => (e.shiftKey ? (c - 1 + matches.length) % matches.length : (c + 1) % matches.length));
              }
            }}
            placeholder="Chercher un mot du professeur…"
            aria-label="Rechercher dans la transcription"
            className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-rose-400"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Effacer la recherche" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {query.trim().length >= 2 && (
          <div className="flex items-center gap-1">
            <span className="min-w-[4.5rem] text-center text-xs font-bold tabular-nums text-muted-foreground">{matches.length === 0 ? "0 résultat" : `${cursor + 1}/${matches.length}`}</span>
            <button type="button" disabled={matches.length === 0} onClick={() => setCursor((c) => (c - 1 + matches.length) % matches.length)} aria-label="Résultat précédent" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">
              <ChevronUp className="h-4 w-4" />
            </button>
            <button type="button" disabled={matches.length === 0} onClick={() => setCursor((c) => (c + 1) % matches.length)} aria-label="Résultat suivant" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        )}
        <label className="flex cursor-pointer items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-rose-500" />
          Suivre la lecture
        </label>
      </div>

      <ol ref={listRef} className="space-y-1">
        {sentences.map((s, i) => (
          <li
            key={i}
            data-index={i}
            className={cn(
              "group flex gap-3 rounded-xl px-2 py-1.5 transition-colors",
              s.exact && i > 0 && "mt-3 border-t border-border pt-3",
              i === activeIndex ? "bg-rose-500/10" : "hover:bg-accent/60",
              matchSet.has(i) && matches[cursor] === i && "ring-2 ring-amber-400/70"
            )}
          >
            <button
              type="button"
              onClick={() => onSeek(s.startSec)}
              title={s.exact ? "Aller à ce moment" : "Moment estimé dans le segment — aller à ce moment"}
              className={cn(
                "mt-0.5 h-fit shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums transition-colors",
                s.exact ? "bg-rose-500/15 text-rose-700 hover:bg-rose-500 hover:text-white dark:text-rose-300" : "text-muted-foreground hover:bg-rose-500/15 hover:text-rose-700 dark:hover:text-rose-300"
              )}
            >
              {s.exact ? "" : "≈"}
              {formatClock(s.startSec)}
            </button>
            <p dir="auto" className="min-w-0 text-[15px] leading-relaxed text-foreground/90">
              {highlightRe
                ? s.text.split(highlightRe).map((part, j) =>
                    j % 2 === 1 ? (
                      <mark key={j} className="rounded bg-amber-300/70 px-0.5 text-foreground dark:bg-amber-400/40">
                        {part}
                      </mark>
                    ) : (
                      <Fragment key={j}>{part}</Fragment>
                    )
                  )
                : s.text}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
