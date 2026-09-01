"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { DEMO_SECTIONS, buildDemoTranslatePrompt, buildQuotedChatMessage, type DemoSectionId } from "@/lib/demo-content";
import { COURSE_SLUG_CONTENT, isCourseSlug, type CourseSlugSupabaseData } from "@/lib/course-slug-content";
import { cn } from "@/lib/utils";
import {
  PROSE_CLASSES,
  DARK_PROSE_CLASSES,
  MARKDOWN_COMPONENTS,
  DARK_MARKDOWN_COMPONENTS,
  normalizeCallouts,
} from "@/lib/markdown";
import { useCourseChat } from "@/hooks/useCourseChat";
import { useToast } from "@/components/ui/Toast";
import { WorkspaceTopbar } from "@/components/course/workspace/WorkspaceTopbar";
import { SourcesPanel } from "@/components/course/workspace/SourcesPanel";
import { ChatDocumentPanel, type ChatDocumentPanelHandle } from "@/components/course/workspace/ChatDocumentPanel";
import { StudioPanel, type SectionStatus } from "@/components/course/workspace/StudioPanel";
import { SourceDocumentPanel } from "@/components/course/workspace/SourceDocumentPanel";
import { ResumeStudio } from "@/components/course/workspace/ResumeStudio";
import { CasCliniqueStudio } from "@/components/course/workspace/CasCliniqueStudio";
import { ExamQcmStudio } from "@/components/course/workspace/ExamQcmStudio";
import { GastriteResumeStudio } from "@/components/course/workspace/GastriteResumeStudio";
import { GastriteCasCliniqueStudio } from "@/components/course/workspace/GastriteCasCliniqueStudio";
import { GastriteQcmsStudio } from "@/components/course/workspace/GastriteQcmsStudio";
import { LazySection } from "@/components/course/workspace/LazySection";
import { PomodoroStudyBanner } from "@/components/layout/PomodoroStudyBanner";
import { createClient } from "@/lib/supabase/client";

export default function CourseSlugWorkspacePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  return <CourseSlugWorkspace slug={slug} />;
}

const SECTION_LAZY_CONFIG: Partial<
  Record<DemoSectionId, { dataKey: keyof CourseSlugSupabaseData; endpoint: string; label: string }>
> = {
  explication: { dataKey: "explication", endpoint: "/api/generate/explication", label: "l'Explication" },
  resume: { dataKey: "resume", endpoint: "/api/generate/resume", label: "le Résumé" },
  cas_clinique: { dataKey: "cas_clinique", endpoint: "/api/generate/cas-clinique", label: "les Cas Cliniques" },
  qcm: { dataKey: "qcms", endpoint: "/api/generate/qcm", label: "les QCM" },
  exemples_analogies: {
    dataKey: "exemples_analogies",
    endpoint: "/api/generate/exemples-analogies",
    label: "les Exemples & Analogies",
  },
};

function NotFoundScreen({ slug }: { slug: string }) {
  return (
    <div className="aurora-canvas-bg flex h-dvh w-full flex-col items-center justify-center gap-4 text-center">
      <p className="text-lg font-semibold text-foreground">Cours introuvable</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Aucun contenu n'est disponible pour « {slug} » pour le moment.
      </p>
      <Link
        href="/dashboard"
        className="glass-card flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-foreground shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:shadow-glow"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour au dashboard
      </Link>
    </div>
  );
}

const HIGHLIGHTS_STORAGE_PREFIX = "medart_highlights_";

/**
 * SECURITY FIX: previously keyed ONLY by course slug, with no user
 * component — the real record (course_highlights, scoped by user_id
 * server-side via /api/highlights) is correct, but this localStorage
 * mirror is a pure "fallback if the API call fails" cache, and since a
 * public course's slug (e.g. "pleuresie") is identical for EVERY student
 * who reads it, on a shared/lab computer a stale cached copy of Student
 * A's own highlighted text could surface for Student B the next time
 * that API call happens to fail for them. Found during the same security
 * audit that caught the identical pattern in InteractiveQuiz.tsx,
 * ActiveFlashcardsDeck.tsx, and the Workspace module page. Now namespaced
 * by userId (resolved client-side before this cache is ever touched).
 */
function highlightsStorageKey(userId: string, slug: string): string {
  return `${HIGHLIGHTS_STORAGE_PREFIX}${userId}_${slug}`;
}

/** Removes every OTHER highlights cache entry in this browser's storage — the old unscoped key format, and any DIFFERENT user's own scoped entries left behind on a shared device. Safe: purely a fallback cache, the real record lives server-side. */
function purgeForeignHighlights(currentKey: string): void {
  try {
    for (const existingKey of Object.keys(localStorage)) {
      if (existingKey.startsWith(HIGHLIGHTS_STORAGE_PREFIX) && existingKey !== currentKey) {
        localStorage.removeItem(existingKey);
      }
    }
  } catch {
    // Storage unavailable — nothing to clean up either way.
  }
}

function LoadingScreen() {
  return (
    <div className="aurora-canvas-bg flex h-dvh w-full items-center justify-center">
      <BrandLoader />
    </div>
  );
}

function CourseSlugWorkspace({ slug }: { slug: string }) {
  const { toast } = useToast();

  const legacySlugData = isCourseSlug(slug) ? COURSE_SLUG_CONTENT[slug] : undefined;
  const [supabaseData, setSupabaseData] = useState<CourseSlugSupabaseData | null | undefined>(undefined);

  const currentSlugRef = useRef(slug);
  useEffect(() => {
    currentSlugRef.current = slug;
  }, [slug]);

  // جلب محتوى الدرس + جلب الهايلايتس المخزنة من الـ API وتطبيقها فوراً
  useEffect(() => {
    let cancelled = false;
    setSupabaseData(undefined);

    // 1. جلب محتوى الدرس
    fetch(`/api/courses/slug/${slug}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: CourseSlugSupabaseData) => {
        if (!cancelled) setSupabaseData(data);
      })
      .catch(() => {
        if (!cancelled) setSupabaseData(null);
      });

    // 2. جلب الهايلايتس من الـ API وتطبيقها أوتوماتيكياً على الصفحة
    // Resolved client-side first — never touch the localStorage fallback
    // cache before knowing WHOSE slot it is (see highlightsStorageKey's own
    // comment).
    void createClient()
      .auth.getUser()
      .then(({ data: userData }) => {
        if (cancelled || !userData.user) return;
        const highlightsKey = highlightsStorageKey(userData.user.id, slug);
        purgeForeignHighlights(highlightsKey);

        fetch(`/api/highlights?slug=${slug}`)
          .then((res) => (res.ok ? res.json() : Promise.reject()))
          .then((data) => {
            if (!cancelled && data?.highlights) {
              const texts = data.highlights.map((h: { selected_text: string }) => h.selected_text);
              // تخزينهم أيضاً محلياً كاحتياط لسرعة العرض
              localStorage.setItem(highlightsKey, JSON.stringify(texts));

              // تطبيق الهايلايتس بصرياً بعد اكتمال تحميل عناصر الـ DOM
              setTimeout(() => {
                texts.forEach((textToHighlight: string) => {
                  if (!textToHighlight) return;
                  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                  let node;
                  while ((node = walker.nextNode())) {
                    const pos = node.nodeValue?.indexOf(textToHighlight);
                    if (pos !== undefined && pos >= 0 && node.parentElement?.tagName !== "MARK") {
                      const range = document.createRange();
                      range.setStart(node, pos);
                      range.setEnd(node, pos + textToHighlight.length);

                      const mark = document.createElement("mark");
                      mark.className = "rounded px-1 bg-yellow-300 dark:bg-yellow-500/40 text-inherit";
                      try {
                        range.surroundContents(mark);
                        break;
                      } catch {
                        // تجاوز الحدود المتداخلة لتفادي الأخطاء
                      }
                    }
                  }
                });
              }, 800);
            }
          })
          .catch(() => {
            // في حال فشل الـ API، نحاول جلبهم من LocalStorage مباشرة
            const saved = JSON.parse(localStorage.getItem(highlightsKey) || "[]");
            if (saved.length > 0) {
              setTimeout(() => {
                saved.forEach((textToHighlight: string) => {
                  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                  let node;
                  while ((node = walker.nextNode())) {
                    const pos = node.nodeValue?.indexOf(textToHighlight);
                    if (pos !== undefined && pos >= 0 && node.parentElement?.tagName !== "MARK") {
                      const range = document.createRange();
                      range.setStart(node, pos);
                      range.setEnd(node, pos + textToHighlight.length);
                      const mark = document.createElement("mark");
                      mark.className = "rounded px-1 bg-yellow-300 dark:bg-yellow-500/40 text-inherit";
                      try {
                        range.surroundContents(mark);
                        break;
                      } catch {}
                    }
                  }
                });
              }, 800);
            }
          });
      })
      .catch(() => {
        // Impossible to resolve the current user — nothing to fall back to,
        // just skip the highlights restore entirely for this load.
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
  const today = new Date().toLocaleDateString("fr-FR");
  const activeSection = sections.find((s) => s.id === activeId) ?? sections[0];

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [sourceSelected, setSourceSelected] = useState(true);
  const sourceCount = sourceSelected ? 1 : 0;

  const { chatMessages, chatInput, setChatInput, isTyping, sendChatMessage, clearMessages } = useCourseChat(slug);
  const chatPanelRef = useRef<ChatDocumentPanelHandle>(null);

  const [isSplitScreen, setIsSplitScreen] = useState(false);
  const [splitScreenView, setSplitScreenView] = useState<"studio" | "source">("studio");
  const [pendingThinkingLabel, setPendingThinkingLabel] = useState<string | null>(null);
  const [quotedText, setQuotedText] = useState<string | null>(null);

  function handleAskSelection(text: string) {
    setPendingThinkingLabel(null);
    setIsSplitScreen(true);
    setQuotedText(text);
    chatPanelRef.current?.focusInput();
  }

  function handleTranslateSelection(text: string) {
    setPendingThinkingLabel(null);
    setIsSplitScreen(true);
    sendChatMessage(buildDemoTranslatePrompt(text), {
      translate: true,
      excludeFromHistory: true,
      selectedText: text,
    });
  }

  const [openedSection, setOpenedSection] = useState<DemoSectionId | null>(null);
  // Set, not a single DemoSectionId — matches the same relaxation applied to
  // app/dashboard/module/[id]/page.tsx: a different tile already generating
  // no longer blocks a new one from starting (StudioPanel's shared prop
  // contract now expects a Set either way).
  const [generatingSections, setGeneratingSections] = useState<Set<DemoSectionId>>(() => new Set());

  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);

  async function handleSaveNote() {
    const content = noteContent.trim();
    if (!content) return;

    setIsSavingNote(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || "Cours", content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "L'enregistrement de la note a échoué.");

      setIsNoteOpen(false);
      setNoteContent("");
      toast({ variant: "success", title: "Note enregistrée", description: "Retrouve-la dans « Mes notes »." });
    } catch (error) {
      toast({
        variant: "error",
        title: "Échec de l'enregistrement",
        description: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setIsSavingNote(false);
    }
  }

  function handleSectionGenerated<K extends keyof CourseSlugSupabaseData>(
    forSlug: string,
    dataKey: K,
    data: CourseSlugSupabaseData[K]
  ) {
    if (currentSlugRef.current !== forSlug) return;
    setSupabaseData((prev) => (prev ? { ...prev, [dataKey]: data } : prev));
  }

  function getSectionStatus(id: DemoSectionId): SectionStatus {
    if (!hasStudioData) return "available";
    if (id === "explication") {
      if (legacySlugData) return "available";
      return supabaseData?.explication != null ? "available" : "needs_generation";
    }
    if (id === "resume" && legacySlugData?.resume) return "available";
    if (id === "cas_clinique" && legacySlugData?.casClinique) return "available";
    if (id === "qcm" && legacySlugData?.qcm) return "available";

    const dataKey = SECTION_LAZY_CONFIG[id]?.dataKey;
    if (!dataKey) return "available";
    return supabaseData?.[dataKey] != null ? "available" : "needs_generation";
  }

  async function generateSection(id: DemoSectionId) {
    const config = SECTION_LAZY_CONFIG[id];
    if (!config) return;

    const requestSlug = slug;
    setGeneratingSections((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: requestSlug }),
      });
      const body = await res.json().catch(() => ({}));
      if (currentSlugRef.current !== requestSlug) return;
      if (res.ok && body?.success) {
        handleSectionGenerated(requestSlug, config.dataKey, body.data);
      } else {
        toast({ variant: "error", title: "Échec de la génération", description: body?.error ?? "Réessaie." });
      }
    } catch {
      if (currentSlugRef.current !== requestSlug) return;
      toast({ variant: "error", title: "Échec de la génération", description: "Impossible de contacter le serveur." });
    } finally {
      if (currentSlugRef.current === requestSlug) {
        setGeneratingSections((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  }

  function handleToggleShowSource() {
    if (isSplitScreen && splitScreenView === "source") {
      setIsSplitScreen(false);
      return;
    }
    setSplitScreenView("source");
    setIsSplitScreen(true);
  }

  function handleStudioItemClick(id: DemoSectionId) {
    if (getSectionStatus(id) === "needs_generation") {
      if (!generatingSections.has(id)) generateSection(id);
      return;
    }
    setActiveId(id);
    setOpenedSection(id);
  }

  const customTabContent: string | undefined =
    activeId === "resume"
      ? legacySlugData?.resume
      : activeId === "cas_clinique"
        ? legacySlugData?.casClinique
        : activeId === "qcm"
          ? legacySlugData?.qcm
          : undefined;

  const showResumeStudioData = hasStudioData && activeId === "resume";
  const showCasCliniqueStudioData = hasStudioData && activeId === "cas_clinique";
  const showQcmsStudioData = hasStudioData && activeId === "qcm";

  if (!legacySlugData && supabaseData === null) {
    return <NotFoundScreen slug={slug} />;
  }

  if (!legacySlugData && supabaseData === undefined) {
    return <LoadingScreen />;
  }

  const openedSectionContent = showResumeStudioData ? (
    <LazySection
      dark={isDark}
      data={supabaseData?.resume}
      label={SECTION_LAZY_CONFIG.resume!.label}
      endpoint={SECTION_LAZY_CONFIG.resume!.endpoint}
      slug={slug}
      onGenerated={(data) => handleSectionGenerated(slug, "resume", data)}
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
      onGenerated={(data) => handleSectionGenerated(slug, "cas_clinique", data)}
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
      onGenerated={(data) => handleSectionGenerated(slug, "qcms", data)}
    >
      {(data) => <GastriteQcmsStudio data={data} courseSlug={slug} explicationMarkdown={explicationContent} />}
    </LazySection>
  ) : customTabContent ? (
    <article className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "animate-fade-in")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}>
        {normalizeCallouts(customTabContent)}
      </ReactMarkdown>
    </article>
  ) : activeId === "resume" ? (
    <ResumeStudio />
  ) : activeId === "cas_clinique" ? (
    <CasCliniqueStudio />
  ) : activeId === "qcm" ? (
    <ExamQcmStudio explicationMarkdown={explicationContent} />
  ) : activeId === "explication" && hasStudioData && !legacySlugData ? (
    <LazySection
      dark={isDark}
      data={supabaseData?.explication}
      label={SECTION_LAZY_CONFIG.explication!.label}
      endpoint={SECTION_LAZY_CONFIG.explication!.endpoint}
      slug={slug}
      onGenerated={(data) => handleSectionGenerated(slug, "explication", data)}
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
  ) : activeId === "exemples_analogies" && hasStudioData ? (
    <LazySection
      dark={isDark}
      data={supabaseData?.exemples_analogies}
      label={SECTION_LAZY_CONFIG.exemples_analogies!.label}
      endpoint={SECTION_LAZY_CONFIG.exemples_analogies!.endpoint}
      slug={slug}
      onGenerated={(data) => handleSectionGenerated(slug, "exemples_analogies", data)}
    >
      {(content) => (
        <article dir="auto" className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "animate-fade-in")}>
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
    <article className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "animate-fade-in")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}>
        {normalizeCallouts(activeSection.content)}
      </ReactMarkdown>
    </article>
  );

  const chatPanel = (
    <ChatDocumentPanel
      ref={chatPanelRef}
      title={title || "Cours"}
      dateLabel={today}
      sourceCount={sourceCount}
      messages={chatMessages}
      isTyping={isTyping}
      input={chatInput}
      onInputChange={setChatInput}
      onSend={() => {
        const text = chatInput.trim();
        if (!text && !quotedText) return;
        const isAskMedArt = quotedText !== null;
        const fullMessage = buildQuotedChatMessage(quotedText, text);
        setChatInput("");
        setQuotedText(null);
        setPendingThinkingLabel(null);
        sendChatMessage(fullMessage, {
          concise: isAskMedArt,
          excludeFromHistory: isAskMedArt,
          selectedText: quotedText ?? undefined,
        });
      }}
      onClearHistory={clearMessages}
      onAskSelection={handleAskSelection}
      onTranslateSelection={handleTranslateSelection}
      pendingThinkingLabel={pendingThinkingLabel}
      isSplitScreen={isSplitScreen}
      onToggleSplitScreen={() =>
        setIsSplitScreen((prev) => {
          const next = !prev;
          if (next) setSplitScreenView("studio");
          return next;
        })
      }
      dark={isDark}
      quotedText={quotedText}
      onClearQuote={() => setQuotedText(null)}
      courseTitle={title || "Cours"}
      courseSlug={slug}
    />
  );

  const sourceDocumentPanel = (
    <SourceDocumentPanel title={title || "Cours"} rawText={explicationContent} onClose={() => setIsSplitScreen(false)} />
  );

  const studioPanel = (
    <StudioPanel
      sections={sections}
      openedSection={openedSection}
      openedLabel={activeSection.label}
      onItemClick={handleStudioItemClick}
      onCloseSection={() => setOpenedSection(null)}
      getSectionStatus={getSectionStatus}
      generatingSections={generatingSections}
      // Legacy pipeline (no Regénérer, no per-course updated_at) — no real
      // generation timestamp exists here, so RelativeTime is simply given
      // null and renders nothing rather than fabricating one.
      lastGeneratedAt={null}
      isNoteOpen={isNoteOpen}
      onOpenNote={() => setIsNoteOpen(true)}
      onBackFromNote={() => setIsNoteOpen(false)}
      onDeleteNote={() => {
        setIsNoteOpen(false);
        setNoteContent("");
      }}
      noteContent={noteContent}
      onNoteContentChange={setNoteContent}
      onSaveNote={handleSaveNote}
      isSavingNote={isSavingNote}
      onAskSelection={handleAskSelection}
      onTranslateSelection={handleTranslateSelection}
      courseSlug={slug}
    >
      {openedSectionContent}
    </StudioPanel>
  );

  const panelShellClasses = "glass-card flex flex-col overflow-hidden rounded-3xl shadow-glass transition-all duration-300 dark:shadow-glass-dark";

  return (
    <div className="aurora-canvas-bg relative flex h-dvh flex-col overflow-hidden">
      <div aria-hidden className="aurora-mesh-bg animate-mesh-pulse pointer-events-none fixed inset-0 -z-10" />
      <WorkspaceTopbar title={title} />

      <PomodoroStudyBanner />

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:flex-row md:overflow-hidden">
        {!isSplitScreen && (
          <aside className={cn(panelShellClasses, "h-[70vh] w-full shrink-0 md:h-auto md:w-72")}>
            <SourcesPanel
              sourceFileName={sourceFileName}
              sourceSize={sourceSize}
              dateLabel={today}
              selected={sourceSelected}
              onToggleSelected={setSourceSelected}
              courseTitle={title || "Cours"}
              courseSlug={slug}
              isSplitScreen={isSplitScreen}
              onToggleSplitScreen={handleToggleShowSource}
              onClosePanel={() => setIsSplitScreen(true)}
            />
          </aside>
        )}

        <div
          className={cn(
            "grid h-[70vh] w-full shrink-0 gap-4 overflow-hidden transition-all duration-300 md:h-auto md:w-auto md:flex-1",
            isSplitScreen ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
          )}
        >
          <main className={panelShellClasses}>{chatPanel}</main>
          {isSplitScreen && <aside className={panelShellClasses}>{splitScreenView === "source" ? sourceDocumentPanel : studioPanel}</aside>}
        </div>

        {!isSplitScreen && (
          <aside className={cn(panelShellClasses, "h-[70vh] w-full shrink-0 md:h-auto md:w-96")}>{studioPanel}</aside>
        )}
      </div>
    </div>
  );
}