"use client";

import { memo, useMemo, useRef, useState } from "react";
import type { Components } from "react-markdown";
import { AlertTriangle, BadgeCheck, ExternalLink, Lightbulb, Pill, ScanSearch, Siren, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeCallouts } from "@/lib/markdown";
import { citationIndexFromHref, extractCitations, locateCitation, type ChatCitation, type CitationSourceText } from "@/lib/chat-citations";
import { StreamedMarkdown, type RehypePlugin } from "@/components/assistant/StreamedMarkdown";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";

/**
 * One assistant reply in the module workspace's Co-pilot: the MedArt
 * Copilot's own renderer (components/assistant/StreamedMarkdown.tsx — same
 * type, LaTeX clean-up, reading direction and word-by-word streaming), plus
 * what only the workspace asks the model for: verifiable citation chips and
 * the four medical callouts (WORKSPACE_STRUCTURED_FORMAT_INSTRUCTION).
 */

type Tone = "sky" | "rose" | "amber" | "emerald" | "violet";

/** Detected from the blockquote's leading emoji. */
const MEDICAL_CALLOUTS: readonly { id: string; emoji: string; label: string; labelPattern: RegExp; Icon: LucideIcon; tone: Tone }[] = [
  { id: "red-flag", emoji: "🚨", label: "Red flag", labelPattern: /^(red\s*flag|urgence|signe de gravit[ée])/i, Icon: Siren, tone: "rose" },
  { id: "pharmacology", emoji: "💊", label: "Pharmacologie", labelPattern: /^(pharmacolog|posologie|traitement)/i, Icon: Pill, tone: "violet" },
  { id: "differential", emoji: "🔍", label: "Diagnostic différentiel", labelPattern: /^diagnostic/i, Icon: ScanSearch, tone: "sky" },
  { id: "exam-trap", emoji: "💡", label: "Piège d'examen", labelPattern: /^(pi[èe]ge|perle|astuce)/i, Icon: Lightbulb, tone: "amber" },
];

/** The coloured-dot callouts (lib/markdown.tsx's normalizeCallouts turns ">>" into 🟢 and ">>>" into 🔴). */
const TONE_EMOJIS = ["🔴", "🟡", "🟢", "🔵"] as const;

/**
 * A plain blockquote's tone — the same reading the workspace chat always
 * had (lib/markdown.tsx's calloutTone), on the Copilot's quiet callout:
 * null keeps its sky default.
 */
function calloutTone(text: string): Exclude<Tone, "violet" | "sky"> | null {
  if (text.includes("🔴")) return "rose";
  if (text.includes("🟡")) return "amber";
  if (text.includes("🟢")) return "emerald";
  if (text.includes("🔵")) return null;
  if (/[؀-ۿ]/.test(text)) return "emerald";
  if (/astuce du prof/i.test(text)) return "amber";
  if (/(attention|danger|red\s*flag|jamais|interdit|urgence vitale|mortel|risque vital)/i.test(text)) return "rose";
  return null;
}

/** The Copilot's quiet callout (StreamedMarkdown's blockquote): a 2 px rule on the reading side and a faint wash, in the callout's tone. */
const CALLOUT_BASE =
  "my-[0.7em] animate-in fade-in rounded-e-xl border-s-2 py-[0.4em] pe-[0.9em] ps-[1em] font-normal not-italic text-slate-700 duration-300 dark:text-zinc-300 [&>p:first-of-type]:before:content-none [&>p:last-of-type]:after:content-none [&>p]:my-[0.25em]";

const TONE_CLASSES: Record<Tone, string> = {
  sky: "border-s-sky-400/80 bg-sky-500/[0.05] dark:border-s-sky-400/60 dark:bg-sky-400/[0.06]",
  rose: "border-s-rose-400/80 bg-rose-500/[0.05] dark:border-s-rose-400/60 dark:bg-rose-400/[0.07]",
  amber: "border-s-amber-400/80 bg-amber-500/[0.06] dark:border-s-amber-400/60 dark:bg-amber-400/[0.07]",
  emerald: "border-s-emerald-400/80 bg-emerald-500/[0.05] dark:border-s-emerald-400/60 dark:bg-emerald-400/[0.06]",
  violet: "border-s-violet-400/80 bg-violet-500/[0.05] dark:border-s-violet-400/60 dark:bg-violet-400/[0.07]",
};

const TONE_LABEL_CLASSES: Record<Tone, string> = {
  sky: "text-sky-700 dark:text-sky-300",
  rose: "text-rose-700 dark:text-rose-300",
  amber: "text-amber-700 dark:text-amber-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
  violet: "text-violet-700 dark:text-violet-300",
};

// --- Callout detection (a rehype pass, before words are wrapped for the fade) ---

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function hastText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

function isBlankText(node: HastNode | undefined): boolean {
  return Boolean(node && node.type === "text" && !(node.value ?? "").trim());
}

function dropLeadingBlanks(nodes: HastNode[]) {
  while (isBlankText(nodes[0])) nodes.shift();
}

/**
 * Removes a callout's leading "🚨 **Red flag** —": the callout's header
 * already shows its icon and canonical label, so leaving them inline would
 * read twice. Works on the syntax tree (text nodes and the bold label), so it
 * holds while the reply is still streaming.
 */
function stripCalloutPrefix(blockquote: HastNode, emoji: string, labelPattern: RegExp | null) {
  const first = (blockquote.children ?? []).find((child) => child.type === "element");
  const container = first && first.tagName === "p" ? first : blockquote;
  const nodes = container.children;
  if (!nodes) return;

  dropLeadingBlanks(nodes);
  const head = nodes[0];
  if (head?.type === "text" && head.value?.trimStart().startsWith(emoji)) {
    head.value = head.value.trimStart().slice(emoji.length).replace(/^️/, "").replace(/^\s+/, "");
    if (!head.value) nodes.shift();
  }
  if (!labelPattern) return;

  dropLeadingBlanks(nodes);
  const label = nodes[0];
  if (label?.type === "element" && labelPattern.test(hastText(label).trim())) {
    // "**Red flag** — …": the bold label goes, and the dash after it.
    nodes.shift();
    const after = nodes[0];
    if (after?.type === "text") {
      after.value = (after.value ?? "").replace(/^\s*[—–:-]\s*/, "");
      if (!after.value) nodes.shift();
    }
  } else if (label?.type === "text") {
    // "Red flag — …" without bold: only an exact label followed by its dash.
    const exact = new RegExp(`${labelPattern.source}\\p{L}*\\s*[—–:-]\\s*`, "iu");
    label.value = (label.value ?? "").replace(exact, "");
    if (!label.value) nodes.shift();
  }
}

function markCallouts(node: HastNode) {
  for (const child of node.children ?? []) {
    if (child.type === "element" && child.tagName === "blockquote") {
      const text = hastText(child).trimStart();
      const medical = MEDICAL_CALLOUTS.find((callout) => text.startsWith(callout.emoji));
      if (medical) {
        child.properties = { ...(child.properties ?? {}), dataCallout: medical.id };
        stripCalloutPrefix(child, medical.emoji, medical.labelPattern);
      } else {
        const tone = calloutTone(text);
        if (tone) child.properties = { ...(child.properties ?? {}), dataTone: tone };
        const dot = TONE_EMOJIS.find((emoji) => text.startsWith(emoji));
        if (dot) stripCalloutPrefix(child, dot, null);
      }
    }
    markCallouts(child);
  }
}

const rehypeCallouts: RehypePlugin = () => (tree: unknown) => {
  markCallouts(tree as HastNode);
};

const CALLOUT_PLUGINS: RehypePlugin[] = [rehypeCallouts];

// --- Citation chips ---------------------------------------------------------------

function CitationChip({
  citation,
  sources,
  onOpenSource,
  verify,
}: {
  citation: ChatCitation;
  sources: CitationSourceText[];
  onOpenSource?: (sourceId: number) => void;
  /** False while the reply is still streaming — the chip shows as pending and nothing is searched until the text is final. */
  verify: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [lastPointer, setLastPointer] = useState<string>("mouse");
  // Recomputed only when the chip or the loaded sources change — the
  // normalization pass over a long course is the expensive part.
  const { sourceTitle, quote } = citation;
  const location = useMemo(
    () => (verify ? locateCitation({ index: 0, sourceTitle, quote }, sources) : null),
    [verify, sourceTitle, quote, sources]
  );
  const status = !verify ? "pending" : !location ? "missing" : location.partial ? "partial" : "verified";

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
            "mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-0.5 items-center justify-center rounded-md px-1 align-baseline text-[10.5px] font-semibold leading-none no-underline transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40",
            status === "pending" && "bg-black/[0.06] text-slate-500 dark:bg-white/[0.1] dark:text-white/60",
            status === "verified" && "bg-sky-600 text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400",
            status === "partial" && "bg-sky-500/10 text-sky-700 ring-1 ring-sky-500/30 dark:bg-sky-400/15 dark:text-sky-200 dark:ring-sky-400/30",
            status === "missing" && "bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/30 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-400/30"
          )}
        >
          {citation.index}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        collisionPadding={12}
        className="w-[min(22rem,calc(100vw-2rem))] whitespace-normal rounded-2xl border-black/[0.06] bg-white/95 p-0 text-left text-slate-800 shadow-[0_24px_60px_-18px_rgba(15,23,42,0.35)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#14171b]/95 dark:text-white/90 dark:shadow-[0_28px_70px_-18px_rgba(0,0,0,0.85)]"
      >
        <div className="flex items-start gap-2 border-b border-black/[0.06] px-3.5 py-2.5 dark:border-white/[0.08]">
          {status === "missing" ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          ) : (
            <BadgeCheck className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", status === "verified" ? "text-sky-500" : "text-sky-400")} />
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{location?.sourceTitle ?? citation.sourceTitle}</p>
            <p className="text-[10.5px] text-slate-500 dark:text-white/50">
              {status === "verified" && (location?.origin === "explication" ? "Retrouvée dans l'Explication MedArt" : "Retrouvée mot pour mot dans ton cours")}
              {status === "partial" && "Correspondance partielle dans ton cours"}
              {status === "missing" && "Citation introuvable dans tes sources chargées — vérifie-la"}
              {status === "pending" && "Vérification dès la fin de la réponse…"}
            </p>
          </div>
        </div>
        <p className="max-h-48 overflow-y-auto px-3.5 py-2.5 text-xs leading-relaxed text-slate-600 dark:text-white/70">
          {location ? (
            <>
              {location.before}
              <mark className="rounded bg-sky-200/70 px-0.5 text-slate-900 dark:bg-sky-400/25 dark:text-white">{location.match}</mark>
              {location.after}
            </>
          ) : (
            <>« {citation.quote} »</>
          )}
        </p>
        {location && onOpenSource && (
          <p className="flex items-center gap-1 border-t border-black/[0.06] px-3.5 py-2 text-[10.5px] font-medium text-sky-600 dark:border-white/[0.08] dark:text-sky-300">
            <ExternalLink className="h-3 w-3" />
            Clique sur la pastille pour ouvrir le cours
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// --- The reply ---------------------------------------------------------------------

interface ChatRichMarkdownProps {
  content: string;
  /** The reply is still streaming: citation chips are shown but not verified yet. */
  isStreaming?: boolean;
  /** Course texts the citations are checked against — the sources currently loaded client-side. */
  citationSources: CitationSourceText[];
  onOpenSource?: (sourceId: number) => void;
}

export const ChatRichMarkdown = memo(function ChatRichMarkdown({ content, citationSources, onOpenSource, isStreaming = false }: ChatRichMarkdownProps) {
  // Citations come out first, from the reply exactly as written (their quotes
  // are matched against the course text), before the renderer tidies the rest.
  const { markdown, citations } = useMemo(() => extractCitations(normalizeCallouts(content)), [content]);
  // Read through a ref so the renderer map below keeps the same identity while
  // the reply streams — new identities on every chunk would re-render every block.
  const citationsRef = useRef(citations);
  citationsRef.current = citations;

  const components = useMemo<Components>(
    () => ({
      blockquote: ({ node, children, dir }) => {
        const properties = (node as HastNode | undefined)?.properties ?? {};
        const medical = MEDICAL_CALLOUTS.find((callout) => callout.id === properties.dataCallout);
        const tone: Tone = medical?.tone ?? (typeof properties.dataTone === "string" ? (properties.dataTone as Tone) : "sky");
        if (!medical) {
          return (
            <blockquote dir={dir ?? "auto"} className={cn(CALLOUT_BASE, TONE_CLASSES[tone])}>
              {children}
            </blockquote>
          );
        }
        const { Icon } = medical;
        return (
          <blockquote dir={dir ?? "auto"} role="note" aria-label={medical.label} className={cn(CALLOUT_BASE, TONE_CLASSES[tone])}>
            <div className={cn("not-prose mb-[0.15em] mt-[0.2em] flex items-center gap-1.5 text-[0.72em] font-semibold uppercase tracking-[0.08em]", TONE_LABEL_CLASSES[tone])}>
              <Icon className="h-[1.3em] w-[1.3em] shrink-0" strokeWidth={2} />
              {medical.label}
            </div>
            {children}
          </blockquote>
        );
      },
      a: ({ href, children }) => {
        const index = citationIndexFromHref(href);
        const citation = index !== null ? citationsRef.current.find((c) => c.index === index) : undefined;
        if (citation) return <CitationChip citation={citation} sources={citationSources} onOpenSource={onOpenSource} verify={!isStreaming} />;
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className="break-words">
            {children}
          </a>
        );
      },
    }),
    [citationSources, onOpenSource, isStreaming]
  );

  return <StreamedMarkdown content={markdown} isStreaming={isStreaming} components={components} rehypePlugins={CALLOUT_PLUGINS} />;
});
