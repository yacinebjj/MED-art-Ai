"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Lora, Plus_Jakarta_Sans } from "next/font/google";
import { AnimatePresence, motion } from "framer-motion";
import { AlignJustify, ListTree, Maximize2, Minimize2, Minus, Plus, Type, X } from "lucide-react";
import { MedicalMarkdown } from "@/components/reader/MedicalMarkdown";
import { normalizeCallouts } from "@/lib/markdown";
import { cn } from "@/lib/utils";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--reader-font-jakarta", display: "swap" });
const lora = Lora({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], variable: "--reader-font-lora", display: "swap" });

type FontChoice = "jakarta" | "inter" | "serif";
type Density = "compact" | "comfortable" | "spacious";

interface ReaderPrefs {
  font: FontChoice;
  size: number;
  density: Density;
}

const PREFS_KEY = "medart:reader-prefs";
const MIN_SIZE = 15;
const MAX_SIZE = 22;
const DEFAULT_PREFS: ReaderPrefs = { font: "jakarta", size: 17, density: "comfortable" };

const FONT_STACKS: Record<FontChoice, { label: string; hint: string; body: string; heading: string }> = {
  jakarta: { label: "Jakarta", hint: "Moderne", body: "var(--reader-font-jakarta), var(--font-inter), system-ui, sans-serif", heading: "var(--reader-font-jakarta), system-ui, sans-serif" },
  inter: { label: "Inter", hint: "Ultra net", body: "var(--font-inter), system-ui, sans-serif", heading: "var(--font-inter), system-ui, sans-serif" },
  serif: { label: "Lora", hint: "Éditorial", body: "var(--reader-font-lora), Georgia, 'Times New Roman', serif", heading: "var(--reader-font-jakarta), system-ui, sans-serif" },
};

const DENSITIES: Record<Density, { label: string; leading: number; measure: string; pad: string }> = {
  compact: { label: "Compact", leading: 1.6, measure: "82ch", pad: "px-4 sm:px-6" },
  comfortable: { label: "Confort", leading: 1.8, measure: "75ch", pad: "px-5 sm:px-10" },
  spacious: { label: "Aéré", leading: 2.05, measure: "66ch", pad: "px-6 sm:px-14" },
};

function readPrefs(): ReaderPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      font: parsed.font && parsed.font in FONT_STACKS ? parsed.font : DEFAULT_PREFS.font,
      size: typeof parsed.size === "number" ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(parsed.size))) : DEFAULT_PREFS.size,
      density: parsed.density && parsed.density in DENSITIES ? parsed.density : DEFAULT_PREFS.density,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/** Nearest scrolling ancestor (the Studio detail pane), or the page itself. */
function findScrollParent(el: HTMLElement | null): HTMLElement {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center rounded-xl border border-slate-200 bg-slate-100/80 p-0.5 dark:border-white/10 dark:bg-white/[0.05]">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          title={opt.title}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-[10px] px-2.5 py-1.5 text-[11px] font-bold transition-all duration-200",
            value === opt.value ? "bg-white text-slate-900 shadow-sm dark:bg-white/15 dark:text-white" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface ReaderSurfaceProps {
  markdown: string;
  prefs: ReaderPrefs;
  setPrefs: (updater: (p: ReaderPrefs) => ReaderPrefs) => void;
  zen: boolean;
  onToggleZen: () => void;
  footer?: ReactNode;
  /** The element that scrolls this surface — the Zen overlay passes its own. */
  scrollRootRef?: RefObject<HTMLDivElement>;
}

function ReaderSurface({ markdown, prefs, setPrefs, zen, onToggleZen, footer, scrollRootRef }: ReaderSurfaceProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);

  const density = DENSITIES[prefs.density];
  const fonts = FONT_STACKS[prefs.font];

  // Build the Sommaire from the rendered headings (robust to any markdown inside them).
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const headings = Array.from(body.querySelectorAll<HTMLElement>("h2, h3"));
    const entries: TocEntry[] = [];
    headings.forEach((h, i) => {
      h.id = `reader-h-${i}`;
      // data-toc: chapter headings render an eyebrow + title, whose raw textContent would run together.
      const text = (h.dataset.toc ?? h.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text || /^sommaire$/i.test(text)) return;
      entries.push({ id: h.id, text, level: h.tagName === "H3" ? 3 : 2 });
    });
    setToc(entries);
  }, [markdown]);

  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    const body = bodyRef.current;
    if (!scroller || !body) return;
    const isPage = scroller === document.scrollingElement || scroller === document.documentElement;
    const scrollerTop = isPage ? 0 : scroller.getBoundingClientRect().top;
    const bodyRect = body.getBoundingClientRect();
    const viewport = isPage ? window.innerHeight : scroller.clientHeight;
    const travelled = scrollerTop - bodyRect.top;
    const total = bodyRect.height - viewport;
    setProgress(total <= 0 ? 1 : Math.min(1, Math.max(0, travelled / total)));

    const offset = (toolbarRef.current?.offsetHeight ?? 0) + 24;
    let current: string | null = null;
    for (const h of Array.from(body.querySelectorAll<HTMLElement>("h2[id], h3[id]"))) {
      if (h.getBoundingClientRect().top - scrollerTop <= offset) current = h.id;
      else break;
    }
    setActiveId(current);
  }, []);

  useEffect(() => {
    const scroller = scrollRootRef?.current ?? findScrollParent(bodyRef.current);
    scrollerRef.current = scroller;
    const target: HTMLElement | Window = scroller === document.scrollingElement || scroller === document.documentElement ? window : scroller;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [measure, scrollRootRef, zen]);

  useEffect(() => {
    measure();
  }, [prefs, toc, measure]);

  function jumpTo(id: string) {
    const scroller = scrollerRef.current;
    const el = document.getElementById(id);
    if (!scroller || !el) return;
    const isPage = scroller === document.scrollingElement || scroller === document.documentElement;
    const offset = (toolbarRef.current?.offsetHeight ?? 0) + 16;
    const top = isPage
      ? window.scrollY + el.getBoundingClientRect().top - offset
      : scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    (isPage ? window : scroller).scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
    setTocOpen(false);
  }

  const style = {
    "--reader-leading": String(density.leading),
    "--reader-heading": fonts.heading,
    fontFamily: fonts.body,
    fontSize: `${prefs.size}px`,
  } as CSSProperties;

  return (
    <div className={cn(jakarta.variable, lora.variable, "relative")}>
      {/* Control bar — sticks to the top of whichever pane scrolls the lesson. */}
      <div ref={toolbarRef} className="sticky top-0 z-30 rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.4)] backdrop-blur-xl dark:border-white/10 dark:bg-[#0b1016]/90">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Type className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            <Segmented
              label="Police"
              value={prefs.font}
              onChange={(font) => setPrefs((p) => ({ ...p, font }))}
              options={(Object.keys(FONT_STACKS) as FontChoice[]).map((key) => ({ value: key, label: FONT_STACKS[key].label, title: FONT_STACKS[key].hint }))}
            />
          </div>

          <div className="flex items-center rounded-xl border border-slate-200 bg-slate-100/80 p-0.5 dark:border-white/10 dark:bg-white/[0.05]">
            <button
              type="button"
              aria-label="Réduire le texte"
              disabled={prefs.size <= MIN_SIZE}
              onClick={() => setPrefs((p) => ({ ...p, size: Math.max(MIN_SIZE, p.size - 1) }))}
              className="flex h-7 items-center gap-0.5 rounded-[10px] px-2 text-[11px] font-black text-slate-600 transition-colors hover:bg-white hover:text-slate-900 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            >
              A<Minus className="h-2.5 w-2.5" />
            </button>
            <span className="w-9 text-center text-[11px] font-bold tabular-nums text-slate-700 dark:text-slate-200" aria-live="polite">
              {prefs.size}px
            </span>
            <button
              type="button"
              aria-label="Agrandir le texte"
              disabled={prefs.size >= MAX_SIZE}
              onClick={() => setPrefs((p) => ({ ...p, size: Math.min(MAX_SIZE, p.size + 1) }))}
              className="flex h-7 items-center gap-0.5 rounded-[10px] px-2 text-[13px] font-black text-slate-600 transition-colors hover:bg-white hover:text-slate-900 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            >
              A<Plus className="h-2.5 w-2.5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <AlignJustify className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            <Segmented
              label="Interligne et marges"
              value={prefs.density}
              onChange={(densityValue) => setPrefs((p) => ({ ...p, density: densityValue }))}
              options={(Object.keys(DENSITIES) as Density[]).map((key) => ({ value: key, label: DENSITIES[key].label }))}
            />
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {toc.length > 0 && (
              <button
                type="button"
                onClick={() => setTocOpen((o) => !o)}
                aria-expanded={tocOpen}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] font-bold transition-all",
                  tocOpen
                    ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-slate-200 text-slate-600 hover:border-emerald-400/50 hover:text-slate-900 dark:border-white/10 dark:text-slate-300 dark:hover:text-white"
                )}
              >
                <ListTree className="h-3.5 w-3.5" />
                Sommaire
              </button>
            )}
            <button
              type="button"
              onClick={onToggleZen}
              title={zen ? "Quitter le Mode Lecture Zen (Échap)" : "Mode Lecture Zen"}
              className="flex h-8 items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-2.5 text-[11px] font-black text-white shadow-[0_6px_18px_-8px_rgba(16,185,129,0.8)] transition-transform hover:-translate-y-px active:scale-95"
            >
              {zen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              <span className="max-sm:hidden">{zen ? "Quitter Zen" : "Mode Zen"}</span>
            </button>
          </div>
        </div>
        {/* Reading progress */}
        <div className="mx-3 mb-2 h-[3px] overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/[0.06]" role="progressbar" aria-label="Progression de lecture" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className="h-full origin-left bg-gradient-to-r from-emerald-400 via-cyan-400 to-violet-500 transition-transform duration-150 ease-out" style={{ transform: `scaleX(${progress})` }} />
        </div>

        <AnimatePresence>
          {tocOpen && (
            <motion.nav
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              aria-label="Sommaire"
              className="absolute right-2 top-full z-40 mt-2 w-[min(22rem,calc(100%-1rem))] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_20px_25px_-5px_rgba(0,0,0,0.25),0_8px_10px_-6px_rgba(0,0,0,0.25)] dark:border-white/[0.12] dark:bg-[#0f151d] dark:shadow-[0_20px_25px_-5px_rgba(0,0,0,0.7)]"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-white/10">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Sommaire · {Math.round(progress * 100)}% lu</p>
                <button type="button" onClick={() => setTocOpen(false)} aria-label="Fermer le sommaire" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <ol className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5 [scrollbar-width:thin]">
                {toc.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => jumpTo(entry.id)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-xl py-2 pr-3 text-left text-[13px] leading-snug transition-colors",
                        entry.level === 3 ? "pl-7 text-[12.5px]" : "pl-3 font-semibold",
                        activeId === entry.id ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.06]"
                      )}
                    >
                      <span aria-hidden className={cn("mt-[0.45em] h-1.5 w-1.5 shrink-0 rounded-full", activeId === entry.id ? "bg-emerald-500" : entry.level === 3 ? "bg-slate-300 dark:bg-white/20" : "bg-cyan-500/70")} />
                      <span className="min-w-0">{entry.text}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>

      <div ref={bodyRef} className={cn("mx-auto pb-16 pt-6", density.pad)} style={{ ...style, maxWidth: `calc(${density.measure} + 5rem)` }}>
        <MedicalMarkdown markdown={markdown} />
        {footer}
      </div>
    </div>
  );
}

/**
 * "Explication Ultra-Détaillée" Studio Reader: font family / size / spacing
 * controls (remembered on this device), an auto-built Sommaire with
 * one-click jumps, a reading-progress bar, medical callout boxes, and a
 * distraction-free "Mode Lecture Zen" that lifts the lesson into a centered
 * full-screen canvas above every sidebar.
 */
export function ExplicationReader({ markdown, footer }: { markdown: string; footer?: ReactNode }) {
  const [prefs, setPrefsState] = useState<ReaderPrefs>(DEFAULT_PREFS);
  const [zen, setZen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const zenScrollRef = useRef<HTMLDivElement>(null);
  const normalized = useMemo(() => normalizeCallouts(markdown), [markdown]);

  useEffect(() => {
    setPrefsState(readPrefs());
    setMounted(true);
  }, []);

  const setPrefs = useCallback((updater: (p: ReaderPrefs) => ReaderPrefs) => {
    setPrefsState((prev) => {
      const next = updater(prev);
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // Storage blocked (private mode): the choice still applies for this session.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!zen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setZen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [zen]);

  return (
    <>
      {zen ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <p className="text-sm font-semibold text-foreground">Mode Lecture Zen actif</p>
          <button type="button" onClick={() => setZen(false)} className="rounded-xl border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground">
            Revenir au Studio
          </button>
        </div>
      ) : (
        <ReaderSurface markdown={normalized} prefs={prefs} setPrefs={setPrefs} zen={false} onToggleZen={() => setZen(true)} footer={footer} />
      )}

      {mounted &&
        createPortal(
          <AnimatePresence>
            {zen && (
              <motion.div
                key="zen"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-[9990] bg-[#fbfaf7] dark:bg-[#080b10]"
                role="dialog"
                aria-modal="true"
                aria-label="Mode Lecture Zen"
              >
                <div ref={zenScrollRef} className="h-full overflow-y-auto overscroll-contain [scrollbar-width:thin]">
                  <div className="mx-auto max-w-5xl">
                    <ReaderSurface markdown={normalized} prefs={prefs} setPrefs={setPrefs} zen onToggleZen={() => setZen(false)} footer={footer} scrollRootRef={zenScrollRef} />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
