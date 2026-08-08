"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Loader2 } from "lucide-react";
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
import { useCourseChat } from "@/hooks/useCourseChat";
import { useToast } from "@/components/ui/Toast";
import { WorkspaceTopbar } from "@/components/course/workspace/WorkspaceTopbar";
import { SourcesPanel } from "@/components/course/workspace/SourcesPanel";
import { ChatDocumentPanel, type ChatDocumentPanelHandle } from "@/components/course/workspace/ChatDocumentPanel";
import { StudioPanel, type SectionStatus } from "@/components/course/workspace/StudioPanel";
import { ResumeStudio } from "@/components/course/workspace/ResumeStudio";
import { CasCliniqueStudio } from "@/components/course/workspace/CasCliniqueStudio";
import { ExamQcmStudio } from "@/components/course/workspace/ExamQcmStudio";
import { GastriteResumeStudio } from "@/components/course/workspace/GastriteResumeStudio";
import { GastriteCasCliniqueStudio } from "@/components/course/workspace/GastriteCasCliniqueStudio";
import { GastriteQcmsStudio } from "@/components/course/workspace/GastriteQcmsStudio";
import { MindMapStudio } from "@/components/course/workspace/MindMapStudio";
import { LazySection } from "@/components/course/workspace/LazySection";

export default function CourseSlugWorkspacePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  return <CourseSlugWorkspace slug={slug} />;
}

/**
 * Maps each Studio tile to the `CourseSlugSupabaseData` field it reads/writes,
 * the modular generation route that fills it, and the label used in the
 * LazySection empty-state button — one config drives the whole lazy-loading
 * UX for all tiles.
 */
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
  // No "mind_map" entry: the Mind Map is now a fully static, hardcoded
  // component (MindMapStudio) — nothing to generate, no endpoint to call.
  // (One now-orphaned, still-functional route remains from an earlier
  // iteration — app/api/generate/mind-map/route.ts, the original
  // {nodes,links}-graph pipeline — kept but disconnected. Its sibling,
  // app/api/generate-mindmap/route.ts — the OpenRouter+Ideogram image
  // pipeline behind three failed attempts at generating this exact poster —
  // was deleted outright: that approach is permanently abandoned, not
  // paused, so keeping the route around only invited someone to try a
  // fourth time.)
};

/**
 * MindMapStudio is a single hardcoded poster for ONE course (Pleurésie) —
 * not a generic per-course renderer. Gating it by exact slug, rather than
 * just `hasStudioData`, is what stops every other Supabase-backed course
 * (gastrite, ulcère, BPCO, HTIC, ...) from showing this unrelated poster
 * under its own title.
 */
const PLEURESIE_SLUG = "3-la-pleuresie-purulente-support-du-dr-firan-1785259421242";

function NotFoundScreen({ slug }: { slug: string }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-gray-100 text-center dark:bg-neutral-950">
      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">Cours introuvable</p>
      <p className="max-w-sm text-sm text-gray-500 dark:text-gray-400">
        Aucun contenu n'est disponible pour « {slug} » pour le moment.
      </p>
      <Link
        href="/dashboard"
        className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-gray-300 dark:hover:bg-neutral-800"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour au dashboard
      </Link>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-100 dark:bg-neutral-950">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
    </div>
  );
}

function CourseSlugWorkspace({ slug }: { slug: string }) {
  const { toast } = useToast();

  // Slugs with content hardcoded ahead of time (appendicite, gastrite, ulcere,
  // rectocolite) — their explication tab and Sources card keep using this
  // static content exactly as before, even once a Supabase row also exists.
  const legacySlugData = isCourseSlug(slug) ? COURSE_SLUG_CONTENT[slug] : undefined;

  // Any course row saved in Supabase's `courses` table, looked up by slug.
  // Brand-new courses (no legacy entry) render entirely from this; gastrite
  // keeps its legacy explication but still gets its Studio tiles from here.
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
  const today = new Date().toLocaleDateString("fr-FR");
  const activeSection = sections.find((s) => s.id === activeId) ?? sections[0];

  // Single source of dark/light truth for the whole workspace — the app's
  // ThemeProvider default is "light" (app/layout.tsx); this just resolves it
  // so the Studio content components (which take a `dark` boolean, not
  // Tailwind `dark:` variants) stay in sync with it instead of keeping their
  // own disconnected local toggle.
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Cosmetic for now (this app has exactly one source per course) — reflects
  // into the Chat panel's and Studio list's "N source(s)" labels so they
  // aren't hardcoded lies.
  const [sourceSelected, setSourceSelected] = useState(true);
  const sourceCount = sourceSelected ? 1 : 0;

  const { chatMessages, chatInput, setChatInput, isTyping, sendChatMessage, clearMessages } = useCourseChat(slug);
  const chatPanelRef = useRef<ChatDocumentPanelHandle>(null);

  // Split-screen: Chat + Studio share a balanced 50/50 grid (Sources hidden)
  // instead of the default 3-column layout — auto-triggered by a contextual
  // action (Ask MedArt, Translate) and otherwise toggleable by hand from the
  // Chat header. The Mind Map no longer triggers this: it's now a
  // pan/zoom image viewer (MindMapStudio) with no clickable nodes.
  const [isSplitScreen, setIsSplitScreen] = useState(false);
  // Names whatever contextual action is currently awaiting its reply, so the
  // Chat's typing indicator can say "Thinking about X..." instead of a
  // generic message — cleared by every OTHER way of sending a message so a
  // stale label never lingers on an unrelated exchange.
  const [pendingThinkingLabel, setPendingThinkingLabel] = useState<string | null>(null);

  /** "Ask MedArt" on a text selection — populates the chat input and focuses it, but doesn't send (student reviews/edits first, per spec). */
  function handleAskSelection(text: string) {
    setPendingThinkingLabel(null);
    setIsSplitScreen(true);
    setChatInput(buildDemoAskPrompt(text));
    chatPanelRef.current?.focusInput();
  }

  /** "Translate" on a text selection — sends immediately through the real chat pipeline (a translation is a quick lookup, not something worth reviewing first). */
  function handleTranslateSelection(text: string) {
    setPendingThinkingLabel(null);
    setIsSplitScreen(true);
    sendChatMessage(buildDemoTranslatePrompt(text));
  }

  // Studio panel: null = "browse" view (tile grid + generations list); set =
  // "detail" view, showing that section's content (reusing the exact same
  // render logic that used to live directly in the tab-content switch below).
  const [openedSection, setOpenedSection] = useState<DemoSectionId | null>(null);
  // Which section is being generated via a direct tile click (as opposed to
  // opening it and using LazySection's own "Générer" button) — drives the
  // "Generating ... based on N source(s)" row in the Studio list.
  const [generatingSection, setGeneratingSection] = useState<DemoSectionId | null>(null);

  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [noteContent, setNoteContent] = useState("");

  // Lazy loading: a freshly-uploaded course's row has every content column
  // (resume/cas_clinique/qcms/explication) set to null. Each is
  // generated on demand — the student clicks a Studio tile (handled by
  // <LazySection> once opened, or generateSection() below directly from the
  // tile grid) rather than all being generated at once at upload time (that
  // single mega-call routinely got truncated on larger source documents).
  function handleSectionGenerated<K extends keyof CourseSlugSupabaseData>(dataKey: K, data: CourseSlugSupabaseData[K]) {
    setSupabaseData((prev) => (prev ? { ...prev, [dataKey]: data } : prev));
  }

  /** Whether a Studio tile already has real content to show, or still needs generating. */
  function getSectionStatus(id: DemoSectionId): SectionStatus {
    if (id === "mind_map") return "available"; // fully static/hardcoded — nothing to generate, ever
    if (!hasStudioData) return "available"; // legacy-only slug: fixed components/customTabContent, nothing to generate
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

  /** Same POST-then-save flow as LazySection's own button, triggered directly from a Studio tile so the grid can show a live "Generating..." row without first opening the section. */
  async function generateSection(id: DemoSectionId) {
    const config = SECTION_LAZY_CONFIG[id];
    if (!config) return;

    setGeneratingSection(id);
    try {
      const res = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.success) {
        handleSectionGenerated(config.dataKey, body.data);
      } else {
        toast({ variant: "error", title: "Échec de la génération", description: body?.error ?? "Réessaie." });
      }
    } catch {
      toast({ variant: "error", title: "Échec de la génération", description: "Impossible de contacter le serveur." });
    } finally {
      setGeneratingSection(null);
    }
  }

  function handleStudioItemClick(id: DemoSectionId) {
    if (getSectionStatus(id) === "needs_generation") {
      if (!generatingSection) generateSection(id);
      return;
    }
    setActiveId(id);
    setOpenedSection(id);
  }

  // Slugs with fully authored per-tab markdown (legacy gastrite fallback)
  // render that here instead of the fixed appendicite-specific interactive
  // components (ResumeStudio, CasCliniqueStudio, ExamQcmStudio).
  const customTabContent: string | undefined =
    activeId === "resume"
      ? legacySlugData?.resume
      : activeId === "cas_clinique"
        ? legacySlugData?.casClinique
        : activeId === "qcm"
          ? legacySlugData?.qcm
          : undefined;

  // Any slug with a Supabase-backed row gets the interactive Résumé, Cas
  // Clinique and QCM Studio components, fed by that row's data — this is
  // what makes a brand-new course fully navigable the moment its row exists
  // in `courses`, with zero code change per course.
  const showResumeStudioData = hasStudioData && activeId === "resume";
  const showCasCliniqueStudioData = hasStudioData && activeId === "cas_clinique";
  const showQcmsStudioData = hasStudioData && activeId === "qcm";
  const showMindMapStudioData = hasStudioData && activeId === "mind_map" && slug === PLEURESIE_SLUG;
  const showMindMapUnavailable = activeId === "mind_map" && !showMindMapStudioData;

  // No legacy content, and Supabase confirmed there's no row for this slug either.
  if (!legacySlugData && supabaseData === null) {
    return <NotFoundScreen slug={slug} />;
  }

  // No legacy content to show immediately, and we don't know yet whether
  // Supabase has a row — avoid a "Cours introuvable" flash while it loads.
  if (!legacySlugData && supabaseData === undefined) {
    return <LoadingScreen />;
  }

  // The currently-opened Studio section's content — unchanged from the
  // original tab-content switch, just rendered inside <StudioPanel>'s
  // "detail" view instead of directly in the aside.
  const openedSectionContent = showResumeStudioData ? (
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
      {(data) => <GastriteQcmsStudio data={data} courseSlug={slug} explicationMarkdown={explicationContent} />}
    </LazySection>
  ) : showMindMapStudioData ? (
    <MindMapStudio />
  ) : showMindMapUnavailable ? (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-20 text-center">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Mind Map — bientôt disponible pour ce cours</p>
      <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">
        Cette carte mentale visuelle n'existe pour l'instant que pour un cours pilote (Pleurésie). Elle arrivera pour les autres cours une fois la version générique prête.
      </p>
    </div>
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
  ) : activeId === "exemples_analogies" && hasStudioData ? (
    <LazySection
      dark={isDark}
      data={supabaseData?.exemples_analogies}
      label={SECTION_LAZY_CONFIG.exemples_analogies!.label}
      endpoint={SECTION_LAZY_CONFIG.exemples_analogies!.endpoint}
      slug={slug}
      onGenerated={(data) => handleSectionGenerated("exemples_analogies", data)}
    >
      {(content) => (
        // dir="auto" — this content is predominantly Darija (Arabic script,
        // RTL) with French medical terms inline (LTR); letting the browser
        // pick direction from the first strong-direction character renders
        // correctly instead of forcing the whole block LTR like every other
        // (French) Studio section.
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
        if (!text) return;
        setChatInput("");
        setPendingThinkingLabel(null);
        sendChatMessage(text);
      }}
      onClearHistory={clearMessages}
      onAskSelection={handleAskSelection}
      onTranslateSelection={handleTranslateSelection}
      pendingThinkingLabel={pendingThinkingLabel}
      isSplitScreen={isSplitScreen}
      onToggleSplitScreen={() => setIsSplitScreen((v) => !v)}
      dark={isDark}
    />
  );

  const studioPanel = (
    <StudioPanel
      sections={sections}
      openedSection={openedSection}
      openedLabel={activeSection.label}
      onItemClick={handleStudioItemClick}
      onCloseSection={() => setOpenedSection(null)}
      getSectionStatus={getSectionStatus}
      generatingSection={generatingSection}
      sourceCount={sourceCount}
      isNoteOpen={isNoteOpen}
      onOpenNote={() => setIsNoteOpen(true)}
      onBackFromNote={() => setIsNoteOpen(false)}
      onDeleteNote={() => {
        setIsNoteOpen(false);
        setNoteContent("");
      }}
      noteContent={noteContent}
      onNoteContentChange={setNoteContent}
      onAskSelection={handleAskSelection}
      onTranslateSelection={handleTranslateSelection}
    >
      {openedSectionContent}
    </StudioPanel>
  );

  const panelShellClasses =
    "flex flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm transition-all duration-300 dark:border-neutral-800 dark:bg-neutral-900";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-100 dark:bg-neutral-950">
      <WorkspaceTopbar title={title} />

      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        {/* Panneau Gauche — Sources (masqué en écran partagé pour laisser Chat/Studio respirer à 50/50) */}
        {!isSplitScreen && (
          <aside className={cn(panelShellClasses, "w-72 shrink-0")}>
            <SourcesPanel
              sourceFileName={sourceFileName}
              sourceSize={sourceSize}
              dateLabel={today}
              selected={sourceSelected}
              onToggleSelected={setSourceSelected}
            />
          </aside>
        )}

        {/* Panneau Central — Chat, seul ou en grille 50/50 avec Studio en écran partagé */}
        <div
          className={cn(
            "grid flex-1 gap-4 overflow-hidden transition-all duration-300",
            isSplitScreen ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
          )}
        >
          <main className={panelShellClasses}>{chatPanel}</main>
          {isSplitScreen && <aside className={panelShellClasses}>{studioPanel}</aside>}
        </div>

        {/* Panneau Droit — Studio (disposition par défaut uniquement ; en écran partagé il vit dans la grille ci-dessus) */}
        {!isSplitScreen && <aside className={cn(panelShellClasses, "w-96 shrink-0")}>{studioPanel}</aside>}
      </div>
    </div>
  );
}
