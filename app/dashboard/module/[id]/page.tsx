"use client";

import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Camera, Columns2, FileText, Loader2, MoreVertical, PanelLeftClose, Plus, Search, Trash2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildRateLimitMessage } from "@/lib/rate-limit-message";
import { useToast } from "@/components/ui/Toast";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { CourseStatsModal } from "@/components/dashboard/CourseStatsModal";
import { UploadModal } from "@/components/dashboard/UploadModal";
import { WorkspaceTopbar } from "@/components/course/workspace/WorkspaceTopbar";
import { ChatDocumentPanel, type ChatDocumentPanelHandle } from "@/components/course/workspace/ChatDocumentPanel";
import { StudioPanel, type SectionStatus } from "@/components/course/workspace/StudioPanel";
import { FileViewerModal } from "@/components/course/workspace/FileViewerModal";
import { StudioTileSkeleton } from "@/components/course/workspace/StudioTileSkeleton";
import { MobileWorkspaceTabBar, type MobileWorkspaceTab } from "@/components/course/workspace/MobileWorkspaceTabBar";
import { MobileStudioCards } from "@/components/course/workspace/MobileStudioCards";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useCourseChat } from "@/hooks/useCourseChat";
import { MAX_LEITNER_BOX } from "@/lib/srs";
import { DARK_MARKDOWN_COMPONENTS, DARK_PROSE_CLASSES, MARKDOWN_COMPONENTS, PROSE_CLASSES, normalizeCallouts } from "@/lib/markdown";
import { DEMO_SECTIONS, buildQuotedChatMessage, type DemoSectionId } from "@/lib/demo-content";
import { createClient } from "@/lib/supabase/client";
import type { CurriculumModule } from "@/types/academic";
import type { StudioCourseFull, StudioCourseSummary } from "@/types/studio-course";

/** A stable (module-scope, allocated once ever) no-op — passed to ModuleSourcesPanel's mobile variant, which never renders the close button `onClosePanel` guards, so its identity never needs to matter, but a literal `() => {}` written inline would still needlessly recreate on every render and defeat memo comparisons on props next to it. */
const NOOP = () => {};

/**
 * Each of these 3 is a genuinely heavy render tree (multi-mode tabs,
 * dozens of cards, a full interactive quiz engine) that most visits to this
 * page never even open — code-splitting them out of the initial bundle via
 * `next/dynamic` (rather than a static import) means their JS only downloads
 * the moment a student actually opens that specific Studio tile, with the
 * `<Suspense>` boundary around them (see the render below) showing
 * `StudioTileSkeleton` for that brief moment instead of blocking the click.
 * `ssr: false` is safe here — this whole page is already client-rendered
 * (useParams + client-only state), so there's no SSR output to lose.
 */
const GastriteResumeStudio = dynamic(
  () => import("@/components/course/workspace/GastriteResumeStudio").then((m) => m.GastriteResumeStudio),
  { ssr: false }
);
const GastriteCasCliniqueStudio = dynamic(
  () => import("@/components/course/workspace/GastriteCasCliniqueStudio").then((m) => m.GastriteCasCliniqueStudio),
  { ssr: false }
);
const GastriteQcmsStudio = dynamic(
  () => import("@/components/course/workspace/GastriteQcmsStudio").then((m) => m.GastriteQcmsStudio),
  { ssr: false }
);

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
    case "exemples_analogies":
      return { ...course, exemplesAnalogies: value };
  }
}

/**
 * Generic workspace for ANY curriculum module — this is the landing page
 * every module card in <CurriculumView> pushes to (/dashboard/module/[id]),
 * with no exception for filière/année. NotebookLM-style 3-column shell
 * (WorkspaceTopbar + ChatDocumentPanel + StudioPanel) — UNCHANGED shared
 * components; only this page's own state/handlers are real.
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
 * renderer.
 */

// React.memo — the caller (ModuleWorkspacePage below) passes every handler
// prop here as a useCallback-stabilized reference specifically so this skips
// re-rendering on unrelated state changes (a chat-input keystroke, a note
// being typed) instead of re-rendering the whole source list + its dropdown
// menus on every one of them.
const ModuleSourcesPanel = memo(function ModuleSourcesPanel({
  courses,
  activeCourseId,
  isSwitchingCourse,
  onSubmitFile,
  onSubmitText,
  onSelectCourse,
  onShowCourseFile,
  onDeleteCourse,
  onClosePanel,
  courseMasteryBySlug,
  variant = "desktop",
}: {
  courses: StudioCourseSummary[];
  activeCourseId: number | null;
  isSwitchingCourse: boolean;
  onSubmitFile: (file: File) => Promise<string>;
  onSubmitText: (text: string, title: string) => Promise<string>;
  onSelectCourse: (id: number) => void;
  onShowCourseFile: (id: number) => void;
  onDeleteCourse: (id: number) => Promise<void>;
  onClosePanel: () => void;
  /** Real qcm_attempts-derived mastery, keyed by `studio-course-{id}` — see the `course_mastery` SQL function, which groups purely by course_slug with no join to any courses table, so it already covers this pipeline's synthetic slugs once real attempts exist (they do now that GastriteQcmsStudio here is no longer rendered with isPreview). */
  courseMasteryBySlug: Map<string, { qcmSuccessPct: number; srsMasteryPct: number }>;
  /**
   * "mobile" (the NotebookLM-mobile Sources tab) drops the desktop-only
   * header/close-button and top "Add sources" button/search box — the bottom
   * tab bar already provides navigation, and the source-adding affordance
   * moves to a dedicated bottom action bar (camera icon + "+ Ajouter une
   * source" pill) per the mobile redesign spec. The course list itself
   * (with its full ⋮ menu — Afficher le cours/Statistiques/Supprimer) is
   * identical in both variants.
   */
  variant?: "desktop" | "mobile";
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [statsCourse, setStatsCourse] = useState<StudioCourseSummary | null>(null);
  const [deleteCourse, setDeleteCourse] = useState<StudioCourseSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [webSearchQuery, setWebSearchQuery] = useState("");

  function handleWebSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const query = webSearchQuery.trim();
    if (!query) return;
    window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
  }

  async function handleConfirmDelete() {
    if (!deleteCourse) return;
    setIsDeleting(true);
    try {
      await onDeleteCourse(deleteCourse.id);
      setDeleteCourse(null);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      {variant === "desktop" && (
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sources</h2>
          <button
            type="button"
            onClick={onClosePanel}
            aria-label="Fermer le panneau"
            className="rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-gray-100"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col space-y-4 overflow-y-auto p-4">
        {variant === "desktop" && (
          <>
            {/* Always enabled — adding a 2nd, 3rd, ... course never disables this, per the multi-course mandate. */}
            <Button variant="outline" size="sm" className="w-full rounded-xl" onClick={() => setUploadOpen(true)}>
              <Plus className="h-4 w-4" />
              Add sources
            </Button>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <Input
                placeholder="Search the web..."
                value={webSearchQuery}
                onChange={(e) => setWebSearchQuery(e.target.value)}
                onKeyDown={handleWebSearchKeyDown}
                className="border-none bg-gray-100 pl-9 shadow-none dark:bg-neutral-800 dark:text-gray-100 dark:placeholder:text-gray-500"
              />
            </div>
          </>
        )}

        {courses.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-200 p-8 text-center dark:border-neutral-800">
            <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
              <FileText className="h-6 w-6 text-gray-300 dark:text-neutral-700" />
            </motion.div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Aucun support n'a été ajouté à ce module</p>
            <p className="text-xs text-gray-400 dark:text-neutral-600">
              Ajoutez votre premier PDF ou texte pour commencer.
            </p>
          </div>
        ) : (
          // Oldest first (a new upload appears at the bottom of this list) — matches
          // /api/studio/courses' own ORDER BY created_at ascending.
          <div className="space-y-2">
            {courses.map((course) => {
              const isActive = course.id === activeCourseId;
              return (
                <div
                  key={course.id}
                  className={cn(
                    "flex items-start gap-2 rounded-2xl border p-3 transition-colors",
                    isActive
                      ? "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
                      : "border-gray-200 bg-white hover:bg-gray-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectCourse(course.id)}
                    disabled={isSwitchingCourse}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-wait"
                  >
                    <FileText className={cn("mt-0.5 h-4 w-4 shrink-0", isActive ? "text-blue-500" : "text-gray-400 dark:text-gray-500")} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm font-medium", isActive ? "text-blue-900 dark:text-blue-200" : "text-gray-900 dark:text-gray-100")}>
                        {course.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{isActive ? "Cours actif" : "Cliquer pour ouvrir"}</p>
                    </div>
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-neutral-800 dark:hover:text-gray-200"
                      aria-label="Options de la source"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onShowCourseFile(course.id)}>
                        <Columns2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        Afficher le cours
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setStatsCourse(course)}>
                        <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        Statistiques
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteCourse(course)}>
                        <Trash2 className="h-4 w-4" />
                        Supprimer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {variant === "mobile" && (
        <div className="flex shrink-0 items-center gap-2 border-t border-gray-200 p-4 dark:border-neutral-800">
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 rounded-full"
            aria-label="Scanner un document"
            onClick={() => setUploadOpen(true)}
          >
            <Camera className="h-4 w-4" />
          </Button>
          <Button className="flex-1 rounded-full" onClick={() => setUploadOpen(true)}>
            <Plus className="h-4 w-4" />
            Ajouter une source
          </Button>
        </div>
      )}

      <Dialog open={deleteCourse !== null} onOpenChange={(open) => !open && setDeleteCourse(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer ce cours ?</DialogTitle>
            <DialogDescription>
              « {deleteCourse?.title} » et tout son contenu généré (résumé, QCM, mind map...) seront supprimés définitivement.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteCourse(null)} disabled={isDeleting}>
              Annuler
            </Button>
            <Button type="button" variant="danger" onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Supprimer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CourseStatsModal
        open={statsCourse !== null}
        onOpenChange={(open) => !open && setStatsCourse(null)}
        courseTitle={statsCourse?.title ?? ""}
        courseSlug={statsCourse ? `studio-course-${statsCourse.id}` : ""}
        stats={{
          qcmSuccessPct: statsCourse ? courseMasteryBySlug.get(`studio-course-${statsCourse.id}`)?.qcmSuccessPct : undefined,
          srsMasteryPct: statsCourse ? courseMasteryBySlug.get(`studio-course-${statsCourse.id}`)?.srsMasteryPct : undefined,
          // No real per-user reading-progress tracking exists anywhere in the app yet — stays an honest "—", never fabricated.
          readingPct: undefined,
        }}
      />

      <UploadModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => {}}
        onSubmitFile={onSubmitFile}
        onSubmitText={onSubmitText}
        title="Ajouter une source"
        description="Importe un document ou colle du texte pour ce module."
      />
    </>
  );
});

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

  // NotebookLM-mobile redesign: below md, the 3-column desktop shell is
  // replaced entirely by a single-view-at-a-time tabbed layout (bottom nav —
  // see MobileWorkspaceTabBar). `useMediaQuery` (rather than pure CSS
  // `hidden md:flex`) picks ONE of the two branches to actually mount, so a
  // phone never pays the cost of a hidden desktop ChatDocumentPanel instance
  // sitting in the DOM (and vice versa on desktop).
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [mobileTab, setMobileTab] = useState<MobileWorkspaceTab>("chat");

  const chatPanelRef = useRef<ChatDocumentPanelHandle>(null);
  const [isSplitScreen, setIsSplitScreen] = useState(false);
  const [quotedText, setQuotedText] = useState<string | null>(null);
  // Which quick action staged `quotedText` — Ask MedArt and Translate share
  // the exact same "citation chip + review before sending" composer flow,
  // but need different server-side flags on actual send (concise vs.
  // translate, see handleSend below), so this is the one bit of state that
  // tells them apart. Cleared alongside quotedText everywhere it's cleared.
  const [quotedMode, setQuotedMode] = useState<"ask" | "translate" | null>(null);

  const [openedSection, setOpenedSection] = useState<DemoSectionId | null>(null);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);

  // Golden Standard Part 2: every course is a real Supabase row
  // (studio_courses, see app/api/studio/courses/*) — `courses` is the
  // lightweight sidebar list, `activeCourse` is the full row for whichever
  // one is currently open (fetched on demand, not all at once).
  const [courses, setCourses] = useState<StudioCourseSummary[]>([]);
  const [activeCourse, setActiveCourse] = useState<StudioCourseFull | null>(null);
  // Mirrors StudioPanel's own internal collapse toggle purely so this page's
  // fixed-width <aside> wrapper (which StudioPanel doesn't own) can shrink in
  // lockstep — see StudioPanel's onCollapsedChange doc comment.
  const [isStudioCollapsed, setIsStudioCollapsed] = useState(false);
  // Client-side cache of every full course row fetched this page visit,
  // keyed by id — switching back to a course you already opened is instant
  // (no network roundtrip), and every place that mutates `activeCourse`
  // (generate, regenerate, a fresh upload) mirrors its result in here too so
  // a later cache hit is never stale. A plain ref (not state) since writing
  // to it must never itself trigger a re-render — only `activeCourse` does.
  const courseCacheRef = useRef<Map<number, StudioCourseFull>>(new Map());
  const [isSwitchingCourse, setIsSwitchingCourse] = useState(false);
  const [generatingSection, setGeneratingSection] = useState<DemoSectionId | null>(null);
  const [regeneratingSection, setRegeneratingSection] = useState<DemoSectionId | null>(null);
  // "Afficher le cours" — a self-contained modal (FileViewerModal), decoupled
  // from the isSplitScreen/studioPanel system entirely, showing whichever
  // course's file was requested from the Sources list.
  const [fileViewerCourse, setFileViewerCourse] = useState<StudioCourseFull | null>(null);
  // Marks the state updates that swap in a heavy detail pane (a freshly
  // switched-to course, or a just-opened Studio tile rendering
  // GastriteQcmsStudio's 30+ interactive questions) as non-urgent, so React
  // keeps the click responsive and the CURRENT view visible/interactive
  // instead of the update blocking the main thread synchronously.
  const [, startNavTransition] = useTransition();

  // studio_courses has no matching row in the `courses` table the shared
  // chat endpoint normally looks slugs up against — this slug only ever
  // needs to be a stable, unique key for course_chat_history and the
  // semantic cache, so a synthetic one works fine. Course context itself is
  // sent inline via sendChatMessage's `sourceText` option below instead of
  // relying on that (nonexistent) DB lookup.
  const courseChatSlug = activeCourse ? `studio-course-${activeCourse.id}` : undefined;
  const { chatMessages, chatInput, setChatInput, isTyping, sendChatMessage, clearMessages } = useCourseChat(courseChatSlug);

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

  // Real QCM mastery (qcm_attempts, aggregated in Postgres by the
  // course_mastery function — see app/api/srs/course-mastery/route.ts). That
  // function groups purely by course_slug with no join to any courses table,
  // so it already covers this page's `studio-course-{id}` slugs the moment
  // real attempts exist for them. Fetched once per module visit, same
  // pattern as the dashboard's own courseMastery fetch.
  const [courseMastery, setCourseMastery] = useState<
    { course_slug: string; mastery_pct: number; avg_leitner_box: number | null }[]
  >([]);

  useEffect(() => {
    fetch("/api/srs/course-mastery")
      .then((res) => res.json())
      .then((data) => setCourseMastery(data.mastery ?? []))
      .catch(() => setCourseMastery([]));
  }, [moduleId]);

  const courseMasteryBySlug = useMemo(() => {
    const map = new Map<string, { qcmSuccessPct: number; srsMasteryPct: number }>();
    for (const row of courseMastery) {
      const srsMasteryPct =
        row.avg_leitner_box != null ? Math.max(0, Math.min(100, ((row.avg_leitner_box - 1) / (MAX_LEITNER_BOX - 1)) * 100)) : 0;
      map.set(row.course_slug, { qcmSuccessPct: row.mastery_pct, srsMasteryPct });
    }
    return map;
  }, [courseMastery]);

  const today = new Date().toLocaleDateString("fr-FR");
  const openedSectionLabel = DEMO_SECTIONS.find((s) => s.id === openedSection)?.label ?? "";
  const moduleTitle = module?.title ?? "Module";

  /** Applies a newly-created course to sidebar/active state — shared by both the file and pasted-text creation paths below. useCallback with empty deps: only ever touches stable setState dispatchers and the stable courseCacheRef, so this reference never changes across the component's lifetime. */
  const applyCreatedCourse = useCallback((created: StudioCourseSummary, rawText: string, sourceFileUrl: string | null) => {
    setCourses((prev) => [...prev, created]); // appended at the bottom — matches the sidebar's oldest-first order
    const fullCourse: StudioCourseFull = {
      id: created.id,
      title: created.title,
      rawText,
      explication: null,
      resume: null,
      casClinique: null,
      qcms: null,
      exemplesAnalogies: null,
      sourceFileUrl,
    };
    courseCacheRef.current.set(created.id, fullCourse);
    setActiveCourse(fullCourse);
    setOpenedSection(null);
  }, []);

  /** Returns the new course's id (as a string, matching UploadModal's generic contract) or throws — UploadModal shows the thrown message inline instead of a toast, so the student sees exactly why an upload failed without losing the dialog. useCallback so ModuleSourcesPanel's React.memo isn't defeated by a fresh reference every render. */
  const handleFileSelected = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok || !uploadData.success) throw new Error(uploadData?.error ?? "L'extraction du PDF a échoué.");

    const sourceFileUrl: string | null = uploadData.fileUrl ?? null;
    const createRes = await fetch("/api/studio/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleId, title: file.name, rawText: uploadData.text, sourceFileUrl }),
    });
    const createData = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createData.success) throw new Error(createData?.error ?? "La création du cours a échoué.");

    const created: StudioCourseSummary = createData.course;
    applyCreatedCourse(created, uploadData.text, sourceFileUrl);
    toast({ variant: "success", title: "Source ajoutée", description: `${file.name} a été importé et sauvegardé.` });
    return String(created.id);
  }, [moduleId, applyCreatedCourse, toast]);

  /** "Texte brut" tab of the unified Add-sources modal — skips /api/upload entirely (no file to extract from) and creates the course directly from the pasted text. */
  const handleTextSubmitted = useCallback(async (text: string, title: string): Promise<string> => {
    const createRes = await fetch("/api/studio/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleId, title: title.trim() || "Cours (texte collé)", rawText: text }),
    });
    const createData = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createData.success) throw new Error(createData?.error ?? "La création du cours a échoué.");

    const created: StudioCourseSummary = createData.course;
    applyCreatedCourse(created, text, null);
    toast({ variant: "success", title: "Source ajoutée", description: `${created.title} a été ajouté.` });
    return String(created.id);
  }, [moduleId, applyCreatedCourse, toast]);

  /**
   * Context switching: clears the detail pane immediately (the Studio must
   * show nothing from the previous course while the new one loads) and
   * loads whatever this course already has saved — instant if it was fully
   * generated before, since nothing here ever re-calls the AI for content
   * that already exists.
   */
  /** Returns the loaded course (or the already-active one, or null on failure) — handleShowCourseFile below needs the freshly-loaded row immediately, not just the fire-and-forget state update. useCallback (dep on the full `activeCourse` object, not just its id, so the early-return path is never stale) so ModuleSourcesPanel's React.memo isn't defeated by a fresh reference every render. */
  const handleSelectCourse = useCallback(async (courseId: number): Promise<StudioCourseFull | null> => {
    if (courseId === activeCourse?.id) return activeCourse;

    startNavTransition(() => setOpenedSection(null));

    // Cache hit — this course was already fully loaded once this page visit
    // (kept in sync by every mutation site: generate, regenerate, upload).
    // Switching back to it is then a pure state update, zero network
    // roundtrip, so it never needs the "Chargement du cours..." spinner.
    const cached = courseCacheRef.current.get(courseId);
    if (cached) {
      startNavTransition(() => setActiveCourse(cached));
      return cached;
    }

    setIsSwitchingCourse(true);
    try {
      const res = await fetch(`/api/studio/courses/${courseId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "Impossible de charger ce cours.");
      courseCacheRef.current.set(courseId, data.course);
      startNavTransition(() => setActiveCourse(data.course));
      return data.course as StudioCourseFull;
    } catch (error) {
      toast({
        variant: "error",
        title: "Échec du chargement",
        description: error instanceof Error ? error.message : "Erreur inconnue.",
      });
      return null;
    } finally {
      setIsSwitchingCourse(false);
    }
  }, [activeCourse, toast]);

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
  // Wrapped in useCallback (not a plain function statement) specifically so
  // MobileStudioCards' React.memo actually holds: without a stable identity
  // here, every unrelated parent re-render (a chat-input keystroke, a typing
  // indicator toggling) would recreate this function and force the memoized
  // card grid to re-render right along with it.
  const handleStudioItemClick = useCallback(async (id: DemoSectionId) => {
    if (!activeCourse) {
      toast({
        variant: "info",
        title: "Ajoute une source",
        description: "Importe d'abord un PDF dans Sources pour générer ce contenu.",
      });
      return;
    }

    if (getSectionValue(activeCourse, id)) {
      startNavTransition(() => setOpenedSection(id));
      return;
    }

    if (generatingSection) return; // ignore: this id's own spinner, or a different tile already in flight

    const courseId = activeCourse.id;
    const rawText = activeCourse.rawText;

    setGeneratingSection(id);
    try {
      // /api/studio/generate now saves to Supabase itself before returning
      // success (atomic generate-then-save — see that route's header
      // comment), so there's no separate PATCH here anymore: a refresh
      // right after this resolves already reloads straight from Supabase,
      // and a refresh/tab-close mid-generation never burns an OpenRouter
      // call for a result that never gets saved.
      const { res, data } = await postStudioGenerate(id, rawText, courseId);
      if (!res.ok || !data.success) {
        throw new Error(res.status === 429 ? buildRateLimitMessage(res) : data?.error ?? "La génération a échoué.");
      }

      // Keyed off the cache (not the `activeCourse` closure, which may now
      // point at a different course if the student switched mid-generation)
      // so the cache stays the single source of truth for this id regardless
      // of what's currently on screen.
      const baseCourse = courseCacheRef.current.get(courseId);
      if (baseCourse) {
        const updated = withSectionValue(baseCourse, id, data.data);
        courseCacheRef.current.set(courseId, updated);
        // Only apply to the visible state if the student hasn't switched to a different course while this was generating.
        setActiveCourse((prev) => (prev && prev.id === courseId ? updated : prev));
      }
    } catch (error) {
      toast({
        variant: "error",
        title: "Échec de la génération",
        description: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setGeneratingSection(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCourse, generatingSection, toast]);

  /** Stable reference so the desktop ModuleSourcesPanel instance's React.memo actually holds. */
  const handleCloseSourcesPanel = useCallback(() => setIsSplitScreen(true), []);

  /** Stable reference so MobileWorkspaceTabBar's React.memo actually holds. */
  const handleMobileTabChange = useCallback((tab: MobileWorkspaceTab) => {
    startNavTransition(() => setMobileTab(tab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Shared by both the desktop studioPanel and MobileStudioCards — one stable reference (useCallback) instead of two separate inline arrows recreated every render. */
  const getSectionStatus = useCallback(
    (id: DemoSectionId): SectionStatus => (activeCourse && getSectionValue(activeCourse, id) ? "available" : "needs_generation"),
    [activeCourse]
  );

  /**
   * One attempt at /api/studio/generate — network errors (fetch() itself
   * throwing: dropped wifi, a router hiccup) are NOT caught here, they
   * propagate to the caller, which is what lets postStudioGenerate below
   * distinguish "the request never landed" from "it landed and the server
   * said no".
   */
  async function requestStudioGeneration(actionType: DemoSectionId, context: string, courseId: number) {
    const res = await fetch("/api/studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionType, documentContext: context, courseId }),
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
  async function postStudioGenerate(actionType: DemoSectionId, context: string, courseId: number) {
    let attempt: { res: Response; data: any };
    try {
      attempt = await requestStudioGeneration(actionType, context, courseId);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempt = await requestStudioGeneration(actionType, context, courseId);
    }

    if (attempt.res.status === 401) {
      await supabase.auth.getUser();
      attempt = await requestStudioGeneration(actionType, context, courseId);
    }

    return attempt;
  }

  function handleSend() {
    const text = chatInput.trim();
    if (!text && !quotedText) return;
    if (isTyping) return;

    const isQuoted = quotedText !== null;
    const isTranslate = quotedMode === "translate";
    const fullMessage = buildQuotedChatMessage(quotedText, text);
    setChatInput("");
    setQuotedText(null);
    setQuotedMode(null);
    sendChatMessage(fullMessage, {
      sourceText: activeCourse?.rawText ?? undefined,
      // "Ask MedArt" and "Translate" are both quick actions staged the same
      // way (see handleAskSelection/handleTranslateSelection below) — short
      // answer for Ask MedArt (concise), the dedicated translator persona
      // for Translate (translate), never both. Either way the quote/reply
      // must never resend in later requests' history (see
      // ChatMessage.excludeFromHistory). selectedText puts the server in
      // strict highlight isolation (no course text, no history, forced onto
      // the cheap model) — sourceText above is ignored server-side whenever
      // this is set, kept only for the plain (non-highlight) send path.
      concise: isQuoted && !isTranslate,
      translate: isTranslate,
      excludeFromHistory: isQuoted,
      selectedText: quotedText ?? undefined,
    });
  }

  /** Shared by Ask MedArt and Translate — both insert the selection as a citation chip above the composer and let the student review/edit before sending, rather than firing immediately. Opens split-screen so the chat is visible alongside whatever Studio tile (or the sidebar) was open. */
  function stageQuotedSelection(text: string, mode: "ask" | "translate") {
    setQuotedText(text);
    setQuotedMode(mode);
    // Split-screen is a desktop-only concept — on mobile, "seeing the chat
    // alongside what you selected" instead means switching to the Chat tab.
    if (isDesktop) {
      setIsSplitScreen(true);
    } else {
      setMobileTab("chat");
    }
    chatPanelRef.current?.focusInput();
  }

  function handleAskSelection(text: string) {
    stageQuotedSelection(text, "ask");
  }

  /** Used to send immediately with no review step — now mirrors Ask MedArt exactly: stages the citation chip and pre-fills the composer with a translate instruction the student can still edit before sending. */
  function handleTranslateSelection(text: string) {
    stageQuotedSelection(text, "translate");
    setChatInput("Traduis ce texte : ");
  }

  const handleDeleteCourse = useCallback(async (courseId: number) => {
    const res = await fetch(`/api/studio/courses/${courseId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      toast({ variant: "error", title: "Échec de la suppression", description: data?.error ?? "Erreur inconnue." });
      return;
    }
    courseCacheRef.current.delete(courseId);
    setCourses((prev) => prev.filter((c) => c.id !== courseId));
    if (activeCourse?.id === courseId) {
      setActiveCourse(null);
      setOpenedSection(null);
      setIsSplitScreen(false);
    }
    toast({ variant: "success", title: "Cours supprimé" });
  }, [activeCourse, toast]);

  /** "Afficher le cours" — opens FileViewerModal for this course, loading it first if it isn't already the active one. Fully decoupled from the chat/Studio split-screen. */
  const handleShowCourseFile = useCallback(async (courseId: number) => {
    const course = await handleSelectCourse(courseId);
    if (course) setFileViewerCourse(course);
  }, [handleSelectCourse]);

  /** "Regénérer" — see app/api/studio/regenerate/route.ts's own doc comment for why this deliberately never resends the source document. */
  async function handleRegenerateSection(id: DemoSectionId) {
    if (!activeCourse || regeneratingSection || generatingSection) return;

    const courseId = activeCourse.id;
    setRegeneratingSection(id);
    try {
      const res = await fetch("/api/studio/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, section: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(res.status === 429 ? buildRateLimitMessage(res) : data?.error ?? "La régénération a échoué.");
      }

      const baseCourse = courseCacheRef.current.get(courseId);
      if (baseCourse) {
        const updated = withSectionValue(baseCourse, id, data.data);
        courseCacheRef.current.set(courseId, updated);
        setActiveCourse((prev) => (prev && prev.id === courseId ? updated : prev));
      }
      toast({
        variant: "success",
        title: "Contenu régénéré",
        description: `${DEMO_SECTIONS.find((s) => s.id === id)?.label ?? "Le contenu"} a été régénéré.`,
      });
    } catch (error) {
      toast({
        variant: "error",
        title: "Échec de la régénération",
        description: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setRegeneratingSection(null);
    }
  }

  /** Studio's "Add note" panel real save — posts to /api/notes (Mes notes), defaulting the title to the active course's own title. */
  async function handleSaveNote() {
    const content = noteContent.trim();
    if (!content) return;

    setIsSavingNote(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: activeCourse?.title ?? moduleTitle, content }),
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

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100 dark:bg-neutral-950">
        <BrandLoader />
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
      onClearHistory={clearMessages}
      onAskSelection={handleAskSelection}
      onTranslateSelection={handleTranslateSelection}
      pendingThinkingLabel={null}
      isSplitScreen={isSplitScreen}
      onToggleSplitScreen={() => setIsSplitScreen((prev) => !prev)}
      dark={isDark}
      quotedText={quotedText}
      onClearQuote={() => {
        setQuotedText(null);
        setQuotedMode(null);
      }}
      moduleId={moduleId}
      courseTitle={activeCourse?.title}
      sourceTextLength={activeCourse?.rawText?.length}
    />
  );

  // Mobile's Chat tab — same underlying panel, but split-screen has no
  // meaning on a single-view-at-a-time tabbed layout (hidden entirely rather
  // than wired to a no-op), and the source-count badge becomes a real
  // course switcher instead of a plain count.
  const mobileChatPanel = (
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
      onClearHistory={clearMessages}
      onAskSelection={handleAskSelection}
      onTranslateSelection={handleTranslateSelection}
      pendingThinkingLabel={null}
      isSplitScreen={false}
      onToggleSplitScreen={() => {}}
      showSplitScreenToggle={false}
      dark={isDark}
      quotedText={quotedText}
      onClearQuote={() => {
        setQuotedText(null);
        setQuotedMode(null);
      }}
      sources={courses.map((c) => ({ id: c.id, title: c.title }))}
      activeSourceId={activeCourse?.id ?? null}
      onSelectSource={handleSelectCourse}
      moduleId={moduleId}
      courseTitle={activeCourse?.title}
      sourceTextLength={activeCourse?.rawText?.length}
    />
  );

  const studioPanel = (
    <StudioPanel
      sections={DEMO_SECTIONS}
      openedSection={openedSection}
      openedLabel={openedSectionLabel}
      onItemClick={handleStudioItemClick}
      onCloseSection={() => setOpenedSection(null)}
      getSectionStatus={getSectionStatus}
      generatingSection={generatingSection}
      regeneratingSection={regeneratingSection}
      onRegenerateSection={handleRegenerateSection}
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
      onSaveNote={handleSaveNote}
      isSavingNote={isSavingNote}
      onAskSelection={handleAskSelection}
      onTranslateSelection={handleTranslateSelection}
      moduleId={moduleId}
      courseTitle={activeCourse?.title}
      onCollapsedChange={setIsStudioCollapsed}
    >
      {isSwitchingCourse ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 py-20">
          <BrandLoader className="h-6 w-6" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Chargement du cours...</p>
        </div>
      ) : openedSection && generatingSection === openedSection ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 py-20">
          <BrandLoader className="h-6 w-6" />
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
          <Suspense fallback={<StudioTileSkeleton />}>
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
              />
            )}
          </Suspense>
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

      {/* Desktop (md+) — the original fixed-width 3-column shell, completely
          unchanged. `isDesktop` (useMediaQuery, not a CSS class) gates which
          of this block or the mobile one below actually mounts, so neither
          pays the cost of the other sitting hidden in the DOM. */}
      {isDesktop && (
        <div className="flex flex-1 flex-row gap-4 overflow-hidden p-4">
          {!isSplitScreen && (
            <aside className={cn(panelShellClasses, "w-72 shrink-0")}>
              <ModuleSourcesPanel
                courses={courses}
                activeCourseId={activeCourse?.id ?? null}
                isSwitchingCourse={isSwitchingCourse}
                onSubmitFile={handleFileSelected}
                onSubmitText={handleTextSubmitted}
                onSelectCourse={handleSelectCourse}
                onShowCourseFile={handleShowCourseFile}
                onDeleteCourse={handleDeleteCourse}
                onClosePanel={handleCloseSourcesPanel}
                courseMasteryBySlug={courseMasteryBySlug}
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

          {!isSplitScreen && (
            <aside className={cn(panelShellClasses, "shrink-0 transition-all duration-300", isStudioCollapsed ? "w-20" : "w-96")}>
              {studioPanel}
            </aside>
          )}
        </div>
      )}

      {/* Mobile (<md) — NotebookLM-mobile-style: exactly one of
          Sources/Chat/Studio visible at a time, switched via the bottom tab
          bar, never split-screen (that's a wide-viewport-only concept). The
          Studio tab shows the same detail view (studioPanel) as desktop once
          a section is opened — only the "browse" grid gets a mobile-specific
          large-card treatment (MobileStudioCards) instead of duplicating the
          markdown/GastriteXXXStudio rendering logic a second time. */}
      {!isDesktop && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className={cn(panelShellClasses, "m-4 flex-1")}>
            {mobileTab === "sources" && (
              <ModuleSourcesPanel
                variant="mobile"
                courses={courses}
                activeCourseId={activeCourse?.id ?? null}
                isSwitchingCourse={isSwitchingCourse}
                onSubmitFile={handleFileSelected}
                onSubmitText={handleTextSubmitted}
                onSelectCourse={handleSelectCourse}
                onShowCourseFile={handleShowCourseFile}
                onDeleteCourse={handleDeleteCourse}
                onClosePanel={NOOP}
                courseMasteryBySlug={courseMasteryBySlug}
              />
            )}
            {mobileTab === "chat" && mobileChatPanel}
            {mobileTab === "studio" &&
              (openedSection ? (
                studioPanel
              ) : (
                <MobileStudioCards
                  sections={DEMO_SECTIONS}
                  getSectionStatus={getSectionStatus}
                  generatingSection={generatingSection}
                  onItemClick={handleStudioItemClick}
                />
              ))}
          </div>

          <MobileWorkspaceTabBar active={mobileTab} onChange={handleMobileTabChange} />
        </div>
      )}

      <FileViewerModal
        open={fileViewerCourse !== null}
        onOpenChange={(open) => !open && setFileViewerCourse(null)}
        title={fileViewerCourse?.title ?? ""}
        fileUrl={fileViewerCourse?.sourceFileUrl ?? null}
        rawText={fileViewerCourse?.rawText ?? ""}
      />
    </div>
  );
}
