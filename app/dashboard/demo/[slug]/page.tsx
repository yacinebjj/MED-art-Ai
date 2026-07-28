"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Dna, HeartPulse, Loader2, Maximize2, Minimize2, Moon, Sun } from "lucide-react";
import { DEMO_SECTIONS, buildDemoAskPrompt, buildDemoTranslatePrompt, type DemoSectionId } from "@/lib/demo-content";
import { COURSE_SLUG_CONTENT, isCourseSlug, type CourseSlugSupabaseData } from "@/lib/course-slug-content";
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
import { VisualStudioDemo } from "@/components/visual-studio/VisualStudioDemo";
import { GastriteVisualStudio } from "@/components/visual-studio/GastriteVisualStudio";
import { GastriteResumeStudio } from "@/components/course/workspace/GastriteResumeStudio";
import { GastriteCasCliniqueStudio } from "@/components/course/workspace/GastriteCasCliniqueStudio";
import { GastriteQcmsStudio } from "@/components/course/workspace/GastriteQcmsStudio";
import { LazySection } from "@/components/course/workspace/LazySection";

export default function CourseSlugWorkspacePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  return <CourseSlugWorkspace slug={slug} />;
}

/**
 * Maps each Studio tab to the `CourseSlugSupabaseData` field it reads/writes,
 * the modular generation route that fills it, and the label used in the
 * LazySection empty-state button — one config drives the whole lazy-loading
 * UX for all 5 tabs.
 */
const SECTION_LAZY_CONFIG: Partial<
  Record<DemoSectionId, { dataKey: keyof CourseSlugSupabaseData; endpoint: string; label: string }>
> = {
  explication: { dataKey: "explication", endpoint: "/api/generate/explication", label: "l'Explication" },
  visual_studio: { dataKey: "mode_visuel", endpoint: "/api/generate/mode-visuel", label: "le Mode Visuel" },
  resume: { dataKey: "resume", endpoint: "/api/generate/resume", label: "le Résumé" },
  cas_clinique: { dataKey: "cas_clinique", endpoint: "/api/generate/cas-clinique", label: "les Cas Cliniques" },
  qcm: { dataKey: "qcms", endpoint: "/api/generate/qcm", label: "les QCM" },
};

function NotFoundScreen({ slug }: { slug: string }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-slate-50 text-center">
      <p className="text-lg font-semibold text-slate-900">Cours introuvable</p>
      <p className="max-w-sm text-sm text-slate-500">
        Aucun contenu n'est disponible pour « {slug} » pour le moment.
      </p>
      <Link
        href="/dashboard"
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour au dashboard
      </Link>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  );
}

function CourseSlugWorkspace({ slug }: { slug: string }) {
  // Slugs with content hardcoded ahead of time (appendicite, gastrite, ulcere,
  // rectocolite) — their explication tab and Sources card keep using this
  // static content exactly as before, even once a Supabase row also exists.
  const legacySlugData = isCourseSlug(slug) ? COURSE_SLUG_CONTENT[slug] : undefined;

  // Any course row saved in Supabase's `courses` table, looked up by slug.
  // Brand-new courses (no legacy entry) render entirely from this; gastrite
  // keeps its legacy explication but still gets its 4 Studio tabs from here.
  const [supabaseData, setSupabaseData] = useState<CourseSlugSupabaseData | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setSupabaseData(undefined);

    fetch(`/api/courses/slug/${slug}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: CourseSlugSupabaseData) => {
        if (!cancelled) setSupabaseData(data);
      })
      .catch(() => {
        if (!cancelled) setSupabaseData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const hasStudioData = !!supabaseData;
  const title = legacySlugData?.title ?? supabaseData?.title ?? "";
  const explicationContent = legacySlugData?.content ?? supabaseData?.explication ?? "";
  const sourceFileName = legacySlugData?.source.fileName ?? title;
  const sourceSize = legacySlugData?.source.size ?? "Cours interactif";

  const sections = useMemo(
    () =>
      DEMO_SECTIONS.map((section) =>
        section.id === "explication" ? { ...section, content: explicationContent } : section
      ),
    [explicationContent]
  );

  const [activeId, setActiveId] = useState<DemoSectionId>("explication");
  const [isDark, setIsDark] = useState(true);
  const today = new Date().toLocaleDateString("fr-FR");
  const activeSection = sections.find((s) => s.id === activeId) ?? sections[0];

  // Lazy loading: a freshly-uploaded course's row has every content column
  // (mode_visuel/resume/cas_clinique/qcms/explication) set to null. Each is
  // generated on demand — the student clicks "Générer ..." on the relevant
  // tab (handled by <LazySection>) rather than all 5 being generated at once
  // at upload time (that single mega-call routinely got truncated on larger
  // source documents).
  function handleSectionGenerated<K extends keyof CourseSlugSupabaseData>(dataKey: K, data: CourseSlugSupabaseData[K]) {
    setSupabaseData((prev) => (prev ? { ...prev, [dataKey]: data } : prev));
  }

  // Slugs with fully authored per-tab markdown (legacy gastrite fallback)
  // render that here instead of the fixed appendicite-specific interactive
  // components (ResumeStudio, VisualStudioDemo, CasCliniqueStudio, ExamQcmStudio).
  const customTabContent: string | undefined =
    activeId === "resume"
      ? legacySlugData?.resume
      : activeId === "visual_studio"
        ? legacySlugData?.visualBreakdown
        : activeId === "cas_clinique"
          ? legacySlugData?.casClinique
          : activeId === "qcm"
            ? legacySlugData?.qcm
            : undefined;

  // Any slug with a Supabase-backed row gets the interactive Mode Visuel,
  // Résumé, Cas Clinique and QCM Studio components, fed by that row's data —
  // this is what makes a brand-new course fully navigable the moment its
  // row exists in `courses`, with zero code change per course.
  const showVisualStudioData = hasStudioData && activeId === "visual_studio";
  const showResumeStudioData = hasStudioData && activeId === "resume";
  const showCasCliniqueStudioData = hasStudioData && activeId === "cas_clinique";
  const showQcmsStudioData = hasStudioData && activeId === "qcm";

  const { containerRef, tooltipRef, selection, clearSelection } = useTextSelection();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  const { chatOpen, setChatOpen, chatMessages, chatInput, setChatInput, isTyping, sendChatMessage } = useCourseChat(slug);

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

  // No legacy content, and Supabase confirmed there's no row for this slug either.
  if (!legacySlugData && supabaseData === null) {
    return <NotFoundScreen slug={slug} />;
  }

  // No legacy content to show immediately, and we don't know yet whether
  // Supabase has a row — avoid a "Cours introuvable" flash while it loads.
  if (!legacySlugData && supabaseData === undefined) {
    return <LoadingScreen />;
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
            <p className="truncate text-sm font-medium">{sourceFileName}</p>
            <p className={cn("mt-0.5 text-xs", isDark ? "text-slate-500" : "text-gray-500")}>
              {today} · {sourceSize}
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
            activeId === "visual_studio" && (!customTabContent || showVisualStudioData)
              ? "max-w-6xl"
              : cn(
                  "rounded-2xl p-12 backdrop-blur-2xl",
                  isDark ? "border border-white/10 bg-slate-900/80 shadow-2xl" : "border border-slate-200/80 bg-white shadow-sm",
                  activeId === "resume" || activeId === "cas_clinique" || activeId === "qcm" || (activeId === "visual_studio" && customTabContent)
                    ? "max-w-5xl"
                    : "max-w-3xl"
                ),
            chatOpen && "mt-8"
          )}
        >
          {showVisualStudioData ? (
            <LazySection
              dark={isDark}
              data={supabaseData?.mode_visuel}
              label={SECTION_LAZY_CONFIG.visual_studio!.label}
              endpoint={SECTION_LAZY_CONFIG.visual_studio!.endpoint}
              slug={slug}
              onGenerated={(data) => handleSectionGenerated("mode_visuel", data)}
            >
              {(data) => <GastriteVisualStudio dark={isDark} data={data} />}
            </LazySection>
          ) : showResumeStudioData ? (
            <LazySection
              dark={isDark}
              data={supabaseData?.resume}
              label={SECTION_LAZY_CONFIG.resume!.label}
              endpoint={SECTION_LAZY_CONFIG.resume!.endpoint}
              slug={slug}
              onGenerated={(data) => handleSectionGenerated("resume", data)}
            >
              {(data) => <GastriteResumeStudio data={data} />}
            </LazySection>
          ) : showCasCliniqueStudioData ? (
            <LazySection
              dark={isDark}
              data={supabaseData?.cas_clinique}
              label={SECTION_LAZY_CONFIG.cas_clinique!.label}
              endpoint={SECTION_LAZY_CONFIG.cas_clinique!.endpoint}
              slug={slug}
              onGenerated={(data) => handleSectionGenerated("cas_clinique", data)}
            >
              {(data) => <GastriteCasCliniqueStudio data={data} />}
            </LazySection>
          ) : showQcmsStudioData ? (
            <LazySection
              dark={isDark}
              data={supabaseData?.qcms}
              label={SECTION_LAZY_CONFIG.qcm!.label}
              endpoint={SECTION_LAZY_CONFIG.qcm!.endpoint}
              slug={slug}
              onGenerated={(data) => handleSectionGenerated("qcms", data)}
            >
              {(data) => <GastriteQcmsStudio data={data} />}
            </LazySection>
          ) : customTabContent ? (
            <article
              key={activeId}
              className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "animate-fade-in")}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}
              >
                {normalizeCallouts(customTabContent)}
              </ReactMarkdown>
            </article>
          ) : activeId === "resume" ? (
            <ResumeStudio />
          ) : activeId === "visual_studio" ? (
            <VisualStudioDemo />
          ) : activeId === "cas_clinique" ? (
            <CasCliniqueStudio />
          ) : activeId === "qcm" ? (
            <ExamQcmStudio />
          ) : activeId === "explication" && hasStudioData && !legacySlugData ? (
            <LazySection
              dark={isDark}
              data={supabaseData?.explication}
              label={SECTION_LAZY_CONFIG.explication!.label}
              endpoint={SECTION_LAZY_CONFIG.explication!.endpoint}
              slug={slug}
              onGenerated={(data) => handleSectionGenerated("explication", data)}
            >
              {(content) => (
                <article className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "animate-fade-in")}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}
                  >
                    {normalizeCallouts(content)}
                  </ReactMarkdown>
                </article>
              )}
            </LazySection>
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
          {sections.map(({ id, label, icon: Icon, accent }) => {
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
