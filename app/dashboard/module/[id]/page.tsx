"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, FileText, Loader2, PanelLeftClose, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { WorkspaceTopbar } from "@/components/course/workspace/WorkspaceTopbar";
import { ChatDocumentPanel, type ChatDocumentPanelHandle } from "@/components/course/workspace/ChatDocumentPanel";
import { StudioPanel, type SectionStatus } from "@/components/course/workspace/StudioPanel";
import { GastriteResumeStudio } from "@/components/course/workspace/GastriteResumeStudio";
import { GastriteCasCliniqueStudio } from "@/components/course/workspace/GastriteCasCliniqueStudio";
import { GastriteQcmsStudio } from "@/components/course/workspace/GastriteQcmsStudio";
import { DynamicMindMapStudio } from "@/components/course/workspace/DynamicMindMapStudio";
import { DARK_MARKDOWN_COMPONENTS, DARK_PROSE_CLASSES, MARKDOWN_COMPONENTS, PROSE_CLASSES, normalizeCallouts } from "@/lib/markdown";
import { DEMO_SECTIONS, type DemoSectionId } from "@/lib/demo-content";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage } from "@/lib/types";
import type { CurriculumModule } from "@/types/academic";
import type { StudioCourseFull, StudioCourseSummary } from "@/types/studio-course";

/**
 * Reads/writes one Studio tile's value on a StudioCourseFull — the single
 * place that maps DemoSectionId ("qcm") to the course object's own field
 * name ("qcms"), mirroring app/api/studio/courses/[id]/route.ts's
 * SECTION_TO_COLUMN so the two never drift apart silently.
 */
function getSectionValue(course: StudioCourseFull, section: DemoSectionId): unknown {
  switch (section) {
    case "explication":
      return course.explication;
    case "resume":
      return course.resume;
    case "cas_clinique":
      return course.casClinique;
    case "qcm":
      return course.qcms;
    case "mind_map":
      return course.mindMap;
    case "exemples_analogies":
      return course.exemplesAnalogies;
  }
}

function withSectionValue(course: StudioCourseFull, section: DemoSectionId, value: any): StudioCourseFull {
  switch (section) {
    case "explication":
      return { ...course, explication: value };
    case "resume":
      return { ...course, resume: value };
    case "cas_clinique":
      return { ...course, casClinique: value };
    case "qcm":
      return { ...course, qcms: value };
    case "mind_map":
      return { ...course, mindMap: value };
    case "exemples_analogies":
      return { ...course, exemplesAnalogies: value };
  }
}

/**
 * Generic workspace for ANY curriculum module — this is the landing page
 * every module card in <CurriculumView> pushes to (/dashboard/module/[id]),
 * with no exception for filière/année. Same NotebookLM-style 3-column shell
 * as app/dashboard/modules/anatomie/page.tsx (WorkspaceTopbar +
 * ChatDocumentPanel + StudioPanel) — UNCHANGED components; only this page's
 * own state/handlers are real now.
 *
 * Golden Standard Part 2 (Auto-Save + Multi-Cours): every uploaded course is
 * a real row in Supabase's `studio_courses` table (app/api/studio/courses/*),
 * not just in-memory state. Uploading a course creates a row; opening a
 * Studio tile generates + immediately PATCHes that section's content back to
 * its row; switching the active course in the sidebar loads whatever is
 * already saved instead of ever regenerating it. Each Studio tile is
 * rendered through the EXACT same luxurious components Pleurésie/Gastrite
 * use (GastriteResumeStudio, GastriteCasCliniqueStudio, GastriteQcmsStudio in
 * preview mode) for résumé/cas clinique/QCM, never a bespoke Markdown
 * renderer. Mind Map renders via DynamicMindMapStudio — a deterministic
 * Mermaid graph plus a real Ideogram illustration (generated server-side,
 * see app/api/studio/generate/route.ts) — see lib/ai/studio-prompts.ts's
 * header comment for the full Golden Standard hybrid rationale.
 */

function ModuleSourcesPanel({
  courses,
  activeCourseId,
  isUploading,
  isSwitchingCourse,
  onFileSelected,
  onSelectCourse,
}: {
  courses: StudioCourseSummary[];
  activeCourseId: number | null;
  isUploading: boolean;
  isSwitchingCourse: boolean;
  onFileSelected: (file: File) => void;
  onSelectCourse: (id: number) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onFileSelected(file);
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sources</h2>
        <button
          type="button"
          aria-label="Fermer le panneau"
          className="rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-gray-100"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col space-y-4 overflow-y-auto p-4">
        <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleChange} />
        {/* Always enabled — adding a 2nd, 3rd, ... course never disables this, per the multi-course mandate. */}
        <Button
          variant="outline"
          size="sm"
          className="w-full rounded-xl"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {isUploading ? "Extraction en cours..." : "Add sources"}
        </Button>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <Input
            placeholder="Search the web..."
            disabled
            className="border-none bg-gray-100 pl-9 shadow-none dark:bg-neutral-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>

        {courses.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-200 p-8 text-center dark:border-neutral-800">
            <FileText className="h-6 w-6 text-gray-300 dark:text-neutral-700" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Aucune source pour l'instant</p>
            <p className="text-xs text-gray-400 dark:text-neutral-600">
              Ajoute un cours pour commencer à discuter avec l'IA.
            </p>
          </div>
        ) : (
          // Oldest first (a new upload appears at the bottom of this list) — matches
          // /api/studio/courses' own ORDER BY created_at ascending.
          <div className="space-y-2">
            {courses.map((course) => {
              const isActive = course.id === activeCourseId;
              return (
                <button
                  key={course.id}
                  type="button"
                  onClick={() => onSelectCourse(course.id)}
                  disabled={isSwitchingCourse}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors disabled:cursor-wait",
                    isActive
                      ? "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
                      : "border-gray-200 bg-white hover:bg-gray-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                  )}
                >
                  <FileText className={cn("mt-0.5 h-4 w-4 shrink-0", isActive ? "text-blue-500" : "text-gray-400 dark:text-gray-500")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", isActive ? "text-blue-900 dark:text-blue-200" : "text-gray-900 dark:text-gray-100")}>
                      {course.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{isActive ? "Cours actif" : "Cliquer pour ouvrir"}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export default function ModuleWorkspacePage() {
  const params = useParams<{ id: string }>();
  const moduleId = Number(params.id);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { toast } = useToast();
  const supabase = useMemo(() => createClient(), []);

  const [module, setModule] = useState<CurriculumModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    fetch(`/api/curriculum/modules/${params.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("not found");
        const body = await res.json();
        return body.module as CurriculumModule;
      })
      .then((mod) => {
        if (!cancelled) setModule(mod);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const chatPanelRef = useRef<ChatDocumentPanelHandle>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isSplitScreen, setIsSplitScreen] = useState(false);

  const [openedSection, setOpenedSection] = useState<DemoSectionId | null>(null);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [noteContent, setNoteContent] = useState("");

  // Golden Standard Part 2: every course is a real Supabase row
  // (studio_courses, see app/api/studio/courses/*) — `courses` is the
  // lightweight sidebar list, `activeCourse` is the full row for whichever
  // one is currently open (fetched on demand, not all at once).
  const [courses, setCourses] = useState<StudioCourseSummary[]>([]);
  const [activeCourse, setActiveCourse] = useState<StudioCourseFull | null>(null);
  const [isSwitchingCourse, setIsSwitchingCourse] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [generatingSection, setGeneratingSection] = useState<DemoSectionId | null>(null);

  useEffect(() => {
    if (!Number.isFinite(moduleId)) return;
    let cancelled = false;

    fetch(`/api/studio/courses?moduleId=${moduleId}`)
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled && body.success) setCourses(body.courses);
      })
      .catch(() => {
        // A failed list load just means an empty sidebar to start — the student can still upload.
      });

    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  const today = new Date().toLocaleDateString("fr-FR");
  const openedSectionLabel = DEMO_SECTIONS.find((s) => s.id === openedSection)?.label ?? "";
  const moduleTitle = module?.title ?? "Module";

  function notYetAvailable(feature: string) {
    toast({ variant: "info", title: "Bientôt disponible", description: `${feature} arrive dans une prochaine mise à jour.` });
  }

  async function handleFileSelected(file: File) {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok || !uploadData.success) throw new Error(uploadData?.error ?? "L'extraction du PDF a échoué.");

      const createRes = await fetch("/api/studio/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleId, title: file.name, rawText: uploadData.text }),
      });
      const createData = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !createData.success) throw new Error(createData?.error ?? "La création du cours a échoué.");

      const created: StudioCourseSummary = createData.course;
      setCourses((prev) => [...prev, created]); // appended at the bottom — matches the sidebar's oldest-first order
      setActiveCourse({
        id: created.id,
        title: created.title,
        rawText: uploadData.text,
        explication: null,
        resume: null,
        casClinique: null,
        qcms: null,
        mindMap: null,
        exemplesAnalogies: null,
      });
      setOpenedSection(null);
      toast({ variant: "success", title: "Source ajoutée", description: `${file.name} a été importé et sauvegardé.` });
    } catch (error) {
      toast({
        variant: "error",
        title: "Échec de l'import",
        description: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setIsUploading(false);
    }
  }

  /**
   * Context switching: clears the detail pane immediately (the Studio must
   * show nothing from the previous course while the new one loads) and
   * loads whatever this course already has saved — instant if it was fully
   * generated before, since nothing here ever re-calls the AI for content
   * that already exists.
   */
  async function handleSelectCourse(courseId: number) {
    if (courseId === activeCourse?.id) return;

    setOpenedSection(null);
    setIsSwitchingCourse(true);
    try {
      const res = await fetch(`/api/studio/courses/${courseId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "Impossible de charger ce cours.");
      setActiveCourse(data.course);
    } catch (error) {
      toast({
        variant: "error",
        title: "Échec du chargement",
        description: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setIsSwitchingCourse(false);
    }
  }

  // Matches the Pleurésie "Golden Standard" flow exactly, using only
  // StudioPanel's existing, UNCHANGED contract (generatingSection +
  // getSectionStatus drive the list row; openedSection drives the detail
  // pane) — StudioPanel calls this same onItemClick for BOTH a grid tile and
  // a "recent generations" list row, so the three cases below are
  // distinguished purely by this page's own state, never by touching the
  // component:
  //  1. Not generated yet, nothing in flight -> start generating. Do NOT
  //     open the detail pane: StudioPanel already surfaces this as a
  //     spinning row in its own "recent generations" list purely because
  //     generatingSection === id, with no code needed here for that part.
  //  2. Already generated -> THIS click (on the now-ready list row, or on
  //     the grid tile again) is what opens the detail pane full-screen.
  //  3. Currently generating (a click on the spinning list row, or a second
  //     click before it resolves) -> ignored, nothing to open yet.
  async function handleStudioItemClick(id: DemoSectionId) {
    if (!activeCourse) {
      toast({
        variant: "info",
        title: "Ajoute une source",
        description: "Importe d'abord un PDF dans Sources pour générer ce contenu.",
      });
      return;
    }

    if (getSectionValue(activeCourse, id)) {
      setOpenedSection(id);
      return;
    }

    if (generatingSection) return; // ignore: this id's own spinner, or a different tile already in flight

    const courseId = activeCourse.id;
    const rawText = activeCourse.rawText;

    setGeneratingSection(id);
    try {
      const { res, data } = await postStudioGenerate(id, rawText);
      if (!res.ok || !data.success) throw new Error(data?.error ?? "La génération a échoué.");

      // Persist immediately — this is the Auto-Save: a refresh tomorrow reloads this straight from Supabase.
      const patchRes = await fetch(`/api/studio/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: id, data: data.data }),
      });
      if (!patchRes.ok) {
        toast({
          variant: "error",
          title: "Sauvegarde indisponible",
          description: "Le contenu s'affiche mais n'a pas pu être enregistré — il faudra le régénérer si tu quittes la page.",
        });
      }

      // Only apply if the student hasn't switched to a different course while this was generating.
      setActiveCourse((prev) => (prev && prev.id === courseId ? withSectionValue(prev, id, data.data) : prev));
    } catch (error) {
      toast({
        variant: "error",
        title: "Échec de la génération",
        description: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setGeneratingSection(null);
    }
  }

  /**
   * One attempt at /api/studio/generate — network errors (fetch() itself
   * throwing: dropped wifi, a router hiccup) are NOT caught here, they
   * propagate to the caller, which is what lets postStudioGenerate below
   * distinguish "the request never landed" from "it landed and the server
   * said no".
   */
  async function requestStudioGeneration(actionType: DemoSectionId, context: string) {
    const res = await fetch("/api/studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionType, documentContext: context }),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  /**
   * Wraps one generation call with two independent, silent recovery layers
   * — the student never sees an error banner for either unless BOTH the
   * original attempt and its one retry fail:
   *  1. A thrown network error (connection dropped mid-request, a brief
   *     wifi hiccup) gets one retry after a short pause — no toast, no
   *     visible interruption, just a slightly longer wait.
   *  2. A 401 doesn't necessarily mean the student is actually logged out —
   *     Supabase's refresh tokens are single-use, and a concurrent request
   *     elsewhere in the app can win the race to rotate the same cookie
   *     first (see lib/supabase/session-server.ts). Forcing this browser
   *     client to resolve the current session, then retrying once, recovers
   *     from that transient race instead of surfacing a false "you're
   *     logged out" error mid-generation.
   */
  async function postStudioGenerate(actionType: DemoSectionId, context: string) {
    let attempt: { res: Response; data: any };
    try {
      attempt = await requestStudioGeneration(actionType, context);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempt = await requestStudioGeneration(actionType, context);
    }

    if (attempt.res.status === 401) {
      await supabase.auth.getUser();
      attempt = await requestStudioGeneration(actionType, context);
    }

    return attempt;
  }

  function handleSend() {
    const text = chatInput.trim();
    if (!text || isTyping) return;

    setChatMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text }]);
    setChatInput("");
    setIsTyping(true);

    setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Le Chat IA pour le module ${moduleTitle} arrive bientôt — dès qu'un cours sera ajouté ici, je pourrai répondre à tes questions dessus.`,
        },
      ]);
      setIsTyping(false);
    }, 700);
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100 dark:bg-neutral-950">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (notFound || !module) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-gray-100 dark:bg-neutral-950">
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Ce module est introuvable.</p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-500"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour au Dashboard
        </Link>
      </div>
    );
  }

  const chatPanel = (
    <ChatDocumentPanel
      ref={chatPanelRef}
      title={moduleTitle}
      dateLabel={today}
      sourceCount={courses.length}
      messages={chatMessages}
      isTyping={isTyping}
      input={chatInput}
      onInputChange={setChatInput}
      onSend={handleSend}
      onClearHistory={() => setChatMessages([])}
      onAskSelection={() => notYetAvailable("La réponse sur un extrait sélectionné")}
      onTranslateSelection={() => notYetAvailable("La traduction d'un extrait sélectionné")}
      pendingThinkingLabel={null}
      isSplitScreen={isSplitScreen}
      onToggleSplitScreen={() => setIsSplitScreen((v) => !v)}
      dark={isDark}
    />
  );

  const studioPanel = (
    <StudioPanel
      sections={DEMO_SECTIONS}
      openedSection={openedSection}
      openedLabel={openedSectionLabel}
      onItemClick={handleStudioItemClick}
      onCloseSection={() => setOpenedSection(null)}
      getSectionStatus={(id): SectionStatus => (activeCourse && getSectionValue(activeCourse, id) ? "available" : "needs_generation")}
      generatingSection={generatingSection}
      sourceCount={courses.length}
      isNoteOpen={isNoteOpen}
      onOpenNote={() => setIsNoteOpen(true)}
      onBackFromNote={() => setIsNoteOpen(false)}
      onDeleteNote={() => {
        setIsNoteOpen(false);
        setNoteContent("");
      }}
      noteContent={noteContent}
      onNoteContentChange={setNoteContent}
      onAskSelection={() => notYetAvailable("La réponse sur un extrait sélectionné")}
      onTranslateSelection={() => notYetAvailable("La traduction d'un extrait sélectionné")}
    >
      {isSwitchingCourse ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 py-20">
          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Chargement du cours...</p>
        </div>
      ) : openedSection && generatingSection === openedSection ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 py-20">
          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Génération en cours...</p>
        </div>
      ) : openedSection && activeCourse && getSectionValue(activeCourse, openedSection) ? (
        <div className="animate-fade-in">
          {openedSection === "explication" && (
            <article dir="auto" className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "max-w-none")}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}>
                {normalizeCallouts(activeCourse.explication!)}
              </ReactMarkdown>
            </article>
          )}
          {openedSection === "exemples_analogies" && (
            <article dir="auto" className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "max-w-none")}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}>
                {normalizeCallouts(activeCourse.exemplesAnalogies!)}
              </ReactMarkdown>
            </article>
          )}
          {/*
            key={activeCourse.id} on every stateful tile below: without it,
            React sees "the same GastriteQcmsStudio instance" across a course
            switch (same position in the tree) and only re-renders it with
            new props — internal useState (InteractiveQuiz's qcmAnswers,
            GastriteResumeStudio's activeModeId, GastriteCasCliniqueStudio's
            activeIndex) SURVIVES the switch instead of resetting. Concretely:
            InteractiveQuiz numbers every course's QCMs 1, 2, 3... (same ids
            across different courses, by design), so without this key,
            answering Course A's QCM 1 then opening Course B's QCM tab would
            show Course B's (unrelated) question 1 as already
            answered/highlighted — real cross-course state bleed, not just a
            cosmetic glitch. The key forces a full unmount/remount on every
            course switch, so each course's tiles always start from a clean
            slate.
          */}
          {openedSection === "resume" && activeCourse.resume && (
            <GastriteResumeStudio
              key={activeCourse.id}
              data={{ slug: `studio-course-${activeCourse.id}`, section: "resume", ...activeCourse.resume }}
            />
          )}
          {openedSection === "cas_clinique" && activeCourse.casClinique && (
            <GastriteCasCliniqueStudio
              key={activeCourse.id}
              data={{ slug: `studio-course-${activeCourse.id}`, section: "cas_clinique", ...activeCourse.casClinique }}
            />
          )}
          {openedSection === "qcm" && activeCourse.qcms && (
            <GastriteQcmsStudio
              key={activeCourse.id}
              data={activeCourse.qcms}
              courseSlug={`studio-course-${activeCourse.id}`}
              explicationMarkdown={activeCourse.explication ?? undefined}
              isPreview
            />
          )}
          {openedSection === "mind_map" && activeCourse.mindMap && (
            <DynamicMindMapStudio key={activeCourse.id} data={activeCourse.mindMap} dark={isDark} title={activeCourse.title} />
          )}
        </div>
      ) : openedSection && !activeCourse ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 py-20 text-center">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Ajoute une source pour générer ce contenu</p>
          <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">
            Importe un PDF dans le panneau Sources à gauche, puis reclique sur « {openedSectionLabel} ».
          </p>
        </div>
      ) : null}
    </StudioPanel>
  );

  const panelShellClasses =
    "flex flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm transition-all duration-300 dark:border-neutral-800 dark:bg-neutral-900";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-100 dark:bg-neutral-950">
      <WorkspaceTopbar title={moduleTitle} />

      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        {!isSplitScreen && (
          <aside className={cn(panelShellClasses, "w-72 shrink-0")}>
            <ModuleSourcesPanel
              courses={courses}
              activeCourseId={activeCourse?.id ?? null}
              isUploading={isUploading}
              isSwitchingCourse={isSwitchingCourse}
              onFileSelected={handleFileSelected}
              onSelectCourse={handleSelectCourse}
            />
          </aside>
        )}

        <div
          className={cn(
            "grid flex-1 gap-4 overflow-hidden transition-all duration-300",
            isSplitScreen ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
          )}
        >
          <main className={panelShellClasses}>{chatPanel}</main>
          {isSplitScreen && <aside className={panelShellClasses}>{studioPanel}</aside>}
        </div>

        {!isSplitScreen && <aside className={cn(panelShellClasses, "w-96 shrink-0")}>{studioPanel}</aside>}
      </div>
    </div>
  );
}
