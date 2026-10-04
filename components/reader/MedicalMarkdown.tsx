"use client";

import { Children, cloneElement, isValidElement, memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Activity, Info, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Long-form medical renderer shared by the Studio Reader (Explication
 * Ultra-Détaillée) and the Audio Smart Notes résumé. Sizes are in `em`, so
 * the reader's A-/A+ control (font-size on the wrapper) scales everything —
 * headings, boxes, tables — proportionally. Line height comes from the
 * `--reader-leading` variable set by the reader (falls back to 1.85).
 *
 * Callouts: the generators emit blockquotes (`> **L'Astuce du Prof** : …`,
 * `> 🟢 …`, `>>> …` → 🔴 via normalizeCallouts). Each one is routed to a
 * dedicated medical box by its content: Perle clinique, Piège d'examen,
 * Physiopathologie, or a neutral note.
 */

type CalloutKind = "pearl" | "exam" | "patho" | "note";

function nodeText(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] } | null;
  if (!n) return "";
  if (n.type === "text") return n.value ?? "";
  if (Array.isArray(n.children)) return n.children.map(nodeText).join("");
  return "";
}

function calloutKind(text: string): CalloutKind {
  if (/🔴|🟡|⚠️|pi[eè]ge|attention|erreur fr[ée]quente|red\s*flag|ne (jamais|pas confondre)|tomb[ée] [àa] l'examen|examen|qcm|danger|urgence/i.test(text)) return "exam";
  if (/🟢|💡|astuce|perle|à retenir|a retenir|retenez|point cl[ée]|mn[ée]motechnique|la réponse/i.test(text)) return "pearl";
  if (/🔵|physiopath|m[ée]canisme|anatomie|physiologie|cascade|voie (de|du)|r[ée]cepteur/i.test(text)) return "patho";
  return "note";
}

function calloutLabel(kind: CalloutKind, text: string): string {
  if (kind === "pearl") return /astuce du prof/i.test(text) ? "Astuce du Prof" : "Perle clinique";
  if (kind === "exam") return /pi[eè]ge/i.test(text) ? "Piège d'examen" : "High-yield · Examen";
  if (kind === "patho") return "Physiopathologie";
  return "À noter";
}

const MARKER_RE = /^\s*(?:🔴|🟢|🟡|🔵|💡|⚠️)?\s*(?:(?:perle clinique|pi[eè]ge d'examen|physiopathologie)\s*:\s*)?/iu;

/** Removes the leading color-marker emoji (and a repeated "Perle clinique :" style label) from the first text node — the box's own chip now carries that meaning. */
function stripLeadingMarker(children: ReactNode): ReactNode {
  let done = false;
  function walk(node: ReactNode): ReactNode {
    if (done) return node;
    if (typeof node === "string") {
      if (!node.trim()) return node;
      done = true;
      return node.replace(MARKER_RE, "");
    }
    if (Array.isArray(node)) return node.map(walk);
    if (isValidElement<{ children?: ReactNode }>(node) && node.props.children !== undefined) {
      return cloneElement(node, undefined, walk(node.props.children));
    }
    if (isValidElement(node)) done = true;
    return node;
  }
  return Children.map(children, walk);
}

const BOX_STYLES: Record<CalloutKind, { wrap: string; chip: string; Icon: typeof Info }> = {
  pearl: {
    wrap: "border-emerald-400/50 bg-gradient-to-br from-emerald-50 to-cyan-50 shadow-[0_0_0_1px_rgba(16,185,129,0.08),0_10px_30px_-12px_rgba(16,185,129,0.45)] dark:border-emerald-400/30 dark:from-emerald-500/[0.10] dark:to-cyan-500/[0.06] dark:shadow-[0_0_28px_-10px_rgba(45,212,191,0.55)]",
    chip: "bg-emerald-500 text-white dark:bg-emerald-400 dark:text-emerald-950",
    Icon: Lightbulb,
  },
  exam: {
    wrap: "border-rose-400/50 bg-gradient-to-br from-rose-50 to-amber-50 shadow-[0_10px_30px_-14px_rgba(244,63,94,0.45)] dark:border-rose-400/30 dark:from-rose-500/[0.10] dark:to-amber-500/[0.06] dark:shadow-[0_0_28px_-12px_rgba(251,113,133,0.5)]",
    chip: "bg-rose-500 text-white dark:bg-rose-400 dark:text-rose-950",
    Icon: AlertTriangle,
  },
  patho: {
    wrap: "border-indigo-300/60 bg-indigo-50/70 dark:border-indigo-400/25 dark:bg-indigo-500/[0.07]",
    chip: "bg-indigo-500 text-white dark:bg-indigo-400 dark:text-indigo-950",
    Icon: Activity,
  },
  note: {
    wrap: "border-sky-300/60 bg-sky-50/70 dark:border-sky-400/25 dark:bg-sky-500/[0.07]",
    chip: "bg-sky-500 text-white dark:bg-sky-400 dark:text-sky-950",
    Icon: Info,
  },
};

/** Named exports so other surfaces can place the same boxes explicitly. */
export function MedicalCallout({ kind, label, children }: { kind: CalloutKind; label?: string; children: ReactNode }) {
  const style = BOX_STYLES[kind];
  const Icon = style.Icon;
  return (
    <aside className={cn("not-prose relative my-[1.4em] overflow-hidden rounded-2xl border px-[1.15em] pb-[0.9em] pt-[0.85em]", style.wrap)}>
      <div className="mb-[0.45em] flex items-center gap-2">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.68em] font-black uppercase tracking-[0.12em]", style.chip)}>
          <Icon className="h-[1.1em] w-[1.1em]" />
          {label ?? calloutLabel(kind, "")}
        </span>
      </div>
      <div className="text-[0.97em] text-slate-800 dark:text-slate-100 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-[0.5em]">{children}</div>
    </aside>
  );
}

export const ClinicalPearlBox = ({ children, label }: { children: ReactNode; label?: string }) => <MedicalCallout kind="pearl" label={label ?? "Perle clinique"}>{children}</MedicalCallout>;
export const HighYieldExamBox = ({ children, label }: { children: ReactNode; label?: string }) => <MedicalCallout kind="exam" label={label ?? "Piège d'examen"}>{children}</MedicalCallout>;
export const PathophysiologyCard = ({ children, label }: { children: ReactNode; label?: string }) => <MedicalCallout kind="patho" label={label ?? "Physiopathologie"}>{children}</MedicalCallout>;

const CHAPTER_RE = /^((?:chapitre|partie|section)\s+[IVXLCDM\d]+)\s*[:.–—-]\s*(.+)$/i;

const COMPONENTS: Components = {
  h1: ({ children }) => (
    <header className="mb-[1.6em] mt-[0.4em]">
      <h1 className="[font-family:var(--reader-heading,inherit)] text-[1.85em] font-extrabold leading-[1.15] tracking-tight text-slate-900 dark:text-white">{children}</h1>
      <div aria-hidden className="mt-[0.7em] h-[3px] w-24 rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-violet-500" />
    </header>
  ),
  h2: ({ node, children }) => {
    const text = nodeText(node);
    const match = text.match(CHAPTER_RE);
    return (
      <h2 data-toc={text} className="group/h2 relative mb-[0.8em] mt-[2.4em] scroll-mt-28 border-t border-slate-200 pt-[1.3em] [font-family:var(--reader-heading,inherit)] text-[1.38em] font-bold leading-[1.25] tracking-tight text-slate-900 dark:border-white/10 dark:text-white">
        {match ? (
          <>
            <span className="mb-[0.35em] block text-[0.52em] font-black uppercase tracking-[0.22em] text-emerald-600 dark:text-emerald-400">{match[1]}</span>
            <span className="bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent dark:from-white dark:to-slate-300">{match[2]}</span>
          </>
        ) : (
          children
        )}
        <span aria-hidden className="absolute -left-[0.9em] top-[1.45em] hidden h-[1.1em] w-1 rounded-full bg-gradient-to-b from-emerald-400 to-cyan-400 md:block" />
      </h2>
    );
  },
  h3: ({ children }) => <h3 className="mb-[0.5em] mt-[1.7em] scroll-mt-28 [font-family:var(--reader-heading,inherit)] text-[1.16em] font-bold leading-snug text-indigo-700 dark:text-cyan-300">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-[0.4em] mt-[1.3em] text-[1.02em] font-bold text-slate-900 dark:text-slate-100">{children}</h4>,
  p: ({ children }) => <p className="my-[0.95em]">{children}</p>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-cyan-700 underline decoration-cyan-500/40 underline-offset-[3px] hover:decoration-cyan-500 dark:text-cyan-300">
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="rounded-[0.3em] bg-emerald-500/[0.10] px-[0.22em] font-semibold text-slate-900 [box-decoration-break:clone] dark:bg-emerald-400/[0.12] dark:text-emerald-100">{children}</strong>
  ),
  em: ({ children }) => <em className="text-slate-700 dark:text-slate-300">{children}</em>,
  ul: ({ children }) => (
    <ul className="my-[0.9em] list-none space-y-[0.4em] pl-0 [&>li]:relative [&>li]:pl-[1.3em] [&>li]:before:absolute [&>li]:before:left-[0.2em] [&>li]:before:top-[0.72em] [&>li]:before:h-[0.42em] [&>li]:before:w-[0.42em] [&>li]:before:rounded-full [&>li]:before:bg-gradient-to-br [&>li]:before:from-emerald-400 [&>li]:before:to-cyan-500 [&>li]:before:shadow-[0_0_8px_rgba(45,212,191,0.6)] [&>li]:before:content-['']">
      {children}
    </ul>
  ),
  ol: ({ children }) => <ol className="my-[0.9em] list-decimal space-y-[0.4em] pl-[1.4em] marker:font-bold marker:text-emerald-600 dark:marker:text-emerald-400 [&>li]:pl-[0.3em]">{children}</ol>,
  hr: () => <hr className="my-[2em] h-px border-0 bg-gradient-to-r from-transparent via-slate-300 to-transparent dark:via-white/15" />,
  code: ({ children }) => <code className="rounded-md border border-slate-200 bg-slate-100 px-[0.35em] py-[0.05em] font-mono text-[0.88em] text-slate-800 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100">{children}</code>,
  blockquote: ({ node, children }) => {
    const text = nodeText(node);
    const kind = calloutKind(text);
    return (
      <MedicalCallout kind={kind} label={calloutLabel(kind, text)}>
        {stripLeadingMarker(children)}
      </MedicalCallout>
    );
  },
  table: ({ children }) => (
    <div className="my-[1.5em] overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_-18px_rgba(15,23,42,0.35)] [scrollbar-width:thin] dark:border-white/10 dark:bg-white/[0.02]">
      <table className="w-full min-w-[32rem] border-collapse text-[0.9em] leading-[1.55]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gradient-to-r from-slate-900 to-slate-800 text-white dark:from-cyan-900/60 dark:to-indigo-900/50">{children}</thead>,
  th: ({ children }) => <th className="whitespace-nowrap px-[0.9em] py-[0.7em] text-left text-[0.82em] font-bold uppercase tracking-wide">{children}</th>,
  tr: ({ children }) => <tr className="border-t border-slate-200 transition-colors even:bg-slate-50/70 hover:bg-emerald-50/80 dark:border-white/[0.07] dark:even:bg-white/[0.025] dark:hover:bg-emerald-400/[0.07]">{children}</tr>,
  td: ({ children }) => <td className="px-[0.9em] py-[0.65em] align-top">{children}</td>,
};

type Decorate = (text: string) => ReactNode;

/** Applies `decorate` to every plain-text run inside rendered children (search/term highlighting), leaving elements intact. */
function decorateChildren(children: ReactNode, decorate: Decorate): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") return decorate(child);
    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children !== undefined) {
      return cloneElement(child, undefined, decorateChildren(child.props.children, decorate));
    }
    return child;
  });
}

function withDecoration(decorate: Decorate): Components {
  const P = COMPONENTS.p as (props: { children?: ReactNode }) => ReactNode;
  const Td = COMPONENTS.td as (props: { children?: ReactNode }) => ReactNode;
  return {
    ...COMPONENTS,
    p: ({ children }) => P({ children: decorateChildren(children, decorate) }),
    td: ({ children }) => Td({ children: decorateChildren(children, decorate) }),
    li: ({ children }) => <li>{decorateChildren(children, decorate)}</li>,
  };
}

/**
 * `markdown` should already be callout-normalized by the caller
 * (lib/markdown.ts's normalizeCallouts) when it comes from the Studio.
 * `decorate` (optional) transforms every text run of paragraphs, list items
 * and table cells — used by the synthesis explorer for search and medical
 * term highlighting. Without it, rendering is exactly the default.
 */
export const MedicalMarkdown = memo(function MedicalMarkdown({ markdown, className, decorate }: { markdown: string; className?: string; decorate?: Decorate }) {
  const components = useMemo(() => (decorate ? withDecoration(decorate) : COMPONENTS), [decorate]);
  return (
    <div dir="auto" className={cn("medical-markdown break-words text-slate-800 [&>*:first-child]:mt-0 [&>h2:first-child]:border-t-0 [&>h2:first-child]:pt-0 [line-height:var(--reader-leading,1.85)] dark:text-slate-200", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
});
