"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, FileDown, Flag, Loader2, MoreHorizontal, NotebookPen, RefreshCw, Square, ThumbsDown, ThumbsUp, Trash2, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { exportReplyToPdf } from "@/lib/assistant-export";
import { speak, stopSpeaking, useSpeakingId } from "@/hooks/useSpeechSynthesis";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAssistant } from "@/lib/translations/assistant";
import { useToast } from "@/components/ui/Toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { BottomSheetHandle, useBottomSheetMotion } from "@/components/ui/BottomSheet";

const ICON_BUTTON =
  "flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-[transform,background-color,color] duration-150 active:scale-90 active:bg-accent hover:bg-accent hover:text-emerald-500 disabled:opacity-50 sm:h-9 sm:w-9";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function MenuItem({ icon, label, onClick, tone = "default" }: { icon: ReactNode; label: string; onClick: () => void; tone?: "default" | "danger" | "active" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] transition-colors active:bg-accent hover:bg-accent sm:min-h-10 sm:text-sm",
        tone === "danger" && "text-rose-600 dark:text-rose-400",
        tone === "active" && "text-emerald-600 dark:text-emerald-400",
        tone === "default" && "text-foreground"
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
}

export function MessageActions({
  messageId,
  content,
  contentRef,
  questionText,
  onRefresh,
  onDelete,
}: {
  messageId: string;
  /** The reply as Markdown — what Copy puts on the clipboard and read-aloud speaks. */
  content: string;
  /** The rendered reply element; its HTML is what "Save to Notes" and "Export PDF" use. */
  contentRef: RefObject<HTMLDivElement>;
  /** The student's question this reply answers — only used to name the saved note. */
  questionText: string | null;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { language } = useLanguage();
  const { toast } = useToast();
  const router = useRouter();
  const isPhone = useMediaQuery("(max-width: 639px)");
  const speakingId = useSpeakingId();
  const isSpeaking = speakingId === messageId;

  const [copied, setCopied] = useState(false);
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved">("idle");
  const [isExporting, setIsExporting] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [reported, setReported] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { sheetProps, startDrag } = useBottomSheetMotion(() => setMenuOpen(false));

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  // Desktop popover only — the phone sheet has its own backdrop.
  useEffect(() => {
    if (!menuOpen || isPhone) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen, isPhone]);

  function later(fn: () => void, ms: number) {
    timers.current.push(setTimeout(fn, ms));
  }

  /** The rendered reply as clean HTML: presentational class/style attributes (animation and layout utilities meant for the chat thread) are dropped so they don't leak into a saved note or the PDF. */
  function replyHtml(): string {
    const html = contentRef.current?.innerHTML?.trim();
    if (!html) return `<p>${escapeHtml(content).replace(/\n/g, "<br>")}</p>`;
    return html.replace(/\s(?:class|style)="[^"]*"/g, "");
  }

  async function handleCopy() {
    haptic();
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      later(() => setCopied(false), 1500);
    } catch {
      toast({ variant: "error", title: "Copie impossible", description: "Ton navigateur a refusé l'accès au presse-papiers." });
    }
  }

  function handleSpeak() {
    haptic();
    if (isSpeaking) {
      stopSpeaking();
      return;
    }
    const result = speak(messageId, content, language, () =>
      toast({ variant: "error", title: tAssistant("speechFailed", language), description: tAssistant("speechFailedHint", language) })
    );
    if (!result.ok && result.reason !== "empty") {
      toast({
        variant: "info",
        title: tAssistant(result.reason === "unsupported" ? "speechUnsupported" : "speechNoVoice", language),
      });
    }
  }

  async function handleSaveToNotes() {
    if (noteState !== "idle") return;
    haptic();
    setNoteState("saving");
    try {
      const subject = (questionText ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: subject ? `MedArt — ${subject}` : "MedArt Assistant", content: replyHtml() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "L'enregistrement de la note a échoué.");
      setNoteState("saved");
      later(() => setNoteState("idle"), 2500);
      toast({
        variant: "success",
        title: tAssistant("noteSavedTitle", language),
        description: tAssistant("noteSavedDescription", language),
        action: { label: tAssistant("noteSavedOpen", language), onClick: () => router.push("/dashboard/notes") },
      });
    } catch (error) {
      setNoteState("idle");
      toast({
        variant: "error",
        title: tAssistant("noteSaveFailed", language),
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  async function handleExport() {
    setMenuOpen(false);
    if (isExporting) return;
    setIsExporting(true);
    try {
      await exportReplyToPdf({ title: "MedArt Assistant", html: replyHtml(), locale: language === "en" ? "en-US" : "fr-FR" });
    } catch (error) {
      toast({
        variant: "error",
        title: tAssistant("exportFailed", language),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsExporting(false);
    }
  }

  const menuItems = (
    <>
      <MenuItem
        icon={isExporting ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <FileDown className="h-[18px] w-[18px]" />}
        label={tAssistant("exportPdf", language)}
        onClick={handleExport}
      />
      <MenuItem
        icon={<ThumbsUp className="h-[18px] w-[18px]" />}
        label={tAssistant("goodResponse", language)}
        tone={feedback === "up" ? "active" : "default"}
        onClick={() => {
          setFeedback((prev) => (prev === "up" ? null : "up"));
          setMenuOpen(false);
        }}
      />
      <MenuItem
        icon={<ThumbsDown className="h-[18px] w-[18px]" />}
        label={tAssistant("badResponse", language)}
        tone={feedback === "down" ? "danger" : "default"}
        onClick={() => {
          setFeedback((prev) => (prev === "down" ? null : "down"));
          setMenuOpen(false);
        }}
      />
      <MenuItem
        icon={<Flag className="h-[18px] w-[18px]" />}
        label={reported ? tAssistant("reported", language) : tAssistant("reportResponse", language)}
        onClick={() => {
          setReported(true);
          setMenuOpen(false);
        }}
      />
      <MenuItem
        icon={<Trash2 className="h-[18px] w-[18px]" />}
        label={tAssistant("deleteResponse", language)}
        tone="danger"
        onClick={() => {
          setMenuOpen(false);
          onDelete(messageId);
        }}
      />
    </>
  );

  return (
    <div className="-ml-2.5 mt-1 flex flex-row items-center gap-0.5 text-muted-foreground sm:ml-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleSpeak}
            aria-label={isSpeaking ? tAssistant("stopSpeaking", language) : tAssistant("speak", language)}
            aria-pressed={isSpeaking}
            className={cn(ICON_BUTTON, isSpeaking && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")}
          >
            {isSpeaking ? <Square className="h-4 w-4 animate-pulse fill-current" /> : <Volume2 className="h-[18px] w-[18px]" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{isSpeaking ? tAssistant("stopSpeaking", language) : tAssistant("speak", language)}</TooltipContent>
      </Tooltip>

      <Tooltip open={copied ? true : undefined}>
        <TooltipTrigger asChild>
          <button type="button" onClick={handleCopy} aria-label={tAssistant("copyMarkdown", language)} className={ICON_BUTTON}>
            {copied ? <Check className="h-[18px] w-[18px] text-emerald-500" /> : <Copy className="h-[18px] w-[18px]" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{copied ? tAssistant("copied", language) : tAssistant("copyMarkdown", language)}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleSaveToNotes}
            disabled={noteState === "saving"}
            aria-label={noteState === "saved" ? tAssistant("savedToNotes", language) : tAssistant("saveToNotes", language)}
            className={ICON_BUTTON}
          >
            {noteState === "saving" ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" />
            ) : noteState === "saved" ? (
              <Check className="h-[18px] w-[18px] text-emerald-500" />
            ) : (
              <NotebookPen className="h-[18px] w-[18px]" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>{noteState === "saved" ? tAssistant("savedToNotes", language) : tAssistant("saveToNotes", language)}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => {
              haptic();
              onRefresh(messageId);
            }}
            aria-label={tAssistant("regenerateResponse", language)}
            className={ICON_BUTTON}
          >
            <RefreshCw className="h-[18px] w-[18px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{tAssistant("regenerateResponse", language)}</TooltipContent>
      </Tooltip>

      <div className="relative">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label={tAssistant("moreOptions", language)}
          aria-expanded={menuOpen}
          className={cn(ICON_BUTTON, feedback === "up" && "text-emerald-500", feedback === "down" && "text-rose-500")}
        >
          <MoreHorizontal className="h-[18px] w-[18px]" />
        </button>

        {/* Desktop: anchored popover. */}
        <AnimatePresence>
          {menuOpen && !isPhone && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-glass dark:shadow-glass-dark"
            >
              {menuItems}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Phone: bottom sheet, portaled to <body> so it can never be clipped by (or positioned against) the scrolling thread. */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {menuOpen && isPhone && (
              <>
                <motion.div
                  key="backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 z-[70] bg-black/50"
                  onClick={() => setMenuOpen(false)}
                />
                <motion.div
                  key="sheet"
                  {...sheetProps}
                  className="fixed inset-x-0 bottom-0 z-[71] rounded-t-3xl border-t border-border bg-popover pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-popover-foreground shadow-glass dark:shadow-glass-dark"
                >
                  <BottomSheetHandle onPointerDown={startDrag} className="mt-1" />
                  {menuItems}
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
