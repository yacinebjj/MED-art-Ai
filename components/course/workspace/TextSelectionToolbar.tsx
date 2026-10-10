"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Eraser,
  Globe,
  Highlighter,
  ImageDown,
  LayoutGrid,
  Languages,
  Loader2,
  Microscope,
  NotebookPen,
  Quote,
  ScanSearch,
  Search,
  Share2,
  Sparkles,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { computeOffsets, escapeHtml, getSelectionMarkAncestor, removeHighlight, wrapRangeInMark, HIGHLIGHT_COLORS } from "@/lib/highlight";
import { useToast } from "@/components/ui/Toast";
import { useLanguage } from "@/providers/LanguageProvider";
import { cn } from "@/lib/utils";
import type { TextSelectionState } from "@/hooks/useTextSelection";

/*
 * Selection "command card". Every action here is local and free — the AI is
 * only ever reached through the parent's own onAsk / onTranslate (unchanged).
 * Copy, read-aloud (SpeechSynthesis), find-in-course, share (Web Share API),
 * quote card (canvas PNG) and the web searches cost zero tokens.
 */

const MARGIN = 8;
const ARABIC = /[؀-ۿ]/;

const LABELS = {
  fr: {
    toolbar: "Actions sur la sélection",
    words: (n: number) => `${n} mot${n > 1 ? "s" : ""}`,
    translate: "Traduire",
    note: "Note",
    highlight: "Surligner",
    unhighlight: "Retirer",
    search: "Rechercher",
    tools: "Outils",
    close: "Fermer",
    copy: "Copier",
    copied: "Copié",
    quote: "Citation",
    listen: "Écouter",
    stop: "Stop",
    find: "Trouver",
    share: "Partager",
    card: "Image",
    cancel: "Annuler",
    save: "Enregistrer",
    notePlaceholder: "Écris ta note…",
    noteSaved: "Note enregistrée",
    noteFailed: "Échec de l'enregistrement",
    speechUnsupported: "La lecture vocale n'est pas disponible sur ce navigateur.",
    cardFailed: "Impossible de créer la carte image.",
    clipboardFailed: "Copie impossible sur ce navigateur.",
  },
  en: {
    toolbar: "Selection actions",
    words: (n: number) => `${n} word${n > 1 ? "s" : ""}`,
    translate: "Translate",
    note: "Note",
    highlight: "Highlight",
    unhighlight: "Remove",
    search: "Search",
    tools: "Tools",
    close: "Close",
    copy: "Copy",
    copied: "Copied",
    quote: "Quote",
    listen: "Listen",
    stop: "Stop",
    find: "Find",
    share: "Share",
    card: "Image",
    cancel: "Cancel",
    save: "Save",
    notePlaceholder: "Write your note…",
    noteSaved: "Note saved",
    noteFailed: "Couldn't save",
    speechUnsupported: "Read-aloud isn't available in this browser.",
    cardFailed: "Couldn't create the image card.",
    clipboardFailed: "Copy isn't available in this browser.",
  },
} as const;

const SEARCH_ENGINES = [
  { id: "google", label: "Google", icon: Globe, url: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { id: "wikipedia", label: "Wikipédia", icon: BookOpen, url: (q: string) => `https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}` },
  { id: "pubmed", label: "PubMed", icon: Microscope, url: (q: string) => `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(q)}` },
] as const;

type Tray = "none" | "highlight" | "search" | "tools";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Every occurrence of `needle` in `root`'s text, as live Ranges (a match may span several text nodes, e.g. across <strong>). */
function findOccurrences(root: Node, needle: string, limit = 50): Range[] {
  const query = needle.trim();
  if (query.length < 2 || query.length > 160) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let full = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: full.length });
    full += (n as Text).data;
  }
  if (nodes.length === 0) return [];
  // Case-insensitive only when lowercasing keeps every offset aligned.
  const lowered = full.toLowerCase();
  const caseInsensitive = lowered.length === full.length;
  const haystack = caseInsensitive ? lowered : full;
  const target = caseInsensitive ? query.toLowerCase() : query;
  // A start offset belongs to the node it falls in; an END offset landing
  // exactly on a node boundary belongs to the node the match ends IN (not the
  // next one at offset 0), so the range never leaks out of e.g. a <strong>.
  const locate = (offset: number, isEnd: boolean) => {
    let lo = 0;
    let hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (isEnd ? nodes[mid].start < offset : nodes[mid].start <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { node: nodes[lo].node, offset: offset - nodes[lo].start };
  };
  const ranges: Range[] = [];
  for (let from = 0; ranges.length < limit; ) {
    const index = haystack.indexOf(target, from);
    if (index < 0) break;
    const start = locate(index, false);
    const end = locate(index + target.length, true);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    ranges.push(range);
    from = index + target.length;
  }
  return ranges;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (ctx.measureText(word).width <= maxWidth) {
      line = word;
      continue;
    }
    // A single word wider than the card: break it.
    let chunk = "";
    for (const char of word) {
      if (ctx.measureText(chunk + char).width > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else chunk += char;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

function fitToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** A 1080×1350 dark "MedArt AI" quote card, drawn locally on a canvas. */
async function renderQuoteCard(text: string, source: string | undefined): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const M = 96;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#020617");
  bg.addColorStop(0.55, "#0b1b33");
  bg.addColorStop(1, "#020617");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.15, H * 0.08, 0, W * 0.15, H * 0.08, W * 0.85);
  glow.addColorStop(0, "rgba(34,211,238,0.26)");
  glow.addColorStop(1, "rgba(34,211,238,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const logo = await loadImage("/icons/icon-192.png").catch(() => null);
  if (logo) ctx.drawImage(logo, M, M - 10, 92, 92);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "800 46px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("MedArt AI", M + (logo ? 112 : 0), M + 36);

  ctx.fillStyle = "rgba(34,211,238,0.35)";
  ctx.font = "900 240px Georgia, serif";
  ctx.textBaseline = "top";
  ctx.fillText("“", M - 14, 210);

  const clean = text.replace(/\s+/g, " ").trim();
  const rtl = ARABIC.test(clean);
  const top = 420;
  const bottom = H - 250;
  const maxWidth = W - 2 * M;
  let size = 58;
  let lines: string[] = [];
  for (; size >= 30; size -= 4) {
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    lines = wrapLines(ctx, clean, maxWidth);
    if (lines.length * size * 1.38 <= bottom - top) break;
  }
  const lineHeight = size * 1.38;
  const maxLines = Math.max(1, Math.floor((bottom - top) / lineHeight));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = fitToWidth(ctx, `${lines[maxLines - 1]} …`, maxWidth);
  }
  ctx.fillStyle = "#f8fafc";
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = rtl ? "right" : "left";
  lines.forEach((line, i) => ctx.fillText(line, rtl ? W - M : M, top + i * lineHeight));

  ctx.direction = "ltr";
  ctx.textAlign = "left";
  const bar = ctx.createLinearGradient(M, 0, M + 140, 0);
  bar.addColorStop(0, "#22d3ee");
  bar.addColorStop(1, "#8b5cf6");
  ctx.fillStyle = bar;
  ctx.fillRect(M, H - 196, 140, 6);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 34px Inter, system-ui, sans-serif";
  ctx.fillText(fitToWidth(ctx, source || "Cours MedArt AI", maxWidth), M, H - 150);
  ctx.fillStyle = "#22d3ee";
  ctx.font = "700 30px Inter, system-ui, sans-serif";
  ctx.fillText(window.location.host, M, H - 100);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), "image/png"));
}

interface TextSelectionToolbarProps {
  selection: TextSelectionState;
  onAsk: (text: string) => void;
  onTranslate: (text: string) => void;
  onHighlightChange?: () => void;
  moduleId?: number;
  courseTitle?: string;
  courseSlug?: string;
  /** The reading container the selection lives in — offsets are captured relative to THIS element (see lib/highlight.ts's computeOffsets), never the whole page. */
  container?: HTMLDivElement | null;
}

function Tile({ icon, label, active, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "group flex min-h-[3.75rem] flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-2 text-[11px] font-semibold transition-all duration-200",
        active
          ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-100 shadow-[0_0_18px_-4px_rgba(34,211,238,0.6)]"
          : "border-white/[0.06] bg-white/[0.04] text-slate-300 hover:border-white/15 hover:bg-white/[0.08] hover:text-white active:scale-[0.97]"
      )}
    >
      <span className={cn("transition-transform duration-200 group-hover:-translate-y-0.5", active && "text-cyan-300")}>{icon}</span>
      <span className="leading-none">{label}</span>
    </button>
  );
}

function ToolButton({ icon, label, title, onClick, disabled, done, accent }: { icon: ReactNode; label: string; title?: string; onClick: () => void; disabled?: boolean; done?: boolean; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "flex min-h-[2.75rem] items-center gap-2 rounded-lg border px-2.5 text-left text-xs font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40",
        done
          ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-100"
          : accent
            ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-100"
            : "border-white/[0.06] bg-white/[0.03] text-slate-200 hover:border-white/15 hover:bg-white/[0.08] active:scale-[0.98]"
      )}
    >
      <span className="shrink-0">{done ? <Check className="h-4 w-4" /> : icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

export const TextSelectionToolbar = forwardRef<HTMLDivElement, TextSelectionToolbarProps>(
  function TextSelectionToolbar({ selection, onAsk, onTranslate, onHighlightChange, moduleId, courseTitle, courseSlug, container }, ref) {
    const { toast } = useToast();
    const { language } = useLanguage();
    const t = LABELS[language === "en" ? "en" : "fr"];
    const reduceMotion = useReducedMotion();

    const [isSavingNote, setIsSavingNote] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [noteDraft, setNoteDraft] = useState<string | null>(null);
    const [tray, setTray] = useState<Tray>("none");
    const [doneAction, setDoneAction] = useState<string | null>(null);
    const [speaking, setSpeaking] = useState(false);
    const [busyCard, setBusyCard] = useState(false);
    const [findIndex, setFindIndex] = useState(0);
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    // The top/left transition only applies once the card has been placed:
    // otherwise its very first placement would visibly slide in from the
    // unclamped selection coordinates.
    const [placed, setPlaced] = useState(false);

    const panelRef = useRef<HTMLDivElement | null>(null);
    const savedRangeRef = useRef<Range | null>(null);
    const startedSpeechRef = useRef(false);
    const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // The parent's ref (outside-click detection in useTextSelection) and our own (measuring).
    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        panelRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [ref]
    );

    // A new TEXT resets the card; the same text at a new spot (scroll, find
    // jump) keeps the open tray and the note draft.
    useEffect(() => {
      setDismissed(false);
      setTray("none");
      setNoteDraft(null);
      setFindIndex(0);
      const sel = window.getSelection();
      savedRangeRef.current = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
    }, [selection.text]);

    // Read once per selection: tapping the card can collapse the live
    // selection on touch screens, which would flip Unhighlight to Highlight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const markAncestor = useMemo(() => (typeof window === "undefined" ? null : getSelectionMarkAncestor()), [selection.text]);

    const wordCount = useMemo(() => selection.text.split(/\s+/).filter(Boolean).length, [selection.text]);

    const occurrences = useMemo(
      () => (tray === "tools" && container ? findOccurrences(container, selection.text) : []),
      [tray, container, selection.text]
    );

    // Start "Find" counting from the occurrence the student actually selected.
    useEffect(() => {
      const saved = savedRangeRef.current;
      if (occurrences.length === 0 || !saved) return;
      // Containment, not equality: the same spot can be expressed as
      // (element, 0) or (text node, 0) depending on how it was selected.
      const index = occurrences.findIndex((range) => {
        try {
          return range.compareBoundaryPoints(Range.START_TO_START, saved) >= 0 && range.compareBoundaryPoints(Range.END_TO_END, saved) <= 0;
        } catch {
          return false;
        }
      });
      setFindIndex(index >= 0 ? index : 0);
    }, [occurrences]);

    // Placement: above the selection with a mouse, below it on touch screens
    // (where the OS menu sits above), flipped when there's no room, always
    // inside the viewport. A layout effect, so it settles before paint.
    const noteOpen = noteDraft !== null;
    useLayoutEffect(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const above = selection.rectTop - (coarse ? 64 : 12) - height;
      const below = selection.rectBottom + (coarse ? 36 : 12);
      let top: number;
      if (coarse) top = below + height <= vh - MARGIN ? below : above >= MARGIN ? above : below;
      else top = above >= MARGIN ? above : below + height <= vh - MARGIN ? below : above;
      top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - MARGIN - height));
      const left = Math.min(Math.max(selection.left - width / 2, MARGIN), Math.max(MARGIN, vw - MARGIN - width));
      setPosition((prev) => (prev && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.left - left) < 0.5 ? prev : { top, left }));
    }, [selection.left, selection.rectTop, selection.rectBottom, tray, noteOpen, dismissed]);

    useEffect(() => {
      if (!position || placed) return;
      const frame = requestAnimationFrame(() => setPlaced(true));
      return () => cancelAnimationFrame(frame);
    }, [position, placed]);

    useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") setDismissed(true);
      }
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    useEffect(
      () => () => {
        if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
        // Only stop speech this card started — never anyone else's (e.g. voice mode).
        if (startedSpeechRef.current) window.speechSynthesis?.cancel();
      },
      []
    );

    if (typeof document === "undefined" || dismissed) return null;

    function flashDone(id: string) {
      setDoneAction(id);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
      doneTimerRef.current = setTimeout(() => setDoneAction(null), 1400);
    }

    async function handleCopy(kind: "plain" | "quote") {
      const text = kind === "plain" ? selection.text : `> ${selection.text.trim().replace(/\n+/g, "\n> ")}\n>\n> — ${courseTitle ?? "MedArt AI"}`;
      if (await writeClipboard(text)) flashDone(kind);
      else toast({ variant: "error", title: t.clipboardFailed });
    }

    function toggleSpeech() {
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        toast({ variant: "info", title: t.speechUnsupported });
        return;
      }
      if (speaking) {
        synth.cancel();
        setSpeaking(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(selection.text);
      utterance.lang = ARABIC.test(selection.text) ? "ar" : language === "en" ? "en-US" : "fr-FR";
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      synth.cancel();
      synth.speak(utterance);
      startedSpeechRef.current = true;
      setSpeaking(true);
    }

    function jumpToNextOccurrence() {
      if (occurrences.length < 2) return;
      const next = (findIndex + 1) % occurrences.length;
      const range = occurrences[next];
      range.startContainer.parentElement?.scrollIntoView({ block: "center" });
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      savedRangeRef.current = range.cloneRange();
      setFindIndex(next);
    }

    async function handleShare() {
      const text = `« ${selection.text.trim()} »${courseTitle ? ` — ${courseTitle}` : ""}`;
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ title: courseTitle ?? "MedArt AI", text });
        } catch {
          // Cancelled by the student — nothing to do.
        }
        return;
      }
      if (await writeClipboard(text)) flashDone("share");
      else toast({ variant: "error", title: t.clipboardFailed });
    }

    async function handleCard() {
      setBusyCard(true);
      try {
        const blob = await renderQuoteCard(selection.text, courseTitle);
        const file = new File([blob], "medart-citation.png", { type: "image/png" });
        const coarse = window.matchMedia("(pointer: coarse)").matches;
        if (coarse && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: courseTitle ?? "MedArt AI" }).catch(() => undefined);
        } else {
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "medart-citation.png";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
        flashDone("card");
      } catch {
        toast({ variant: "error", title: t.cardFailed });
      } finally {
        setBusyCard(false);
      }
    }

    async function handleSaveNoteDraft() {
      if (noteDraft === null || !noteDraft.trim()) return;
      setIsSavingNote(true);
      try {
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Note ajoutée depuis une sélection",
            content: escapeHtml(noteDraft),
            ...(moduleId != null ? { moduleId, courseTitle } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.success) {
          toast({ variant: "success", title: t.noteSaved });
          setDismissed(true);
        } else {
          toast({ variant: "error", title: t.noteFailed, description: data?.error ?? "Réessaie." });
        }
      } catch {
        toast({ variant: "error", title: t.noteFailed, description: "Impossible de contacter le serveur." });
      } finally {
        setIsSavingNote(false);
      }
    }

    async function handleUnhighlight() {
      if (markAncestor) {
        const highlightId = markAncestor.dataset.highlightId;
        removeHighlight(markAncestor);

        // Real persistence: the highlight only stops coming back on the
        // next visit if its row is actually deleted server-side, not just
        // unwrapped from THIS render of the DOM.
        if (highlightId) {
          fetch(`/api/highlights?id=${encodeURIComponent(highlightId)}`, { method: "DELETE" }).catch(() => {
            // Best-effort: the DOM is already updated: a failed delete just
            // means this highlight may reappear on the next visit, not a
            // broken UI right now.
          });
        }
      }
      setDismissed(true);
      onHighlightChange?.();
    }

    async function handlePickColor(color: (typeof HIGHLIGHT_COLORS)[number]) {
      // The live selection when it's still there; otherwise the range saved
      // when the card opened (a tap on the card can collapse it on touch).
      const sel = window.getSelection();
      const live = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null;
      const range = live ?? savedRangeRef.current;
      if (!range || range.collapsed) return;

      // Captured BEFORE the DOM mutation below — surroundContents/
      // extractContents change the tree, which would invalidate range
      // offsets computed afterward.
      const offsets = container ? computeOffsets(container, range) : null;

      const mark = wrapRangeInMark(range, color.markClass);
      sel?.removeAllRanges();
      if (!mark) {
        setDismissed(true);
        onHighlightChange?.();
        return;
      }

      setDismissed(true);
      onHighlightChange?.();

      if (!courseSlug) return;
      try {
        const res = await fetch("/api/highlights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: courseSlug,
            selectedText: selection.text,
            color: color.id,
            startOffset: offsets?.startOffset,
            endOffset: offsets?.endOffset,
          }),
        });
        const data = await res.json().catch(() => null);
        // Tag the live mark with its real row id so a later unhighlight can
        // delete the exact persisted row, not just search by text.
        if (data?.highlight?.id !== undefined) mark.dataset.highlightId = String(data.highlight.id);
      } catch {
        // The highlight still looks applied locally; it just won't survive
        // a reload if this save failed.
      }
    }

    const toggleTray = (next: Tray) => setTray((current) => (current === next ? "none" : next));
    const preview = selection.text.replace(/\s+/g, " ").trim();

    const panelClass =
      "fixed z-[99999] w-[min(23rem,calc(100vw-16px))] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/85 text-slate-100 shadow-[0_28px_70px_-18px_rgba(2,6,23,0.95),0_0_0_1px_rgba(255,255,255,0.03),0_0_44px_-14px_rgba(34,211,238,0.45)] backdrop-blur-2xl backdrop-saturate-150 [@media(hover:none)]:bg-slate-950/[0.97]";
    const panelMotionClass = placed ? "transition-[top,left] duration-200 ease-out" : "";

    const panelStyle = {
      top: position?.top ?? selection.top,
      left: position?.left ?? selection.left,
      visibility: position ? ("visible" as const) : ("hidden" as const),
    };

    const entrance = reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 6, scale: 0.97 },
          animate: { opacity: 1, y: 0, scale: 1 },
          transition: { type: "spring" as const, stiffness: 460, damping: 32, mass: 0.7 },
        };

    const glowLine = <span aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent" />;

    // Keep the selection alive when the card is clicked with a mouse (focus
    // moving to a button would otherwise clear it). Touch is left alone:
    // preventing touchstart would also cancel the tap.
    const keepSelection = (event: ReactMouseEvent) => {
      if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault();
    };

    if (noteDraft !== null) {
      return createPortal(
        <motion.div ref={setRefs} {...entrance} style={panelStyle} className={cn(panelClass, panelMotionClass, "p-3")}>
          {glowLine}
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-cyan-200">
            <NotebookPen className="h-4 w-4" />
            {t.note}
          </div>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={4}
            autoFocus
            dir="auto"
            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.06] p-2.5 text-sm text-white outline-none placeholder:text-white/40 focus-visible:border-cyan-300/50 focus-visible:ring-1 focus-visible:ring-cyan-300/40"
            placeholder={t.notePlaceholder}
          />
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setNoteDraft(null)}
              disabled={isSavingNote}
              className="inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={handleSaveNoteDraft}
              disabled={isSavingNote || !noteDraft.trim()}
              className="inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-400 to-sky-500 px-3.5 text-xs font-bold text-slate-950 shadow-[0_0_18px_-4px_rgba(34,211,238,0.7)] transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSavingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {t.save}
            </button>
          </div>
        </motion.div>,
        document.body
      );
    }

    return createPortal(
      <motion.div ref={setRefs} role="toolbar" aria-label={t.toolbar} onMouseDown={keepSelection} {...entrance} style={panelStyle} className={cn(panelClass, panelMotionClass)}>
        {glowLine}

        {/* What is selected */}
        <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3">
          <Quote className="h-4 w-4 shrink-0 text-cyan-300/80" />
          <p dir="auto" className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-200">
            {preview}
          </p>
          <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-400">
            {t.words(wordCount)}
          </span>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={t.close}
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Primary actions — the only two that reach the AI, through the parent */}
        <div className="flex gap-2 px-3">
          <button
            type="button"
            onClick={() => onAsk(selection.text)}
            className="group relative flex min-h-[2.75rem] flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-cyan-400 via-sky-400 to-violet-500 px-3 text-sm font-black text-slate-950 shadow-[0_0_26px_-6px_rgba(34,211,238,0.85)] transition-transform active:scale-[0.98]"
          >
            <span aria-hidden className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/45 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <Sparkles className="relative h-4 w-4" />
            <span className="relative">Ask MedArt</span>
          </button>
          <button
            type="button"
            onClick={() => onTranslate(selection.text)}
            className="flex min-h-[2.75rem] items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 text-sm font-semibold text-slate-100 transition-colors hover:border-white/20 hover:bg-white/10 active:scale-[0.98]"
          >
            <Languages className="h-4 w-4 text-sky-300" />
            {t.translate}
          </button>
        </div>

        {/* Tiles */}
        <div className="grid grid-cols-4 gap-1.5 px-3 pb-3 pt-2">
          <Tile icon={<NotebookPen className="h-[18px] w-[18px]" />} label={t.note} onClick={() => setNoteDraft(selection.text)} />
          <Tile
            icon={markAncestor ? <Eraser className="h-[18px] w-[18px]" /> : <Highlighter className="h-[18px] w-[18px] text-yellow-300" />}
            label={markAncestor ? t.unhighlight : t.highlight}
            active={tray === "highlight"}
            onClick={() => (markAncestor ? void handleUnhighlight() : toggleTray("highlight"))}
          />
          <Tile icon={<Search className="h-[18px] w-[18px]" />} label={t.search} active={tray === "search"} onClick={() => toggleTray("search")} />
          <Tile icon={<LayoutGrid className="h-[18px] w-[18px]" />} label={t.tools} active={tray === "tools"} onClick={() => toggleTray("tools")} />
        </div>

        {/* Tray */}
        <AnimatePresence initial={false} mode="wait">
          {tray !== "none" && (
            <motion.div
              key={tray}
              initial={reduceMotion ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="border-t border-white/[0.06] bg-black/20 px-3 py-3"
            >
              {tray === "highlight" && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t.highlight}</span>
                  <div className="flex items-center gap-2.5">
                    {HIGHLIGHT_COLORS.map((color) => (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() => handlePickColor(color)}
                        aria-label={color.label}
                        title={color.label}
                        className={cn(
                          "h-8 w-8 rounded-full ring-2 ring-white/20 ring-offset-2 ring-offset-slate-950 transition-transform duration-150 hover:scale-110 hover:ring-white/60 active:scale-95",
                          color.dotClass
                        )}
                      />
                    ))}
                  </div>
                </div>
              )}

              {tray === "search" && (
                <div className="grid grid-cols-3 gap-1.5">
                  {SEARCH_ENGINES.map((engine) => (
                    <button
                      key={engine.id}
                      type="button"
                      onClick={() => window.open(engine.url(selection.text.trim()), "_blank", "noopener,noreferrer")}
                      className="group flex min-h-[2.75rem] items-center justify-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 text-xs font-semibold text-slate-200 transition-colors hover:border-white/15 hover:bg-white/[0.08]"
                    >
                      <engine.icon className="h-4 w-4 shrink-0 text-sky-300" />
                      <span className="truncate">{engine.label}</span>
                      <ChevronRight className="h-3 w-3 shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  ))}
                </div>
              )}

              {tray === "tools" && (
                <div className="grid grid-cols-2 gap-1.5 min-[360px]:grid-cols-3">
                  <ToolButton icon={<Copy className="h-4 w-4 text-sky-300" />} label={doneAction === "plain" ? t.copied : t.copy} done={doneAction === "plain"} onClick={() => handleCopy("plain")} />
                  <ToolButton icon={<Quote className="h-4 w-4 text-sky-300" />} label={doneAction === "quote" ? t.copied : t.quote} done={doneAction === "quote"} onClick={() => handleCopy("quote")} />
                  <ToolButton
                    icon={speaking ? <Square className="h-3.5 w-3.5 fill-current text-cyan-300" /> : <Volume2 className="h-4 w-4 text-sky-300" />}
                    label={speaking ? t.stop : t.listen}
                    accent={speaking}
                    onClick={toggleSpeech}
                  />
                  <ToolButton
                    icon={<ScanSearch className="h-4 w-4 text-sky-300" />}
                    label={occurrences.length > 1 ? `${findIndex + 1}/${occurrences.length}` : t.find}
                    title={occurrences.length > 1 ? `${t.find} ${findIndex + 1}/${occurrences.length}` : t.find}
                    disabled={occurrences.length < 2}
                    onClick={jumpToNextOccurrence}
                  />
                  <ToolButton icon={<Share2 className="h-4 w-4 text-sky-300" />} label={doneAction === "share" ? t.copied : t.share} done={doneAction === "share"} onClick={handleShare} />
                  <ToolButton
                    icon={busyCard ? <Loader2 className="h-4 w-4 animate-spin text-sky-300" /> : <ImageDown className="h-4 w-4 text-sky-300" />}
                    label={t.card}
                    done={doneAction === "card"}
                    disabled={busyCard}
                    onClick={handleCard}
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>,
      document.body
    );
  }
);
