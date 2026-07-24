"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, FileText, Maximize2, Minimize2 } from "lucide-react";
import {
  DEMO_SECTIONS,
  buildDemoAskPrompt,
  buildDemoAskReply,
  buildDemoTranslatePrompt,
  buildDemoTranslateReply,
  type DemoSectionId,
} from "@/lib/demo-content";
import { cn } from "@/lib/utils";
import { PROSE_CLASSES, MARKDOWN_COMPONENTS, normalizeCallouts } from "@/lib/markdown";
import { useTextSelection } from "@/hooks/useTextSelection";
import { useFullscreen } from "@/hooks/useFullscreen";
import { SelectionTooltip } from "@/components/course/workspace/SelectionTooltip";
import { ChatPanel } from "@/components/course/workspace/ChatPanel";
import { ResumeStudio } from "@/components/course/workspace/ResumeStudio";
import type { ChatMessage } from "@/lib/types";

export default function DemoWorkspacePage() {
  const [activeId, setActiveId] = useState<DemoSectionId>("explication");
  const today = new Date().toLocaleDateString("fr-FR");
  const activeSection = DEMO_SECTIONS.find((s) => s.id === activeId) ?? DEMO_SECTIONS[0];

  const { containerRef, tooltipRef, selection, clearSelection } = useTextSelection();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  function sendDemoMessage(userContent: string, reply: string) {
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: userContent };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatOpen(true);
    setIsTyping(true);

    typingTimeoutRef.current = setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: reply },
      ]);
      setIsTyping(false);
    }, 900);
  }

  function handleAsk(selectedText: string) {
    sendDemoMessage(buildDemoAskPrompt(selectedText), buildDemoAskReply(selectedText));
    clearSelection();
  }

  function handleTranslate(selectedText: string) {
    sendDemoMessage(buildDemoTranslatePrompt(selectedText), buildDemoTranslateReply(selectedText));
    clearSelection();
  }

  function handleChatSubmit() {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    sendDemoMessage(
      text,
      "Merci pour ta question ! Ceci est une démonstration statique de l'interface — les réponses réelles de MedArt arriveront une fois l'intégration IA réactivée. 🙂"
    );
  }

  return (
    <div className="relative isolate flex h-screen w-full overflow-hidden bg-slate-50">
      {/* Fond animé très doux */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 animate-[pulse_10s_ease-in-out_infinite] bg-gradient-to-br from-slate-50 via-white to-slate-100"
      />

      {/* Panneau Gauche — Sources (masqué en mode discussion) */}
      <aside
        className={cn(
          "flex w-64 shrink-0 flex-col border-r bg-white/80 p-4 backdrop-blur",
          chatOpen && "hidden"
        )}
      >
        <Link
          href="/dashboard"
          className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Link>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Sources
        </h2>

        <div className="flex items-start gap-2 rounded-lg bg-gray-100 p-3 text-gray-700">
          <span className="text-base leading-none">📄</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Appendicite_Cours.pdf</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {today} · 1.2 Mo
            </p>
          </div>
        </div>
      </aside>

      {/* Panneau Central — Lecture */}
      <main
        className={cn(
          "relative z-10 flex-1 overflow-y-auto bg-slate-50/60",
          isFullscreen && !chatOpen && "fixed inset-0 z-40 bg-slate-50"
        )}
      >
        {!chatOpen && (
          <div className="sticky top-0 z-30 flex justify-end p-4">
            <button
              onClick={toggleFullscreen}
              className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm backdrop-blur transition-colors hover:bg-gray-50"
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="h-3.5 w-3.5" />
                  Quitter le plein écran
                </>
              ) : (
                <>
                  <Maximize2 className="h-3.5 w-3.5" />
                  Plein écran
                </>
              )}
            </button>
          </div>
        )}

        <div
          ref={containerRef}
          onContextMenu={(e) => e.preventDefault()}
          className={cn(
            "mx-auto mb-8 select-text rounded-2xl border border-slate-200/80 bg-white p-12 shadow-sm",
            activeId === "resume" ? "max-w-5xl" : "max-w-3xl",
            chatOpen && "mt-8"
          )}
        >
          {activeId === "resume" ? (
            <ResumeStudio />
          ) : (
            <article key={activeSection.id} className={cn(PROSE_CLASSES, "animate-fade-in")}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {normalizeCallouts(activeSection.content)}
              </ReactMarkdown>
            </article>
          )}
        </div>

        {selection && (
          <SelectionTooltip
            ref={tooltipRef}
            selection={selection}
            onAsk={handleAsk}
            onTranslate={handleTranslate}
          />
        )}
      </main>

      {/* Panneau Droit — Studio (masqué en mode discussion) */}
      <aside
        className={cn(
          "flex w-80 shrink-0 flex-col border-l bg-slate-50/80 p-4 backdrop-blur",
          chatOpen && "hidden"
        )}
      >
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Studio
        </h2>

        <div className="flex flex-col gap-2">
          {DEMO_SECTIONS.map(({ id, label, icon: Icon, accent }) => {
            const isActive = id === activeId;
            return (
              <button
                key={id}
                onClick={() => setActiveId(id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all duration-300",
                  isActive
                    ? cn(accent.active, "shadow-sm")
                    : cn("border-slate-200 bg-white text-gray-700", accent.hover)
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                    accent.chip
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {label}
              </button>
            );
          })}
        </div>
      </aside>

      {/* Panneau de discussion — mode split 50/50 (glassmorphism) */}
      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={chatMessages}
        isTyping={isTyping}
        input={chatInput}
        onInputChange={setChatInput}
        onSend={handleChatSubmit}
        variant="split"
      />
    </div>
  );
}
