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
import { PROSE_CLASSES, MARKDOWN_COMPONENTS } from "@/lib/markdown";
import { useTextSelection } from "@/hooks/useTextSelection";
import { useFullscreen } from "@/hooks/useFullscreen";
import { SelectionTooltip } from "@/components/course/workspace/SelectionTooltip";
import { ChatPanel } from "@/components/course/workspace/ChatPanel";
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
    <div className="flex h-screen w-full overflow-hidden bg-[#F9FAFB]">
      {/* Panneau Gauche — Sources */}
      <aside className="flex w-64 shrink-0 flex-col border-r bg-white p-4">
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
          "relative flex-1 overflow-y-auto",
          isFullscreen && "fixed inset-0 z-40 bg-[#F9FAFB]"
        )}
      >
        <div className="sticky top-0 z-50 flex justify-end p-4">
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

        <div
          ref={containerRef}
          onContextMenu={(e) => e.preventDefault()}
          className="mx-auto mb-8 max-w-3xl select-text rounded-2xl bg-white p-12 shadow-sm ring-1 ring-slate-200"
        >
          <article key={activeSection.id} className={cn(PROSE_CLASSES, "animate-fade-in")}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {activeSection.content}
            </ReactMarkdown>
          </article>
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

      {/* Panneau Droit — Studio */}
      <aside className="flex w-80 shrink-0 flex-col border-l bg-slate-50 p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Studio
        </h2>

        <div className="flex flex-col gap-2">
          {DEMO_SECTIONS.map(({ id, label, icon: Icon }) => {
            const isActive = id === activeId;
            return (
              <button
                key={id}
                onClick={() => setActiveId(id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors",
                  isActive
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-gray-700 hover:bg-gray-100"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </div>
      </aside>

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={chatMessages}
        isTyping={isTyping}
        input={chatInput}
        onInputChange={setChatInput}
        onSend={handleChatSubmit}
      />
    </div>
  );
}
