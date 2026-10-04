"use client";

import "./synthesis.css";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpenText,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  FileDown,
  Highlighter,
  Link2,
  Printer,
  Search,
  Sheet,
  Square,
  Tags,
  Volume2,
  X,
} from "lucide-react";
import { MedicalMarkdown } from "@/components/reader/MedicalMarkdown";
import { normalizeCallouts } from "@/lib/markdown";
import {
  cleanCourseTitle,
  detectSynthesisKind,
  matchesQuery,
  parseDictionary,
  parseKeywords,
  parseSections,
  stripInlineMarkdown,
  type DictionaryEntry,
  type KeywordItem,
  type Priority,
  type SynthesisKind,
  type SynthesisSection,
} from "@/lib/synthesis-parse";
import { cn } from "@/lib/utils";

/* ─────────────────────────── term highlighting ─────────────────────────── */

const PATHO_SUFFIX = /(?:ites?|oses?|émies?|algies?|pathies?|ectomies?|otomies?|omes?|plasies?|trophies?|uries?|pnées?|cardies?|rragies?|lyses?|sténoses?|scléroses?)$/i;
const NOT_PATHO = new Set([
  "chose", "choses", "dose", "doses", "rose", "roses", "pose", "poses", "prose", "cause", "causes", "site", "sites", "suite", "suites", "vite",
  "limite", "limites", "ensuite", "élite", "rite", "rites", "gîte", "composite", "favorite", "comme", "homme", "hommes", "somme", "sommes",
  "forme", "formes", "norme", "normes", "énorme", "énormes", "même", "mêmes", "thème", "thèmes", "système", "systèmes", "problème", "problèmes",
  "programme", "programmes", "diplôme", "diplômes", "symptôme", "symptômes", "axiome", "nome", "dôme", "arôme", "chrome", "génome", "génomes",
  "analyse", "analyses", "dialyse", "catalyse", "hypothèse", "synthèse", "parenthèse", "thèse", "phrase", "base", "bases", "phase", "phases",
  "visite", "visites", "réussite", "petite", "petites", "écrite", "écrites", "décrite", "décrites", "inscrite", "dite", "dites", "faite", "faites",
  "conduite", "produite", "réduite", "traduite", "induite", "construite", "proposée", "opposite", "satellite", "insolite", "gratuite", "fortuite",
]);
const ANATOMY = new Set(
  (
    "artère artères veine veines nerf nerfs muscle muscles os ligament ligaments tendon tendons valve valves ventricule ventricules oreillette oreillettes " +
    "aorte rein reins foie poumon poumons cerveau cervelet moelle glande glandes thyroïde hypophyse surrénale surrénales pancréas rate estomac " +
    "duodénum jéjunum iléon côlon rectum œsophage trachée bronche bronches alvéole alvéoles plèvre péricarde myocarde endocarde cœur coeur " +
    "uretère uretères vessie urètre prostate utérus ovaire ovaires testicule testicules néphron néphrons glomérule glomérules tubule tubules " +
    "cortex médullaire hypothalamus thalamus hippocampe vertèbre vertèbres fémur tibia humérus radius cubitus crâne bassin diaphragme " +
    "lymphocyte lymphocytes neutrophile neutrophiles macrophage macrophages plaquette plaquettes hématie hématies érythrocyte érythrocytes " +
    "récepteur récepteurs hormone hormones enzyme enzymes anticorps antigène antigènes bactérie bactéries virus syndrome syndromes"
  ).split(" ")
);

const WORD_SPLIT = /([A-Za-zÀ-ÖØ-öø-ÿŒœÆæ'-]+)/;

function foldWord(word: string): string {
  return word.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function buildDecorator(query: string, medical: boolean): ((text: string) => ReactNode) | undefined {
  const queryWords = query
    .split(/\s+/)
    .map(foldWord)
    .filter((w) => w.length >= 2);
  if (!medical && queryWords.length === 0) return undefined;
  return (text: string) => {
    const parts = text.split(WORD_SPLIT);
    if (parts.length === 1) return text;
    return parts.map((part, i) => {
      if (i % 2 === 0 || !part) return <Fragment key={i}>{part}</Fragment>;
      const folded = foldWord(part);
      if (queryWords.some((q) => folded.includes(q))) return <mark key={i} className="syn-mark-query">{part}</mark>;
      if (medical) {
        const lower = part.toLowerCase();
        if (ANATOMY.has(lower)) return <span key={i} className="syn-mark-anat" title="Structure anatomique / biologique">{part}</span>;
        if (part.length >= 5 && PATHO_SUFFIX.test(lower) && !NOT_PATHO.has(lower)) return <span key={i} className="syn-mark-patho" title="Terme pathologique">{part}</span>;
      }
      return <Fragment key={i}>{part}</Fragment>;
    });
  };
}

/* ─────────────────────────── small UI atoms ─────────────────────────── */

const PRIORITY_META: Record<Priority, { label: string; className: string; title: string }> = {
  essentiel: {
    label: "Essentiel",
    className: "bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300",
    title: "Défini dans plusieurs de tes cours ou cité au moins 3 fois",
  },
  important: { label: "Important", className: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300", title: "Cité 2 fois dans tes cours" },
  standard: { label: "Standard", className: "bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300", title: "Cité une fois" },
};

function PriorityBadge({ priority }: { priority: Priority }) {
  const meta = PRIORITY_META[priority];
  return (
    <span title={meta.title} className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1 ring-inset", meta.className)}>
      {meta.label}
    </span>
  );
}

function IconAction({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-bold transition-all active:scale-95",
        active
          ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200"
          : "border-black/10 bg-white/70 text-slate-700 hover:border-cyan-400/50 hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition-colors",
        active ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-black/[0.05] text-slate-600 hover:bg-black/10 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:bg-white/10"
      )}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────── exports ─────────────────────────── */

function download(fileName: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 100) || "synthese";
}

/** PDF through the browser's print dialog, with the app's own styles cloned into a clean light window. */
function printAsPdf(element: HTMLElement, title: string): boolean {
  const win = window.open("", "_blank", "width=960,height=1100");
  if (!win) return false;
  const styles = Array.from(document.querySelectorAll<HTMLElement>('link[rel="stylesheet"], style'))
    .map((n) => n.outerHTML)
    .join("\n");
  const esc = title.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c);
  win.document.open();
  win.document.write(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc}</title>${styles}<style>@page{margin:14mm}html,body{background:#fff!important}body{padding:0;margin:0;color:#0f172a}.wrap{max-width:820px;margin:0 auto;padding:20px 8px}.syn-card{break-inside:avoid;box-shadow:none!important;animation:none!important}.syn-card::before{display:none}[data-print-hide]{display:none!important}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body><div class="wrap"><h1 style="font-size:24px;font-weight:800;margin:0 0 4px">${esc}</h1><p style="font-size:11px;color:#64748b;margin:0 0 16px;text-transform:uppercase;letter-spacing:.08em">MedArt · Synthèse de module</p>${element.innerHTML}</div></body></html>`
  );
  win.document.close();
  const go = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === "complete") setTimeout(go, 400);
  else win.addEventListener("load", () => setTimeout(go, 250));
  return true;
}

/* ─────────────────────────── text-to-speech ─────────────────────────── */

function useSpeech() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  // Detected after mount: the server render has no speechSynthesis, so reading it during render would break hydration.
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported("speechSynthesis" in window);
    return () => window.speechSynthesis?.cancel();
  }, []);
  const speak = useCallback(
    (id: string, segments: { text: string; lang: "fr-FR" | "ar" }[]) => {
      if (!supported) return;
      window.speechSynthesis.cancel();
      if (speakingId === id) {
        setSpeakingId(null);
        return;
      }
      const voices = window.speechSynthesis.getVoices();
      segments
        .filter((s) => s.text.trim())
        .forEach((segment, i, all) => {
          const u = new SpeechSynthesisUtterance(stripInlineMarkdown(segment.text));
          u.lang = segment.lang;
          const voice = voices.find((v) => v.lang.toLowerCase().startsWith(segment.lang.slice(0, 2)));
          if (voice) u.voice = voice;
          u.rate = 1;
          if (i === all.length - 1) u.onend = () => setSpeakingId(null);
          window.speechSynthesis.speak(u);
        });
      setSpeakingId(id);
    },
    [speakingId, supported]
  );
  return { speak, speakingId, supported };
}

/* ─────────────────────────── views ─────────────────────────── */

const ACCENTS: [string, string][] = [
  ["#22d3ee", "#a78bfa"],
  ["#34d399", "#22d3ee"],
  ["#f59e0b", "#f43f5e"],
  ["#818cf8", "#ec4899"],
  ["#2dd4bf", "#60a5fa"],
];

function accentStyle(i: number): CSSProperties {
  const [a, b] = ACCENTS[i % ACCENTS.length];
  return { ["--syn-accent" as string]: a, ["--syn-accent-2" as string]: b, animationDelay: `${Math.min(i, 12) * 40}ms` };
}

function SectionCard({
  section,
  index,
  open,
  onToggle,
  decorate,
  onCopy,
  copied,
}: {
  section: SynthesisSection;
  index: number;
  open: boolean;
  onToggle: () => void;
  decorate?: (text: string) => ReactNode;
  onCopy: () => void;
  copied: boolean;
}) {
  const title = section.isCrossCourse ? section.title : cleanCourseTitle(section.title);
  return (
    <article className="syn-card overflow-hidden" data-open={open} style={section.isCrossCourse ? { ["--syn-accent" as string]: "#a78bfa", ["--syn-accent-2" as string]: "#f472b6" } : accentStyle(index)}>
      <header className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-[0_8px_20px_-8px_rgba(34,211,238,0.8)]",
              section.isCrossCourse ? "bg-gradient-to-br from-violet-500 to-fuchsia-500" : "bg-gradient-to-br from-cyan-400 to-violet-500"
            )}
          >
            {section.isCrossCourse ? <Link2 className="h-4 w-4" /> : <span className="text-xs font-black">{index + 1}</span>}
          </span>
          <span className="min-w-0">
            <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{section.isCrossCourse ? "Synthèse transversale" : "Cours"}</span>
            <span className="block truncate text-[15px] font-black text-slate-900 dark:text-white">{title || "Synthèse"}</span>
          </span>
          <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
        </button>
        <button type="button" onClick={onCopy} data-print-hide title="Copier cette fiche" aria-label="Copier cette fiche" className="rounded-lg p-1.5 text-slate-400 hover:bg-black/5 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white">
          {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
        </button>
      </header>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <div className="border-t border-black/5 px-4 pb-5 pt-3 text-[15px] sm:px-6 dark:border-white/[0.06]">
              <MedicalMarkdown markdown={normalizeCallouts(section.body)} decorate={decorate} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

function DictionaryCard({
  entry,
  index,
  open,
  onToggle,
  decorate,
  onCopy,
  copied,
  speech,
}: {
  entry: DictionaryEntry;
  index: number;
  open: boolean;
  onToggle: () => void;
  decorate?: (text: string) => ReactNode;
  onCopy: () => void;
  copied: boolean;
  speech: ReturnType<typeof useSpeech>;
}) {
  const deco = (text: string) => (decorate ? decorate(text) : text);
  return (
    <article className="syn-card flex flex-col" data-open={open} style={accentStyle(index)}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-start gap-3 px-4 pb-2 pt-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-black leading-snug text-slate-900 dark:text-white">{deco(entry.term)}</span>
            <PriorityBadge priority={entry.priority} />
          </span>
          <span className="mt-1 block truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">{entry.course}</span>
        </span>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      <p className={cn("px-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300", !open && "line-clamp-2")}>{deco(stripInlineMarkdown(entry.fr))}</p>
      <AnimatePresence initial={false}>
        {open && entry.ar && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            dir="rtl"
            lang="ar"
            className="mx-4 mt-3 overflow-hidden rounded-xl bg-emerald-500/[0.08] px-3 py-2 text-[15px] leading-loose text-emerald-900 dark:text-emerald-100"
          >
            {stripInlineMarkdown(entry.ar)}
          </motion.p>
        )}
      </AnimatePresence>
      <footer className="mt-auto flex items-center gap-1 px-3 pb-3 pt-3" data-print-hide>
        {speech.supported && (
          <button
            type="button"
            onClick={() =>
              speech.speak(entry.id, [
                { text: `${entry.term}. ${entry.fr}`, lang: "fr-FR" },
                ...(open && entry.ar ? [{ text: entry.ar, lang: "ar" as const }] : []),
              ])
            }
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-bold transition-colors",
              speech.speakingId === entry.id ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-200" : "text-slate-500 hover:bg-black/5 dark:hover:bg-white/10"
            )}
          >
            {speech.speakingId === entry.id ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            {speech.speakingId === entry.id ? "Stop" : open && entry.ar ? "Écouter FR + AR" : "Écouter"}
          </button>
        )}
        <button type="button" onClick={onCopy} className="ml-auto flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-bold text-slate-500 hover:bg-black/5 dark:hover:bg-white/10">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          Copier
        </button>
      </footer>
    </article>
  );
}

function KeywordChip({ item, decorate, open, onToggle }: { item: KeywordItem; decorate?: (text: string) => ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "w-full rounded-xl border px-3 py-2 text-left transition-colors",
          open ? "border-violet-400/50 bg-violet-500/10" : "border-black/[0.06] bg-white/60 hover:border-violet-400/40 dark:border-white/[0.07] dark:bg-white/[0.03]"
        )}
      >
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-[13px] font-bold leading-snug text-slate-900 dark:text-white">{decorate ? decorate(item.keyword) : item.keyword}</span>
          {item.priority !== "standard" && <PriorityBadge priority={item.priority} />}
        </span>
        {item.explanation && <span className={cn("mt-1 block text-xs leading-relaxed text-slate-600 dark:text-slate-400", !open && "line-clamp-1")}>{decorate ? decorate(item.explanation) : item.explanation}</span>}
      </button>
    </li>
  );
}

/* ─────────────────────────── explorer ─────────────────────────── */

/**
 * Module Synthesis explorer — replaces the plain Markdown rendering of the
 * three Workspace outputs with dedicated, interactive views:
 *  - Résumé global: collapsible per-course "fiches" (rich medical renderer:
 *    callouts, tables), cross-course synthesis highlighted.
 *  - Dictionnaire: one card per term (FR + Arabic on expand), A-Z sorted,
 *    listen (speech synthesis FR/AR), copy per term, CSV export (Anki-ready).
 *  - Tableau des mots-clés: per-course boards grouped by category, with
 *    expandable keyword chips and category filters.
 * Shared: instant search with highlighting, priority filters (computed from
 * how often a term recurs across the selected courses — never invented),
 * medical term highlighting (pathology vs anatomy), copy / Markdown / PDF
 * export. The content itself is exactly what the generator produced.
 */
export function SynthesisExplorer({ markdown, kind: kindProp, title }: { markdown: string; kind?: SynthesisKind | null; title: string }) {
  const kind = kindProp ?? detectSynthesisKind(markdown);
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [medical, setMedical] = useState(true);
  const [priorities, setPriorities] = useState<Set<Priority>>(new Set());
  const [course, setCourse] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState(kind === "global_summary");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const speech = useSpeech();

  const sections = useMemo(() => (kind === "global_summary" ? parseSections(markdown) : []), [kind, markdown]);
  const dictionary = useMemo(() => (kind === "medical_dictionary" ? parseDictionary(markdown) : null), [kind, markdown]);
  const keywords = useMemo(() => (kind === "keywords_table" ? parseKeywords(markdown) : null), [kind, markdown]);
  const decorate = useMemo(() => buildDecorator(query, medical), [query, medical]);

  useEffect(() => {
    setQuery("");
    setPriorities(new Set());
    setCourse(null);
    setCategory(null);
    setOpenIds(new Set());
    setAllOpen(kind === "global_summary");
  }, [markdown, kind]);

  const isOpen = (id: string) => (allOpen ? !openIds.has(id) : openIds.has(id));
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setAll = (open: boolean) => {
    setAllOpen(open);
    setOpenIds(new Set());
  };

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
    } catch {
      setCopiedId(null);
    }
  }

  const priorityOk = (p: Priority) => priorities.size === 0 || priorities.has(p);

  const visibleSections = sections.filter((s) => matchesQuery(query, s.title, s.body));
  const dictEntries = (dictionary?.entries ?? [])
    .filter((e) => priorityOk(e.priority) && (!course || e.course === course) && matchesQuery(query, e.term, e.fr, e.ar))
    .sort((a, b) => a.term.localeCompare(b.term, "fr", { sensitivity: "base" }));
  const dictCourses = [...new Set((dictionary?.entries ?? []).map((e) => e.course))];
  const kwItems = (keywords?.items ?? []).filter(
    (i) => priorityOk(i.priority) && (!category || i.category === category) && (!course || i.course === course) && matchesQuery(query, i.keyword, i.explanation, i.category)
  );

  const resultCount = kind === "global_summary" ? visibleSections.length : kind === "medical_dictionary" ? dictEntries.length : kwItems.length;
  const unit = kind === "global_summary" ? "fiche" : kind === "medical_dictionary" ? "terme" : "mot-clé";

  function exportCsv() {
    if (kind === "medical_dictionary") {
      const rows = dictEntries.map((e) => [e.term, stripInlineMarkdown(e.fr), stripInlineMarkdown(e.ar), e.course, PRIORITY_META[e.priority].label].map(csvCell).join(","));
      download(`${safeName(title)} - dictionnaire.csv`, `\uFEFF${["Terme,Explication,Arabe,Cours,Priorité", ...rows].join("\n")}`, "text/csv;charset=utf-8");
    } else if (kind === "keywords_table") {
      const rows = kwItems.map((i) => [i.course, i.category, i.keyword, i.explanation, PRIORITY_META[i.priority].label].map(csvCell).join(","));
      download(`${safeName(title)} - mots-cles.csv`, `\uFEFF${["Cours,Catégorie,Mot-clé,Explication,Priorité", ...rows].join("\n")}`, "text/csv;charset=utf-8");
    }
  }

  const togglePriority = (p: Priority) =>
    setPriorities((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const courseOptions = kind === "medical_dictionary" ? dictCourses : kind === "keywords_table" ? keywords?.courses ?? [] : [];
  const KindIcon = kind === "medical_dictionary" ? BookOpenText : kind === "keywords_table" ? Tags : Sheet;

  return (
    <div className="flex flex-col gap-4">
      {/* Command bar */}
      <div className="sticky top-0 z-20 -mx-1 rounded-2xl border border-black/10 bg-white/90 p-2.5 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.5)] backdrop-blur-xl dark:border-white/10 dark:bg-[#0b1016]/90" data-print-hide>
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 text-white sm:flex">
            <KindIcon className="h-4 w-4" />
          </span>
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={kind === "medical_dictionary" ? "Rechercher un terme, une définition…" : kind === "keywords_table" ? "Rechercher un mot-clé…" : "Rechercher dans les fiches…"}
              aria-label="Recherche instantanée"
              className="h-9 w-full rounded-xl border border-black/10 bg-white pl-9 pr-8 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-cyan-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Effacer" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <IconAction label="Surligner les termes médicaux" onClick={() => setMedical((m) => !m)} active={medical}>
            <Highlighter className="h-3.5 w-3.5" />
            <span className="max-sm:hidden">Termes</span>
          </IconAction>
          {kind !== "keywords_table" && (
            <IconAction label={allOpen ? "Tout replier" : "Tout déplier"} onClick={() => setAll(!allOpen)}>
              {allOpen ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
            </IconAction>
          )}
          <IconAction label="Copier tout" onClick={() => void copy("__all", markdown)}>
            {copiedId === "__all" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </IconAction>
          <IconAction label="Exporter en Markdown" onClick={() => download(`${safeName(title)}.md`, markdown, "text/markdown;charset=utf-8")}>
            <FileDown className="h-3.5 w-3.5" />
            <span className="max-sm:hidden">.md</span>
          </IconAction>
          {kind !== "global_summary" && (
            <IconAction label="Exporter en CSV (Excel, Anki)" onClick={exportCsv}>
              <Sheet className="h-3.5 w-3.5" />
              <span className="max-sm:hidden">CSV</span>
            </IconAction>
          )}
          <IconAction
            label="Exporter en PDF"
            onClick={() => {
              setAll(true);
              setTimeout(() => {
                if (rootRef.current) printAsPdf(rootRef.current, title);
              }, 350);
            }}
          >
            <Printer className="h-3.5 w-3.5" />
            <span className="max-sm:hidden">PDF</span>
          </IconAction>
        </div>

        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          {kind !== "global_summary" &&
            (["essentiel", "important", "standard"] as Priority[]).map((p) => (
              <Chip key={p} active={priorities.has(p)} onClick={() => togglePriority(p)}>
                {PRIORITY_META[p].label}
              </Chip>
            ))}
          {kind === "keywords_table" &&
            (keywords?.categories ?? []).map((cat) => (
              <Chip key={cat} active={category === cat} onClick={() => setCategory((c) => (c === cat ? null : cat))}>
                {cat}
              </Chip>
            ))}
          {courseOptions.length > 1 &&
            courseOptions.map((c) => (
              <Chip key={c} active={course === c} onClick={() => setCourse((v) => (v === c ? null : c))}>
                {c.length > 28 ? `${c.slice(0, 27)}…` : c}
              </Chip>
            ))}
          <span className="ml-auto shrink-0 pl-2 text-[11px] font-bold tabular-nums text-slate-500">
            {resultCount} {unit}
            {resultCount > 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {medical && (
        <p className="-mt-1 flex flex-wrap items-center gap-3 px-1 text-[11px] text-slate-500 dark:text-slate-400" data-print-hide>
          <span>
            <span className="syn-mark-patho">pathologie</span> · <span className="syn-mark-anat">anatomie / biologie</span>
          </span>
          {kind !== "global_summary" && <span>Priorité = fréquence du terme dans tes cours sélectionnés.</span>}
        </p>
      )}

      <div ref={rootRef} className="flex flex-col gap-4">
        {kind === "global_summary" &&
          (visibleSections.length > 0 ? (
            visibleSections.map((section, i) => (
              <SectionCard
                key={section.id}
                section={section}
                index={i}
                open={isOpen(section.id)}
                onToggle={() => toggle(section.id)}
                decorate={decorate}
                onCopy={() => void copy(section.id, `## ${section.title}\n\n${section.body}`)}
                copied={copiedId === section.id}
              />
            ))
          ) : (
            <EmptyResult />
          ))}

        {kind === "medical_dictionary" && (
          <>
            {dictEntries.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {dictEntries.map((entry, i) => (
                  <DictionaryCard
                    key={entry.id}
                    entry={entry}
                    index={i}
                    open={isOpen(entry.id)}
                    onToggle={() => toggle(entry.id)}
                    decorate={decorate}
                    onCopy={() => void copy(entry.id, `${entry.term} — ${stripInlineMarkdown(entry.fr)}${entry.ar ? `\n${stripInlineMarkdown(entry.ar)}` : ""}`)}
                    copied={copiedId === entry.id}
                    speech={speech}
                  />
                ))}
              </div>
            ) : (
              <EmptyResult />
            )}
            {(dictionary?.extras ?? [])
              .filter((s) => matchesQuery(query, s.title, s.body))
              .map((section, i) => (
                <SectionCard
                  key={section.id}
                  section={section}
                  index={i}
                  open={isOpen(section.id)}
                  onToggle={() => toggle(section.id)}
                  decorate={decorate}
                  onCopy={() => void copy(section.id, section.body)}
                  copied={copiedId === section.id}
                />
              ))}
          </>
        )}

        {kind === "keywords_table" &&
          (kwItems.length > 0 ? (
            (keywords?.courses ?? [])
              .filter((c) => kwItems.some((i) => i.course === c))
              .map((courseName, ci) => {
                const forCourse = kwItems.filter((i) => i.course === courseName);
                const cats = (keywords?.categories ?? []).filter((cat) => forCourse.some((i) => i.category === cat));
                return (
                  <article key={courseName} className="syn-card p-4 sm:p-5" style={accentStyle(ci)} data-open="false">
                    <header className="mb-3 flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xs font-black text-white">{ci + 1}</span>
                      <h3 className="min-w-0 flex-1 truncate text-[15px] font-black text-slate-900 dark:text-white">{courseName}</h3>
                      <span className="text-[11px] font-bold text-slate-500">{forCourse.length} mots-clés</span>
                    </header>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {cats.map((cat) => (
                        <section key={cat} className="rounded-2xl bg-black/[0.025] p-3 dark:bg-white/[0.025]">
                          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">{cat}</p>
                          <ul className="space-y-1.5">
                            {forCourse
                              .filter((i) => i.category === cat)
                              .map((item) => (
                                <KeywordChip key={item.id} item={item} decorate={decorate} open={isOpen(item.id)} onToggle={() => toggle(item.id)} />
                              ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  </article>
                );
              })
          ) : (
            <EmptyResult />
          ))}
      </div>
    </div>
  );
}

function EmptyResult() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-black/10 py-12 text-center dark:border-white/10">
      <Search className="h-6 w-6 text-slate-400" />
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Aucun résultat pour ces filtres.</p>
      <p className="text-xs text-slate-500">Modifie la recherche ou retire un filtre.</p>
    </div>
  );
}
