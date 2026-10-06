"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import ReactMarkdown, { type Components, type Options as MarkdownOptions } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Crosshair,
  Eye,
  Layers,
  LayoutGrid,
  Lightbulb,
  RotateCcw,
  Sparkles,
  Stethoscope,
  Table2,
  Target,
  TriangleAlert,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { parseAnalogies, plainText, type AnalogyBlock, type AnalogySection, type SectionKind } from "@/lib/analogies/parse";
import { rehypeBidiTerms, TERM_CHIP_CLASS } from "@/lib/analogies/rehype-bidi-terms";

const arabicFont = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400", "500", "600", "700"], display: "swap" });

type ViewMode = "cards" | "focus" | "table";
const XP_PER_ANALOGY = 10;

// ─── Labels ─────────────────────────────────────────────────────────────────

/** Content-side labels follow the CONTENT's script (Darija → Arabic labels); controls follow the interface language. */
function contentLabels(rtl: boolean, language: Language) {
  if (rtl) {
    return {
      story: "القصة والتشبيه",
      clinical: "الواقع الطبي",
      result: "النتيجة",
      anchor: "الخلاصة الذهنية",
      kind: { concept: "مفهوم", trap: "فخ الامتحان", exam: "الفحص السريري", takeaway: "الخلاصة" } satisfies Record<SectionKind, string>,
      tableStory: "التشبيه الحياتي",
      tableClinical: "المفهوم الطبي",
      tableTrap: "الفخاخ السريرية",
    };
  }
  const fr = language === "fr";
  return {
    story: fr ? "L'image" : "The analogy",
    clinical: fr ? "La réalité clinique" : "Clinical reality",
    result: fr ? "Résultat" : "Result",
    anchor: fr ? "Point d'ancrage" : "Mental anchor",
    kind: fr
      ? { concept: "Concept", trap: "Piège d'examen", exam: "Examen clinique", takeaway: "À retenir" }
      : { concept: "Concept", trap: "Exam trap", exam: "Clinical exam", takeaway: "Key takeaway" },
    tableStory: fr ? "L'image" : "Analogy",
    tableClinical: fr ? "Le concept médical" : "Medical concept",
    tableTrap: fr ? "Le piège" : "The trap",
  };
}

const UI = {
  title: { fr: "Exemples & Analogies", en: "Examples & Analogies" },
  subtitle: { fr: "L'image d'abord, la clinique ensuite.", en: "The picture first, the clinic second." },
  analogies: { fr: "analogies", en: "analogies" },
  mastered: { fr: "maîtrisées", en: "mastered" },
  cards: { fr: "Cartes", en: "Cards" },
  focus: { fr: "Focus", en: "Focus" },
  table: { fr: "Tableau", en: "Table" },
  expandAll: { fr: "Tout déplier", en: "Expand all" },
  collapseAll: { fr: "Tout replier", en: "Collapse all" },
  copy: { fr: "Copier", en: "Copy" },
  copied: { fr: "Copié !", en: "Copied!" },
  flashcard: { fr: "Flashcard", en: "Flashcard" },
  exitFlashcard: { fr: "Quitter", en: "Exit" },
  understood: { fr: "Compris", en: "Got it" },
  recallPrompt: { fr: "Explique cette notion de mémoire — l'image, puis la clinique. Ensuite seulement, révèle.", en: "Explain this concept from memory — the picture, then the clinic. Only then reveal." },
  reveal: { fr: "Révéler la réponse", en: "Reveal the answer" },
  knewIt: { fr: "Je savais", en: "I knew it" },
  review: { fr: "À revoir", en: "Review again" },
  previous: { fr: "Précédent", en: "Previous" },
  next: { fr: "Suivant", en: "Next" },
  openCard: { fr: "Ouvrir la carte", en: "Open card" },
  allDone: { fr: "Toutes les analogies sont maîtrisées !", en: "Every analogy mastered!" },
  reset: { fr: "Réinitialiser", en: "Reset" },
} satisfies Record<string, Record<Language, string>>;

const KIND_STYLE: Record<SectionKind, { icon: LucideIcon; ring: string; medal: string; tag: string }> = {
  concept: {
    icon: Lightbulb,
    ring: "border-slate-200/80 dark:border-white/10",
    medal: "from-indigo-500 to-violet-500 shadow-indigo-500/30",
    tag: "border-indigo-300/50 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-200",
  },
  trap: {
    icon: TriangleAlert,
    ring: "border-rose-300/70 shadow-[0_0_0_1px_rgba(244,63,94,0.08),0_10px_30px_-12px_rgba(244,63,94,0.35)] dark:border-rose-400/30",
    medal: "from-rose-500 to-orange-500 shadow-rose-500/30",
    tag: "border-rose-300/60 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200",
  },
  exam: {
    icon: Stethoscope,
    ring: "border-emerald-300/70 dark:border-emerald-400/25",
    medal: "from-emerald-500 to-teal-500 shadow-emerald-500/30",
    tag: "border-emerald-300/60 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
  },
  takeaway: {
    icon: Target,
    ring: "border-amber-300/70 dark:border-amber-400/30",
    medal: "from-amber-400 to-orange-500 shadow-amber-500/30",
    tag: "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
  },
};

// ─── Markdown rendering (bidi-safe) ────────────────────────────────────────

function useMarkdownKit(rtl: boolean) {
  const rehypePlugins = useMemo<NonNullable<MarkdownOptions["rehypePlugins"]>>(() => [[rehypeBidiTerms, { enabled: rtl }]], [rtl]);
  const components = useMemo<Components>(
    () => ({
      p: ({ children }) => <p className="my-2.5 first:mt-0 last:mb-0">{children}</p>,
      ul: ({ children }) => <ul className="my-2.5 space-y-1.5 ps-1">{children}</ul>,
      ol: ({ children }) => <ol className="my-2.5 list-decimal space-y-1.5 ps-6 marker:font-bold marker:text-indigo-500">{children}</ol>,
      // Custom dot bullets for unordered lists; ordered lists keep their numbers (the dot is hidden inside <ol>).
      li: ({ children }) => (
        <li className="relative ps-5 [ol>&]:ps-0">
          <span aria-hidden className="absolute start-0 top-[0.95em] h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 [ol>li>&]:hidden" />
          {children}
        </li>
      ),
      strong: ({ children, ...props }) =>
        (props as Record<string, unknown>)["data-term"] ? (
          <bdi dir="ltr" className={cn(TERM_CHIP_CLASS, "font-bold")}>
            {children}
          </bdi>
        ) : (
          <strong className="rounded bg-amber-200/45 px-0.5 font-bold text-slate-900 [box-decoration-break:clone] dark:bg-amber-300/15 dark:text-white">{children}</strong>
        ),
      em: ({ children }) => <em className="text-slate-700 dark:text-slate-200">{children}</em>,
      h1: ({ children }) => <p className="my-3 font-bold">{children}</p>,
      h2: ({ children }) => <p className="my-3 font-bold">{children}</p>,
      h3: ({ children }) => <p className="my-3 font-bold">{children}</p>,
      h4: ({ children }) => <p className="my-2 font-bold">{children}</p>,
      blockquote: ({ children }) => (
        <blockquote className="my-3 rounded-xl border-s-4 border-sky-400 bg-sky-50/80 px-4 py-2.5 dark:bg-sky-400/10">{children}</blockquote>
      ),
      table: ({ children }) => (
        <div className="my-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
          <table className="w-full min-w-[420px] border-collapse text-[0.92em]">{children}</table>
        </div>
      ),
      th: ({ children }) => <th className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-start font-bold dark:border-white/10 dark:bg-white/5">{children}</th>,
      td: ({ children }) => <td className="border-b border-slate-100 px-3 py-2 align-top dark:border-white/5">{children}</td>,
      a: ({ children, href }) => (
        <a href={href} target="_blank" rel="noreferrer noopener" className="font-semibold text-indigo-600 underline underline-offset-2 dark:text-indigo-300">
          {children}
        </a>
      ),
    }),
    []
  );
  const inlineComponents = useMemo<Components>(() => ({ ...components, p: ({ children }) => <>{children}</> }), [components]);
  return { rehypePlugins, components, inlineComponents };
}

function Md({ markdown, kit, inline = false }: { markdown: string; kit: ReturnType<typeof useMarkdownKit>; inline?: boolean }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={kit.rehypePlugins} components={inline ? kit.inlineComponents : kit.components}>
      {markdown}
    </ReactMarkdown>
  );
}

// ─── Block grouping: story ↔ clinical split cards ──────────────────────────

type Segment =
  | { kind: "subheading"; markdown: string }
  | { kind: "pair"; story: AnalogyBlock[]; clinical: AnalogyBlock[] }
  | { kind: "story"; blocks: AnalogyBlock[] }
  | { kind: "clinical"; blocks: AnalogyBlock[] };

/** Consecutive runs of the same family; a story run directly followed by a clinical run becomes one split card. */
function segmentsOf(blocks: AnalogyBlock[]): Segment[] {
  const runs: Segment[] = [];
  for (const block of blocks) {
    const last = runs[runs.length - 1];
    if (block.type === "subheading") runs.push({ kind: "subheading", markdown: block.markdown });
    else if (block.type === "story") {
      if (last?.kind === "story") last.blocks.push(block);
      else runs.push({ kind: "story", blocks: [block] });
    } else if (last?.kind === "clinical") last.blocks.push(block);
    else runs.push({ kind: "clinical", blocks: [block] });
  }
  const out: Segment[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const next = runs[i + 1];
    if (run.kind === "story" && next?.kind === "clinical") {
      out.push({ kind: "pair", story: run.blocks, clinical: next.blocks });
      i++;
    } else out.push(run);
  }
  return out;
}

function LayerCard({ variant, label, children, rtl }: { variant: "story" | "clinical"; label: string; children: ReactNode; rtl: boolean }) {
  const story = variant === "story";
  return (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-2xl border p-4 sm:p-5",
        story
          ? "border-amber-500/20 bg-gradient-to-br from-amber-500/[0.07] to-orange-500/[0.03] dark:from-amber-500/10 dark:to-orange-500/[0.04]"
          : "border-indigo-500/20 bg-gradient-to-br from-indigo-500/[0.06] to-sky-500/[0.03] dark:from-indigo-500/10 dark:to-sky-500/[0.04]"
      )}
    >
      <div aria-hidden className={cn("pointer-events-none absolute -top-10 h-24 w-24 rounded-full blur-2xl", rtl ? "-left-8" : "-right-8", story ? "bg-amber-400/25" : "bg-indigo-400/25")} />
      <span
        className={cn(
          "relative mb-2.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold",
          story ? "border-amber-400/40 bg-amber-100/70 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200" : "border-indigo-400/40 bg-indigo-100/70 text-indigo-800 dark:bg-indigo-400/15 dark:text-indigo-200"
        )}
      >
        <span aria-hidden>{story ? "💡" : "🩺"}</span>
        {label}
      </span>
      <div className="relative">{children}</div>
    </div>
  );
}

function BlockList({ blocks, kit, labels, anchorBlock }: { blocks: AnalogyBlock[]; kit: ReturnType<typeof useMarkdownKit>; labels: ReturnType<typeof contentLabels>; anchorBlock: AnalogyBlock | null }) {
  return (
    <>
      {blocks
        .filter((block) => block !== anchorBlock)
        .map((block, i) =>
          block.type === "result" ? (
            <div key={i} className="my-2.5 rounded-xl border border-emerald-400/30 bg-emerald-500/[0.06] px-3 py-2">
              <span className="me-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">{labels.result} ←</span>
              <Md markdown={block.markdown} kit={kit} inline />
            </div>
          ) : (
            <Md key={i} markdown={block.markdown} kit={kit} />
          )
        )}
    </>
  );
}

function SectionBody({ section, kit, labels, rtl }: { section: AnalogySection; kit: ReturnType<typeof useMarkdownKit>; labels: ReturnType<typeof contentLabels>; rtl: boolean }) {
  // Same rule as parse.ts's `anchor`: only a section's ONLY result line becomes its anchor pill.
  const anchorBlock = useMemo(() => {
    const results = section.blocks.filter((b) => b.type === "result");
    return results.length === 1 ? results[0] : null;
  }, [section.blocks]);
  const segments = useMemo(() => segmentsOf(section.blocks), [section.blocks]);
  return (
    <div className="space-y-3">
      {segments.map((segment, i) => {
        if (segment.kind === "subheading") {
          return (
            <div key={i} className="flex items-center gap-2 pt-1">
              <span className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-300 dark:to-white/15" />
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[13px] font-bold text-slate-800 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-100">
                <Md markdown={segment.markdown} kit={kit} inline />
              </span>
              <span className="h-px flex-1 bg-gradient-to-r from-transparent to-slate-300 dark:to-white/15" />
            </div>
          );
        }
        if (segment.kind === "pair") {
          return (
            <div key={i} className="grid gap-3 lg:grid-cols-2">
              <LayerCard variant="story" label={labels.story} rtl={rtl}>
                <BlockList blocks={segment.story} kit={kit} labels={labels} anchorBlock={anchorBlock} />
              </LayerCard>
              <LayerCard variant="clinical" label={labels.clinical} rtl={rtl}>
                <BlockList blocks={segment.clinical} kit={kit} labels={labels} anchorBlock={anchorBlock} />
              </LayerCard>
            </div>
          );
        }
        const visible = segment.blocks.filter((b) => b !== anchorBlock);
        if (visible.length === 0) return null;
        return (
          <LayerCard key={i} variant={segment.kind} label={segment.kind === "story" ? labels.story : labels.clinical} rtl={rtl}>
            <BlockList blocks={segment.blocks} kit={kit} labels={labels} anchorBlock={anchorBlock} />
          </LayerCard>
        );
      })}

      {section.anchor && (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-400/40 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10 p-3.5 shadow-[0_0_24px_-8px_rgba(16,185,129,0.55)]">
          <span className="mb-1 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            <BrainCircuit className="h-3.5 w-3.5" />
            {labels.anchor}
          </span>
          <p className="font-semibold">
            <Md markdown={section.anchor} kit={kit} inline />
          </p>
        </div>
      )}
    </div>
  );
}

// ─── One analogy card ───────────────────────────────────────────────────────

interface CardProps {
  section: AnalogySection;
  rtl: boolean;
  fontClass: string;
  kit: ReturnType<typeof useMarkdownKit>;
  labels: ReturnType<typeof contentLabels>;
  language: Language;
  expanded: boolean;
  onToggle: () => void;
  mastered: boolean;
  onMastered: (value: boolean) => void;
  forceOpen?: boolean;
}

function AnalogyCard({ section, rtl, fontClass, kit, labels, language, expanded, onToggle, mastered, onMastered, forceOpen = false }: CardProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const [copied, setCopied] = useState(false);
  const [recall, setRecall] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [xpBurst, setXpBurst] = useState(0);
  const style = KIND_STYLE[section.kind];
  const KindIcon = style.icon;
  const open = forceOpen || expanded;
  const isTakeaway = section.kind === "takeaway";

  const copy = useCallback(async () => {
    const text = plainText(section.raw);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    haptic(8);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [section.raw]);

  const markMastered = (value: boolean) => {
    onMastered(value);
    if (value) {
      haptic([8, 40, 8]);
      setXpBurst((n) => n + 1);
    }
  };

  const showBody = open && (!recall || revealed);

  return (
    <motion.article
      id={section.id}
      layout={reduceMotion ? false : "position"}
      className={cn(
        "relative scroll-mt-24 overflow-hidden rounded-3xl border bg-white/80 shadow-sm backdrop-blur-sm dark:bg-slate-900/60",
        style.ring,
        isTakeaway && "bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-amber-500/10 dark:via-slate-900/60 dark:to-orange-500/10"
      )}
    >
      {/* Header — the whole row toggles. */}
      <button
        type="button"
        onClick={forceOpen ? undefined : onToggle}
        aria-expanded={open}
        className={cn("flex w-full items-center gap-3 p-4 text-start sm:p-5", !forceOpen && "cursor-pointer")}
        dir={rtl ? "rtl" : "ltr"}
      >
        <span className={cn("relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg", style.medal)}>
          {section.number ? <span className="font-sans text-lg font-black">{section.number}</span> : <KindIcon className="h-5 w-5" />}
          {mastered && (
            <span className="absolute -bottom-1 -end-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("mb-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold", style.tag)}>
            <KindIcon className="h-3 w-3" />
            {labels.kind[section.kind]}
          </span>
          <span className={cn("block text-[16px] font-bold leading-snug text-slate-900 dark:text-white sm:text-[17px]", fontClass)}>
            {section.emoji && <span className="me-1.5" aria-hidden>{section.emoji}</span>}
            <Md markdown={section.title} kit={kit} inline />
          </span>
        </span>
        {!forceOpen && (
          <ChevronDown className={cn("h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300", open && "rotate-180")} />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              {recall && !revealed ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-indigo-300 bg-indigo-50/60 px-4 py-6 text-center dark:border-indigo-400/30 dark:bg-indigo-400/5">
                  <BrainCircuit className="h-8 w-8 text-indigo-500" />
                  <p className="max-w-md text-sm text-slate-600 dark:text-slate-300">{UI.recallPrompt[language]}</p>
                  <button
                    type="button"
                    onClick={() => setRevealed(true)}
                    className="press-feedback inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 text-sm font-bold text-white shadow-lg shadow-indigo-500/25"
                  >
                    <Eye className="h-4 w-4" />
                    {UI.reveal[language]}
                  </button>
                </div>
              ) : (
                showBody && (
                  <div dir={rtl ? "rtl" : "ltr"} className={cn("text-[15.5px] leading-[1.95] text-slate-700 dark:text-slate-200 sm:text-base", fontClass)}>
                    <SectionBody section={section} kit={kit} labels={labels} rtl={rtl} />
                  </div>
                )
              )}

              {recall && revealed && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRevealed(false);
                      markMastered(false);
                    }}
                    className="press-feedback inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 dark:border-white/10 dark:text-slate-200"
                  >
                    <RotateCcw className="h-4 w-4" />
                    {UI.review[language]}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      markMastered(true);
                      setRecall(false);
                      setRevealed(false);
                    }}
                    className="press-feedback inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-sm font-bold text-white shadow-lg shadow-emerald-500/25"
                  >
                    <Check className="h-4 w-4" />
                    {UI.knewIt[language]}
                  </button>
                </div>
              )}

              {/* Actions — interface language, always left-to-right. */}
              <div dir="ltr" className="relative mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-white/5">
                <ActionButton onClick={copy} icon={copied ? Check : Copy} active={copied} label={copied ? UI.copied[language] : UI.copy[language]} />
                <ActionButton
                  onClick={() => {
                    setRecall((v) => !v);
                    setRevealed(false);
                  }}
                  icon={Layers}
                  active={recall}
                  label={recall ? UI.exitFlashcard[language] : UI.flashcard[language]}
                />
                <div className="flex-1" />
                <ActionButton onClick={() => markMastered(!mastered)} icon={Check} active={mastered} tone="emerald" label={UI.understood[language]} />
                <AnimatePresence>
                  {xpBurst > 0 && (
                    <motion.span
                      key={xpBurst}
                      initial={{ opacity: 0, y: 0, scale: 0.8 }}
                      animate={{ opacity: [0, 1, 1, 0], y: -34, scale: 1 }}
                      transition={{ duration: 1.1, ease: "easeOut" }}
                      className="pointer-events-none absolute -top-2 right-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-black text-white shadow-lg shadow-emerald-500/40"
                    >
                      +{XP_PER_ANALOGY} XP
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function ActionButton({ onClick, icon: Icon, label, active = false, tone = "indigo" }: { onClick: () => void; icon: LucideIcon; label: string; active?: boolean; tone?: "indigo" | "emerald" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "press-feedback inline-flex h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors sm:h-10",
        active
          ? tone === "emerald"
            ? "border-emerald-400/60 bg-emerald-500 text-white"
            : "border-indigo-400/60 bg-indigo-500 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:text-white"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

// ─── Table view ─────────────────────────────────────────────────────────────

function excerpt(blocks: AnalogyBlock[], types: AnalogyBlock["type"][]): string {
  return plainText(blocks.filter((b) => types.includes(b.type)).map((b) => b.markdown).join("\n\n"));
}

function TableView({ sections, rtl, fontClass, kit, labels, language, onOpen }: { sections: AnalogySection[]; rtl: boolean; fontClass: string; kit: ReturnType<typeof useMarkdownKit>; labels: ReturnType<typeof contentLabels>; language: Language; onOpen: (id: string) => void }) {
  const rows = sections.filter((s) => s.kind !== "takeaway");
  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white/80 shadow-sm dark:border-white/10 dark:bg-slate-900/60">
      <table dir={rtl ? "rtl" : "ltr"} className={cn("w-full min-w-[760px] border-collapse text-[14px] leading-relaxed", fontClass)}>
        <thead>
          <tr className="text-start text-[12px] font-black text-slate-500 dark:text-slate-400">
            <th className="w-[22%] border-b border-slate-200 px-4 py-3 text-start dark:border-white/10">#</th>
            <th className="border-b border-slate-200 px-4 py-3 text-start dark:border-white/10">
              <span className="me-1" aria-hidden>💡</span>
              {labels.tableStory}
            </th>
            <th className="border-b border-slate-200 px-4 py-3 text-start dark:border-white/10">
              <span className="me-1" aria-hidden>🩺</span>
              {labels.tableClinical}
            </th>
            <th className="w-[22%] border-b border-slate-200 px-4 py-3 text-start dark:border-white/10">
              <span className="me-1" aria-hidden>🚨</span>
              {labels.tableTrap}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((section) => {
            const story = excerpt(section.blocks, ["story"]);
            const clinical = excerpt(section.blocks, ["clinical", "body", "result"]);
            const trap = section.kind === "trap";
            return (
              <tr key={section.id} className="group align-top transition-colors hover:bg-indigo-50/50 dark:hover:bg-white/[0.03]">
                <td className="border-b border-slate-100 px-4 py-3 dark:border-white/5">
                  <button type="button" onClick={() => onOpen(section.id)} className="text-start font-bold text-slate-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-300" title={UI.openCard[language]}>
                    {section.emoji && <span className="me-1" aria-hidden>{section.emoji}</span>}
                    <Md markdown={section.title} kit={kit} inline />
                  </button>
                </td>
                <td className="border-b border-slate-100 px-4 py-3 dark:border-white/5">
                  <p className="line-clamp-5 text-slate-700 dark:text-slate-300">{story ? <Md markdown={story} kit={kit} inline /> : "—"}</p>
                </td>
                <td className="border-b border-slate-100 px-4 py-3 dark:border-white/5">
                  <p className="line-clamp-5 text-slate-700 dark:text-slate-300">{!trap && clinical ? <Md markdown={clinical} kit={kit} inline /> : "—"}</p>
                </td>
                <td className={cn("border-b border-slate-100 px-4 py-3 dark:border-white/5", trap && "bg-rose-50/60 dark:bg-rose-500/[0.06]")}>
                  <p className="line-clamp-5 text-slate-700 dark:text-slate-300">{trap && clinical ? <Md markdown={clinical} kit={kit} inline /> : "—"}</p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Canvas ─────────────────────────────────────────────────────────────────

function storageKey(courseId: number): string {
  return `medart:analogies:${courseId}`;
}

function readMastered(courseId: number): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(courseId)) ?? "{}");
    const list = (parsed as { mastered?: unknown }).mastered;
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function ProgressRing({ value, total }: { value: number; total: number }) {
  const pct = total === 0 ? 0 : value / total;
  const c = 2 * Math.PI * 20;
  return (
    <svg viewBox="0 0 48 48" className="h-14 w-14 -rotate-90" aria-hidden>
      <circle cx="24" cy="24" r="20" fill="none" strokeWidth="5" className="stroke-white/25" />
      <motion.circle
        cx="24"
        cy="24"
        r="20"
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        className="stroke-white"
        strokeDasharray={c}
        initial={false}
        animate={{ strokeDashoffset: c * (1 - pct) }}
        transition={{ type: "spring", stiffness: 120, damping: 20 }}
      />
    </svg>
  );
}

/**
 * "Elite Analogy Canvas" — the Studio's Exemples & Analogies tab.
 *
 * Renders the stored Markdown (unchanged, see lib/analogies/parse.ts) as
 * structured cards: each numbered concept becomes a split card — the
 * real-world story (amber) next to its clinical translation (indigo) —
 * with exam-trap and clinical-exam sections styled apart, the section's own
 * "النتيجة" line surfaced as its mental anchor, French terms isolated as
 * left-to-right chips (no more bidi scrambling), and three views: cards,
 * one-at-a-time focus, and a comparison table. Progress ("compris") is kept
 * per course on this device.
 *
 * Falls back to the plain Markdown article when no section structure is
 * detected, so no generation can ever render as an empty canvas.
 */
export function AnalogyCanvas({ courseId, markdown, fallback }: { courseId: number; markdown: string; fallback: ReactNode }) {
  const { language } = useLanguage();
  const reduceMotion = useReducedMotion() ?? false;
  const parsed = useMemo(() => parseAnalogies(markdown), [markdown]);
  const { sections, rtl, intro } = parsed;
  const kit = useMarkdownKit(rtl);
  const labels = contentLabels(rtl, language);
  const fontClass = rtl ? arabicFont.className : "";

  const [view, setView] = useState<ViewMode>("cards");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [mastered, setMastered] = useState<Set<string>>(() => new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    setMastered(new Set(readMastered(courseId)));
    loaded.current = true;
  }, [courseId]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(storageKey(courseId), JSON.stringify({ mastered: Array.from(mastered) }));
    } catch {
      // Storage blocked: progress simply lasts for this visit.
    }
  }, [mastered, courseId]);

  const setSectionMastered = useCallback((id: string, value: boolean) => {
    setMastered((prev) => {
      const next = new Set(prev);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Focus mode: ← / → step through the analogies (reading order follows the content direction).
  useEffect(() => {
    if (view !== "focus") return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const forward = rtl ? "ArrowLeft" : "ArrowRight";
      const backward = rtl ? "ArrowRight" : "ArrowLeft";
      if (event.key === forward) setFocusIndex((i) => Math.min(sections.length - 1, i + 1));
      if (event.key === backward) setFocusIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, rtl, sections.length]);

  const openFromTable = useCallback((id: string) => {
    setView("cards");
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, []);

  if (sections.length < 2) return <>{fallback}</>;

  const total = sections.length;
  const masteredCount = sections.filter((s) => mastered.has(s.id)).length;
  const allCollapsed = collapsed.size === total;
  const focusSection = sections[Math.min(focusIndex, total - 1)];

  const views: { id: ViewMode; label: string; icon: LucideIcon }[] = [
    { id: "cards", label: UI.cards[language], icon: LayoutGrid },
    { id: "focus", label: UI.focus[language], icon: Crosshair },
    { id: "table", label: UI.table[language], icon: Table2 },
  ];

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 via-orange-500 to-indigo-600 p-[1.5px] shadow-xl shadow-orange-500/15">
        <div className="relative flex flex-wrap items-center gap-4 overflow-hidden rounded-[calc(1.5rem-1.5px)] bg-gradient-to-br from-amber-500/95 via-orange-500/95 to-indigo-600/95 p-4 text-white sm:p-5">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
          <div className="relative">
            <ProgressRing value={masteredCount} total={total} />
            <span className="absolute inset-0 flex items-center justify-center font-sans text-sm font-black">
              {masteredCount}/{total}
            </span>
          </div>
          <div className="relative min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white/80">
              <Sparkles className="h-3.5 w-3.5" />
              {UI.subtitle[language]}
            </p>
            <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">{UI.title[language]}</h2>
            <p className="mt-0.5 text-xs font-semibold text-white/85">
              {total} {UI.analogies[language]} · {masteredCount} {UI.mastered[language]} · {masteredCount * XP_PER_ANALOGY} XP
            </p>
          </div>
          {masteredCount === total && (
            <motion.span
              initial={reduceMotion ? false : { scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              className="relative inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-bold backdrop-blur"
            >
              <Trophy className="h-4 w-4" />
              {UI.allDone[language]}
            </motion.span>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="inline-flex rounded-2xl border border-slate-200 bg-white/80 p-1 shadow-sm dark:border-white/10 dark:bg-slate-900/60">
          {views.map((option) => {
            const active = view === option.id;
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setView(option.id)}
                className={cn("relative inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold transition-colors", active ? "text-white" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white")}
              >
                {active && (
                  <motion.span layoutId="analogy-view-pill" className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 shadow-md shadow-indigo-500/30" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
                )}
                <Icon className="relative h-4 w-4" />
                <span className="relative">{option.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        {view === "cards" && (
          <button
            type="button"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(sections.map((s) => s.id)))}
            className="press-feedback inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white/80 px-3 text-xs font-bold text-slate-600 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300"
          >
            {allCollapsed ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />}
            {allCollapsed ? UI.expandAll[language] : UI.collapseAll[language]}
          </button>
        )}
        {masteredCount > 0 && (
          <button
            type="button"
            onClick={() => setMastered(new Set())}
            className="press-feedback inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {UI.reset[language]}
          </button>
        )}
      </div>

      {intro && view !== "table" && (
        <div dir={rtl ? "rtl" : "ltr"} className={cn("rounded-2xl border border-slate-200 bg-white/70 p-4 text-[15px] leading-[1.9] text-slate-700 dark:border-white/10 dark:bg-slate-900/50 dark:text-slate-200", fontClass)}>
          <Md markdown={intro} kit={kit} />
        </div>
      )}

      {view === "cards" && (
        <div className="space-y-3">
          {sections.map((section) => (
            <AnalogyCard
              key={section.id}
              section={section}
              rtl={rtl}
              fontClass={fontClass}
              kit={kit}
              labels={labels}
              language={language}
              expanded={!collapsed.has(section.id)}
              onToggle={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(section.id)) next.delete(section.id);
                  else next.add(section.id);
                  return next;
                })
              }
              mastered={mastered.has(section.id)}
              onMastered={(value) => setSectionMastered(section.id, value)}
            />
          ))}
        </div>
      )}

      {view === "focus" && focusSection && (
        <div className="space-y-3">
          {/* Segmented progress: one segment per analogy, green when mastered. */}
          <div dir={rtl ? "rtl" : "ltr"} className="flex gap-1">
            {sections.map((section, i) => (
              <button
                key={section.id}
                type="button"
                aria-label={`${i + 1}`}
                onClick={() => setFocusIndex(i)}
                className={cn(
                  "h-2 flex-1 rounded-full transition-colors",
                  i === focusIndex ? "bg-gradient-to-r from-indigo-500 to-violet-500" : mastered.has(section.id) ? "bg-emerald-400" : "bg-slate-200 dark:bg-white/10"
                )}
              />
            ))}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={focusSection.id}
              initial={reduceMotion ? false : { opacity: 0, x: rtl ? -40 : 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: rtl ? 40 : -40 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              <AnalogyCard
                section={focusSection}
                rtl={rtl}
                fontClass={fontClass}
                kit={kit}
                labels={labels}
                language={language}
                expanded
                forceOpen
                onToggle={() => undefined}
                mastered={mastered.has(focusSection.id)}
                onMastered={(value) => setSectionMastered(focusSection.id, value)}
              />
            </motion.div>
          </AnimatePresence>
          <div dir="ltr" className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 lg:bottom-4">
            <button
              type="button"
              onClick={() => setFocusIndex((i) => Math.max(0, i - 1))}
              disabled={focusIndex === 0}
              className="press-feedback inline-flex h-12 items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white/95 text-sm font-bold text-slate-700 shadow-lg disabled:opacity-40 dark:border-white/10 dark:bg-slate-900/95 dark:text-slate-200"
            >
              <ChevronLeft className="h-4 w-4" />
              {UI.previous[language]}
            </button>
            <span className="rounded-full bg-slate-900/80 px-3 py-1 font-sans text-xs font-bold text-white dark:bg-white/15">
              {focusIndex + 1} / {total}
            </span>
            <button
              type="button"
              onClick={() => setFocusIndex((i) => Math.min(total - 1, i + 1))}
              disabled={focusIndex === total - 1}
              className="press-feedback inline-flex h-12 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-40"
            >
              {UI.next[language]}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {view === "table" && <TableView sections={sections} rtl={rtl} fontClass={fontClass} kit={kit} labels={labels} language={language} onOpen={openFromTable} />}
    </div>
  );
}
