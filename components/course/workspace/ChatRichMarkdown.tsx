"use client";

import { Children, cloneElement, isValidElement, memo, useMemo, useState, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, BadgeCheck, ExternalLink, Lightbulb, Pill, ScanSearch, Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHAT_MARKDOWN_COMPONENTS, CHAT_PROSE_CLASSES, DARK_CHAT_MARKDOWN_COMPONENTS, DARK_CHAT_PROSE_CLASSES, normalizeCallouts } from "@/lib/markdown";
import { citationIndexFromHref, extractCitations, locateCitation, type ChatCitation, type CitationSourceText } from "@/lib/chat-citations";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";

/**
 * The four structured callouts the workspace chat asks the model for (see
 * WORKSPACE_STRUCTURED_FORMAT_INSTRUCTION). Detected from the blockquote's
 * leading emoji; any other blockquote falls back to the shared chat
 * renderer's existing colored-callout behavior, untouched.
 */
const MEDICAL_CALLOUTS = [
  {
    emoji: "🚨",
    label: "Red flag",
    labelPattern: /^(red\s*flag|urgence|signe de gravit[ée])/i,
    Icon: Siren,
    light: "border-rose-300/80 bg-rose-50 text-rose-950",
    labelClass: "text-rose-700 dark:text-rose-300",
    dark: "border-rose-500/40 bg-rose-500/10 text-rose-50",
    chip: "bg-rose-600 text-white dark:bg-rose-500",
  },
  {
    emoji: "💊",
    label: "Pharmacologie",
    labelPattern: /^(pharmacolog|posologie|traitement)/i,
    Icon: Pill,
    light: "border-violet-300/80 bg-violet-50 text-violet-950",
    labelClass: "text-violet-700 dark:text-violet-300",
    dark: "border-violet-500/40 bg-violet-500/10 text-violet-50",
    chip: "bg-violet-600 text-white dark:bg-violet-500",
  },
  {
    emoji: "🔍",
    label: "Diagnostic différentiel",
    labelPattern: /^diagnostic/i,
    Icon: ScanSearch,
    light: "border-sky-300/80 bg-sky-50 text-sky-950",
    labelClass: "text-sky-700 dark:text-sky-300",
    dark: "border-sky-500/40 bg-sky-500/10 text-sky-50",
    chip: "bg-sky-600 text-white dark:bg-sky-500",
  },
  {
    emoji: "💡",
    label: "Piège d'examen",
    labelPattern: /^(pi[èe]ge|perle|astuce)/i,
    Icon: Lightbulb,
    light: "border-amber-300/80 bg-amber-50 text-amber-950",
    labelClass: "text-amber-700 dark:text-amber-300",
    dark: "border-amber-500/40 bg-amber-500/10 text-amber-50",
    chip: "bg-amber-500 text-white dark:bg-amber-500",
  },
] as const;

type MedicalCalloutConfig = (typeof MEDICAL_CALLOUTS)[number];

function hastText(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] } | null;
  if (!n) return "";
  if (n.type === "text") return n.value ?? "";
  if (Array.isArray(n.children)) return n.children.map(hastText).join("");
  return "";
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/**
 * Removes the leading "🚨 **Red flag** —" prefix from the callout's first
 * paragraph — the callout header already shows the canonical label and
 * icon, so leaving it inline would read twice.
 */
function stripCalloutPrefix(children: ReactNode, config: MedicalCalloutConfig): ReactNode {
  let stripped = false;
  return Children.map(children, (child) => {
    if (stripped || !isValidElement<{ children?: ReactNode }>(child)) return child;
    stripped = true;
    const parts: ReactNode[] = Children.toArray(child.props.children);
    const first = parts[0];
    if (typeof first === "string") {
      const rest = first.replace(config.emoji, "").replace(/^\uFE0F/, "").replace(/^\s+/, "");
      if (rest === "") parts.shift();
      else parts[0] = rest;
    }
    const label = parts[0];
    if (label && isValidElement(label) && config.labelPattern.test(textOf(label).trim())) {
      parts.shift();
      const afterLabel = parts[0];
      if (typeof afterLabel === "string") parts[0] = afterLabel.replace(/^\s*[—–:-]\s*/, "");
    }
    return cloneElement(child as ReactElement<{ children?: ReactNode }>, undefined, ...parts);
  });
}

function CitationChip({
  citation,
  sources,
  onOpenSource,
}: {
  citation: ChatCitation;
  sources: CitationSourceText[];
  onOpenSource?: (sourceId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lastPointer, setLastPointer] = useState<string>("mouse");
  // Recomputed only when the chip or the loaded sources change — the
  // normalization pass over a long course is the expensive part.
  const location = useMemo(() => locateCitation(citation, sources), [citation, sources]);
  const status = !location ? "missing" : location.partial ? "partial" : "verified";

  function handleClick() {
    // Touch has no hover: the first tap previews, a second tap opens.
    if (lastPointer === "touch" && !open) {
      setOpen(true);
      return;
    }
    if (location && onOpenSource) onOpenSource(location.sourceId);
    else setOpen((prev) => !prev);
  }

  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={120}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onPointerDown={(e) => setLastPointer(e.pointerType)}
          onClick={handleClick}
          aria-label={`Citation ${citation.index} — ${citation.sourceTitle}`}
          className={cn(
            "mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-0.5 items-center justify-center rounded-md px-1 align-baseline text-[10px] font-bold leading-none no-underline transition-all duration-200 hover:-translate-y-1 hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
            status === "verified" && "bg-primary-600 text-white dark:bg-primary-500",
            status === "partial" && "bg-primary-100 text-primary-800 ring-1 ring-primary-300 dark:bg-primary-900/50 dark:text-primary-200 dark:ring-primary-700",
            status === "missing" && "bg-amber-100 text-amber-800 ring-1 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700"
          )}
        >
          {citation.index}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        collisionPadding={12}
        className="w-[min(22rem,calc(100vw-2rem))] whitespace-normal border-border bg-popover p-0 text-left text-popover-foreground shadow-glass dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex items-start gap-2 border-b border-[color-mix(in_oklab,var(--border)_70%,transparent)] px-3 py-2 dark:border-white/10">
          {status === "missing" ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          ) : (
            <BadgeCheck className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", status === "verified" ? "text-primary-500" : "text-primary-400")} />
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{location?.sourceTitle ?? citation.sourceTitle}</p>
            <p className="text-[10px] text-muted-foreground">
              {status === "verified" && (location?.origin === "explication" ? "Retrouvée dans l'Explication MedArt" : "Retrouvée mot pour mot dans ton cours")}
              {status === "partial" && "Correspondance partielle dans ton cours"}
              {status === "missing" && "Citation introuvable dans tes sources chargées — vérifie-la"}
            </p>
          </div>
        </div>
        <p className="max-h-48 overflow-y-auto px-3 py-2 text-xs leading-relaxed text-muted-foreground dark:text-slate-300">
          {location ? (
            <>
              {location.before}
              <mark className="rounded bg-primary-200/70 px-0.5 text-foreground dark:bg-primary-500/30 dark:text-white">{location.match}</mark>
              {location.after}
            </>
          ) : (
            <>« {citation.quote} »</>
          )}
        </p>
        {location && onOpenSource && (
          <p className="flex items-center gap-1 border-t border-[color-mix(in_oklab,var(--border)_70%,transparent)] px-3 py-1.5 text-[10px] font-medium text-primary-600 dark:border-white/10 dark:text-primary-300">
            <ExternalLink className="h-3 w-3" />
            Clique sur la pastille pour ouvrir le cours
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

interface ChatRichMarkdownProps {
  content: string;
  dark: boolean;
  /** Course texts the citations are checked against — the sources currently loaded client-side. */
  citationSources: CitationSourceText[];
  onOpenSource?: (sourceId: number) => void;
}

/**
 * One assistant reply in the workspace chat: the shared chat markdown
 * renderer, plus medical callouts and verifiable citation chips.
 */
export const ChatRichMarkdown = memo(function ChatRichMarkdown({ content, dark, citationSources, onOpenSource }: ChatRichMarkdownProps) {
  const { markdown, citations } = useMemo(() => extractCitations(normalizeCallouts(content)), [content]);

  const components = useMemo<Components>(() => {
    const base = dark ? DARK_CHAT_MARKDOWN_COMPONENTS : CHAT_MARKDOWN_COMPONENTS;
    const BaseBlockquote = base.blockquote;
    return {
      ...base,
      blockquote: (props) => {
        const text = hastText(props.node).trimStart();
        const config = MEDICAL_CALLOUTS.find((c) => text.startsWith(c.emoji));
        if (!config) {
          return BaseBlockquote ? <BaseBlockquote {...props} /> : <blockquote>{props.children}</blockquote>;
        }
        const { Icon } = config;
        return (
          <aside
            role="note"
            aria-label={config.label}
            className={cn(
              "not-prose my-3 overflow-hidden rounded-xl border shadow-sm transition-shadow duration-300 hover:shadow-soft",
              dark ? config.dark : config.light
            )}
          >
            <div className="flex items-center gap-2 px-3 pt-2.5">
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-lg shadow-sm", config.chip)}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className={`text-[11px] font-bold uppercase tracking-[0.08em] ${config.labelClass}`}>{config.label}</span>
            </div>
            <div className="px-3 pb-2.5 pt-1.5 text-sm leading-relaxed [&_p]:my-1">{stripCalloutPrefix(props.children, config)}</div>
          </aside>
        );
      },
      a: ({ href, children, ...rest }) => {
        const index = citationIndexFromHref(href);
        const citation = index !== null ? citations.find((c) => c.index === index) : undefined;
        if (citation) return <CitationChip citation={citation} sources={citationSources} onOpenSource={onOpenSource} />;
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
            {children}
          </a>
        );
      },
    };
  }, [dark, citations, citationSources, onOpenSource]);

  return (
    <article className={cn(dark ? DARK_CHAT_PROSE_CLASSES : CHAT_PROSE_CLASSES, "max-w-none")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown || "…"}
      </ReactMarkdown>
    </article>
  );
});
