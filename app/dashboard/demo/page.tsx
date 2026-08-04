"use client";

import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Dna, HeartPulse, Maximize2, Minimize2, Moon, Sun } from "lucide-react";
import { DEMO_SECTIONS, buildDemoAskPrompt, buildDemoTranslatePrompt, type DemoSectionId } from "@/lib/demo-content";
import { cn } from "@/lib/utils";
import {
  PROSE_CLASSES,
  DARK_PROSE_CLASSES,
  MARKDOWN_COMPONENTS,
  DARK_MARKDOWN_COMPONENTS,
  normalizeCallouts,
} from "@/lib/markdown";
import { useTextSelection } from "@/hooks/useTextSelection";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useCourseChat } from "@/hooks/useCourseChat";
import { SelectionTooltip } from "@/components/course/workspace/SelectionTooltip";
import { ChatPanel } from "@/components/course/workspace/ChatPanel";
import { ResumeStudio } from "@/components/course/workspace/ResumeStudio";
import { CasCliniqueStudio } from "@/components/course/workspace/CasCliniqueStudio";
import { ExamQcmStudio } from "@/components/course/workspace/ExamQcmStudio";

export default function DemoWorkspacePage() {
  const [activeId, setActiveId] = useState<DemoSectionId>("explication");
  const [isDark, setIsDark] = useState(true);
  const today = new Date().toLocaleDateString("fr-FR");
  const activeSection = DEMO_SECTIONS.find((s) => s.id === activeId) ?? DEMO_SECTIONS[0];

  const { containerRef, tooltipRef, selection, clearSelection } = useTextSelection();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  const { chatOpen, setChatOpen, chatMessages, chatInput, setChatInput, isTyping, sendChatMessage } = useCourseChat();

  function handleAsk(selectedText: string) {
    sendChatMessage(buildDemoAskPrompt(selectedText));
    clearSelection();
  }

  function handleTranslate(selectedText: string) {
    sendChatMessage(buildDemoTranslatePrompt(selectedText));
    clearSelection();
  }

  function handleChatSubmit() {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    sendChatMessage(text);
  }

  return (
    <div
      className={cn(
        "relative isolate flex h-screen w-full overflow-hidden transition-colors duration-500",
        isDark ? "bg-slate-950" : "bg-slate-50"
      )}
    >
      {/* Fond — Aurore animée (sombre) ou dégradé doux (clair) */}
      {isDark ? (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-20 overflow-hidden">
            <div className="animate-aurora-breathe absolute -left-40 -top-40 h-[42rem] w-[42rem] rounded-full bg-[radial-gradient(circle,rgba(6,182,212,0.08),transparent_70%)] blur-3xl" />
            <div
              className="animate-aurora-breathe absolute -bottom-40 -right-20 h-[46rem] w-[46rem] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.08),transparent_70%)] blur-3xl"
              style={{ animationDelay: "4s", animationDuration: "15s" }}
            />
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem]"
          />
        </>
      ) : (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 animate-[pulse_10s_ease-in-out_infinite] bg-gradient-to-br from-slate-50 via-white to-slate-100"
        />
      )}

      {/* Panneau Gauche — Sources (masqué en mode discussion) */}
      <aside
        className={cn(
          "relative flex w-72 shrink-0 flex-col overflow-hidden p-4 backdrop-blur-2xl transition-all duration-300",
          isDark ? "border-r border-white/10 bg-slate-950" : "border-r bg-white/80",
          chatOpen && "hidden"
        )}
      >
        <div
          aria-hidden
          className={cn(
            "animate-sidebar-wave pointer-events-none absolute -left-24 top-1/3 z-0 h-96 w-96 rounded-full blur-2xl",
            isDark
              ? "bg-[radial-gradient(circle,rgba(6,95,70,0.2),rgba(13,148,136,0.1)_60%,transparent_75%)]"
              : "bg-[radial-gradient(circle,rgba(209,250,229,0.4),rgba(240,253,250,0.5)_60%,transparent_75%)]"
          )}
        />
        <Dna
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-64 w-64 -translate-x-1/2 -translate-y-1/2 text-emerald-500 opacity-[0.03]"
          strokeWidth={1}
        />

        <Link
          href="/dashboard"
          className={cn(
            "relative z-10 mb-4 flex items-center gap-2 text-sm font-medium transition-colors duration-300",
            isDark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
          )}
        >
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Link>

        <h2
          className={cn(
            "relative z-10 mb-3 text-xs font-semibold uppercase tracking-wide",
            isDark ? "text-slate-500" : "text-gray-400"
          )}
        >
          Sources
        </h2>

        <div
          className={cn(
            "relative z-10 flex items-start gap-2 overflow-hidden rounded-xl p-3",
            isDark ? "border border-white/10 bg-slate-800/40 pl-4 text-slate-200" : "border-none bg-gray-100 text-gray-700"
          )}
        >
          {isDark && (
            <span
              aria-hidden
              className="absolute left-0 top-0 h-full w-0.5 rounded-full bg-cyan-400 shadow-[0_0_8px_2px_rgba(34,211,238,0.6)]"
            />
          )}
          <span className="text-base leading-none">📄</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Appendicite_Cours.pdf</p>
            <p className={cn("mt-0.5 text-xs", isDark ? "text-slate-500" : "text-gray-500")}>
              {today} · 1.2 Mo
            </p>
          </div>
        </div>
      </aside>

      {/* Panneau Central — Lecture */}
      <main
        className={cn(
          "relative z-10 flex-1 overflow-y-auto transition-colors duration-500",
          isDark ? "custom-scrollbar bg-transparent" : "scrollbar-thin bg-slate-50/60",
          isFullscreen && !chatOpen && cn("fixed inset-0 z-40", isDark ? "bg-slate-950" : "bg-slate-50")
        )}
      >
        {!chatOpen && (
          <div className="sticky top-0 z-30 flex justify-end gap-2 p-4">
            <button
              onClick={() => setIsDark((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-md transition-all duration-300",
                isDark
                  ? "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                  : "border-slate-200 bg-white/90 text-gray-600 shadow-sm hover:bg-gray-50"
              )}
            >
              {isDark ? (
                <>
                  <Sun className="h-3.5 w-3.5" />
                  Mode Clair
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5" />
                  Mode Sombre
                </>
              )}
            </button>

            <button
              onClick={toggleFullscreen}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-md transition-all duration-300",
                isDark
                  ? "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                  : "border-slate-200 bg-white/90 text-gray-600 shadow-sm hover:bg-gray-50"
              )}
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
            "mx-auto mb-8 w-full select-text transition-all duration-500",
            "rounded-2xl p-12 backdrop-blur-2xl",
            isDark ? "border border-white/10 bg-slate-900/80 shadow-2xl" : "border border-slate-200/80 bg-white shadow-sm",
            activeId === "resume" || activeId === "cas_clinique" || activeId === "qcm" ? "max-w-5xl" : "max-w-3xl",
            chatOpen && "mt-8"
          )}
        >
          {activeId === "resume" ? (
            <ResumeStudio />
          ) : activeId === "cas_clinique" ? (
            <CasCliniqueStudio />
          ) : activeId === "qcm" ? (
            <ExamQcmStudio />
          ) : (
            <article
              key={activeSection.id}
              className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "animate-fade-in")}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}
              >
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
          "relative flex w-80 shrink-0 flex-col overflow-hidden p-4 backdrop-blur-2xl transition-all duration-300",
          isDark ? "border-l border-white/10 bg-slate-950" : "border-l bg-slate-50/80",
          chatOpen && "hidden"
        )}
      >
        <div
          aria-hidden
          className={cn(
            "animate-sidebar-wave pointer-events-none absolute -right-24 bottom-1/3 z-0 h-96 w-96 rounded-full blur-2xl",
            isDark
              ? "bg-[radial-gradient(circle,rgba(6,95,70,0.2),rgba(13,148,136,0.1)_60%,transparent_75%)]"
              : "bg-[radial-gradient(circle,rgba(209,250,229,0.4),rgba(240,253,250,0.5)_60%,transparent_75%)]"
          )}
          style={{ animationDelay: "6s", animationDuration: "22s" }}
        />
        <HeartPulse
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-64 w-64 -translate-x-1/2 -translate-y-1/2 text-emerald-500 opacity-[0.03]"
          strokeWidth={1}
        />

        <h2
          className={cn(
            "relative z-10 mb-3 text-xs font-semibold uppercase tracking-wide",
            isDark ? "text-slate-500" : "text-gray-400"
          )}
        >
          Studio
        </h2>

        <div className="relative z-10 flex flex-col gap-2">
          {DEMO_SECTIONS.map(({ id, label, icon: Icon, accent }) => {
            const isActive = id === activeId;
            return (
              <button
                key={id}
                onClick={() => setActiveId(id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all duration-300",
                  isDark
                    ? isActive
                      ? "border-l-2 border-cyan-400 bg-cyan-500/10 text-white shadow-[0_0_20px_-6px_rgba(34,211,238,0.5)]"
                      : "border-l-2 border-transparent text-slate-400 hover:translate-x-1 hover:bg-white/5 hover:text-slate-200"
                    : isActive
                      ? cn(accent.active, "border shadow-sm")
                      : cn("border border-slate-200 bg-white text-gray-700", accent.hover)
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                    isDark && !isActive ? "bg-white/5 text-slate-400" : accent.chip
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
        dark={isDark}
      />
    </div>
  );
}
