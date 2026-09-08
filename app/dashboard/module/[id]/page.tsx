"use client";

import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Camera, Check, Columns2, FileText, Loader2, MoreVertical, PanelLeftClose, PanelLeftOpen, Plus, Search, Trash2, TrendingUp } from "lucide-react";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { ClinicalConnectionsPanel } from "@/components/course/workspace/ClinicalConnectionsPanel";
import { useLanguage } from "@/providers/LanguageProvider";
import { useAuth } from "@/providers/AuthProvider";
import { tModulePage } from "@/lib/translations/modulePage";
import { getSectionLabel } from "@/lib/translations/studio";
import { cn } from "@/lib/utils";
import { buildRateLimitMessage } from "@/lib/rate-limit-message";
import { uploadDocumentDirect, retryUploadWithOcr } from "@/lib/upload-client";
import { generateExplicationInParts } from "@/lib/studio-explication-client";
import { wait, randomFakeDelayMs } from "@/lib/fake-ai-delay";
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
import { StudioPanel, type SectionStatus, type TileGenerationOptions } from "@/components/course/workspace/StudioPanel";
import { FileViewerModal } from "@/components/course/workspace/FileViewerModal";
import { StudioTileSkeleton } from "@/components/course/workspace/StudioTileSkeleton";
import { MobileWorkspaceTabBar, type MobileWorkspaceTab } from "@/components/course/workspace/MobileWorkspaceTabBar";
import { MobileStudioCards } from "@/components/course/workspace/MobileStudioCards";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useCourseChat } from "@/hooks/useCourseChat";
import { MAX_LEITNER_BOX } from "@/lib/srs";
import { DARK_MARKDOWN_COMPONENTS, DARK_PROSE_CLASSES, MARKDOWN_COMPONENTS, PROSE_CLASSES, normalizeCallouts } from "@/lib/markdown";
import { DEMO_SECTIONS, buildQuotedChatMessage, type DemoSectionId } from "@/lib/demo-content";
import { getInFlightGeneration, trackGeneration } from "@/lib/studio-generation-tracker";
import { PodcastGeneratingLabel } from "@/components/course/workspace/PodcastGeneratingLabel";
import { createClient } from "@/lib/supabase/client";
import type { CurriculumModule } from "@/types/academic";
import type { StudioCourseFull, StudioCourseSummary } from "@/types/studio-course";

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
/** 1ère année's replacement for the cas_clinique tile — a motivational essay, never a fabricated patient. See its own file for why it's a separate component from GastriteCasCliniqueStudio above. */
const ClinicalRelevanceStudio = dynamic(
  () => import("@/components/course/workspace/ClinicalRelevanceStudio").then((m) => m.ClinicalRelevanceStudio),
  { ssr: false }
);
const GastriteQcmsStudio = dynamic(
  () => import("@/components/course/workspace/GastriteQcmsStudio").then((m) => m.GastriteQcmsStudio),
  { ssr: false }
);
const InfographicViewer = dynamic(
  () => import("@/components/course/workspace/InfographicViewer").then((m) => m.InfographicViewer),
  { ssr: false }
);
const AudioPodcastViewer = dynamic(
  () => import("@/components/course/workspace/AudioPodcastViewer").then((m) => m.AudioPodcastViewer),
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
    case "infographic":
      return course.infographicUrl;
    case "audio":
      return course.audioUrl;
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
    case "infographic":
      return { ...course, infographicUrl: value };
    case "audio":
      return { ...course, audioUrl: value };
  }
}

/** Composite key for the generating/regenerating-by-key Sets below — course-scoped so an in-flight section on one course can never bleed into another's identically-named tile. */
function sectionKey(courseId: number, section: DemoSectionId): string {
  return `${courseId}:${section}`;
}

/** Derives the plain `Set<DemoSectionId>` StudioPanel/MobileStudioCards expect, scoped to whichever course is currently active — see generatingByKey's own comment for the bug this exists to fix. */
function scopeToActiveCourse(byKey: Set<string>, activeCourseId: number | null): Set<DemoSectionId> {
  const scoped = new Set<DemoSectionId>();
  if (activeCourseId === null) return scoped;
  const prefix = `${activeCourseId}:`;
  for (const key of byKey) {
    if (key.startsWith(prefix)) scoped.add(key.slice(prefix.length) as DemoSectionId);
  }
  return scoped;
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
  onRetryWithOcr,
  onSelectCourse,
  onShowCourseFile,
  onDeleteCourse,
  courseMasteryBySlug,
  variant = "desktop",
  isCollapsed = false,
  onToggleCollapse,
  selectedSourceIds,
  onToggleSource,
}: {
  courses: StudioCourseSummary[];
  activeCourseId: number | null;
  isSwitchingCourse: boolean;
  onSubmitFile: (file: File) => Promise<string>;
  onSubmitText: (text: string, title: string) => Promise<string>;
  onRetryWithOcr: (path: string, fileName: string) => Promise<string>;
  onSelectCourse: (id: number) => void;
  onShowCourseFile: (id: number) => void;
  onDeleteCourse: (id: number) => Promise<void>;
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
  /** Desktop-only icon rail, mirroring StudioPanel's own collapse — see this page's isSourcesCollapsed. Ignored on the mobile variant (its own tab bar already IS the collapse). */
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Multi-select chat-context sources (Point 2) — a course can be "open" (the Studio tile source) independently of being "checked" (included in the Chat's context). Optional: a caller that omits both simply renders no checkboxes at all. */
  selectedSourceIds?: Set<number>;
  onToggleSource?: (id: number) => void;
}) {
  const { language } = useLanguage();
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

  const isRail = variant === "desktop" && isCollapsed;

  return (
    <>
      {variant === "desktop" && (
        <div className={cn("flex items-center border-b border-border p-2 md:p-4", isRail ? "justify-center" : "justify-between")}>
          {!isRail && <h2 className="text-sm font-semibold text-foreground">{tModulePage("sourcesHeading", language)}</h2>}
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={tModulePage(isRail ? "openPanelAriaLabel" : "collapsePanelAriaLabel", language)}
            aria-pressed={isRail}
            className="rounded-xl p-2 text-muted-foreground transition-all duration-300 hover:bg-accent hover:text-foreground active:scale-[0.94]"
          >
            {isRail ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
      )}

      <div className={cn("flex flex-1 flex-col overflow-y-auto", isRail ? "items-center space-y-1.5 p-2" : "space-y-4 p-4")}>
        {variant === "desktop" && !isRail && (
          <>
            {/* Always enabled — adding a 2nd, 3rd, ... course never disables this, per the multi-course mandate. */}
            <Button variant="outline" size="sm" className="w-full rounded-xl" onClick={() => setUploadOpen(true)}>
              <Plus className="h-4 w-4" />
              Add sources
            </Button>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={tModulePage("searchWebPlaceholder", language)}
                value={webSearchQuery}
                onChange={(e) => setWebSearchQuery(e.target.value)}
                onKeyDown={handleWebSearchKeyDown}
                className="border-none bg-muted pl-9 shadow-none"
              />
            </div>
          </>
        )}

        {isRail ? (
          // Icon-only rail — mirrors StudioPanel's own collapsed grid
          // (aspect-square icon tiles, one per column): a tidy, aligned
          // column of course icons a student can still click to switch
          // sources without the panel eating a third of the screen.
          <>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              title={tModulePage("addSourceLabel", language)}
              className="flex aspect-square w-full items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition-all duration-300 hover:border-primary-300 hover:text-primary-600"
            >
              <Plus className="h-4 w-4" />
            </button>
            {courses.map((course) => {
              const isActive = course.id === activeCourseId;
              return (
                <button
                  key={course.id}
                  type="button"
                  onClick={() => onSelectCourse(course.id)}
                  disabled={isSwitchingCourse}
                  title={course.title}
                  className={cn(
                    "flex aspect-square w-full items-center justify-center rounded-xl border transition-all duration-300 disabled:cursor-wait",
                    isActive
                      ? "border-primary-300 bg-primary-50 text-primary-600 shadow-glow dark:border-primary-800 dark:bg-primary-950/30 dark:text-primary-400"
                      : "border-border bg-card text-muted-foreground hover:bg-accent"
                  )}
                >
                  <FileText className="h-5 w-5" />
                </button>
              );
            })}
          </>
        ) : courses.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-8 text-center">
            <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
              <FileText className="h-6 w-6 text-muted-foreground/50" />
            </motion.div>
            <p className="text-sm font-medium text-muted-foreground">{tModulePage("noSourcesEmptyState", language)}</p>
            <p className="text-xs text-muted-foreground/70">
              Ajoutez votre premier PDF ou texte pour commencer.
            </p>
          </div>
        ) : (
          // Oldest first (a new upload appears at the bottom of this list) — matches
          // /api/studio/courses' own ORDER BY created_at ascending.
          <div className="space-y-2">
            {courses.map((course) => {
              const isActive = course.id === activeCourseId;
              const isChecked = selectedSourceIds?.has(course.id) ?? false;
              // Real course_mastery data (qcm_attempts-derived) — only ever
              // present once the student has real attempts logged for this
              // course; a course with none simply renders no ring at all,
              // never a fake 0%. Averaged (not just QCM alone) so this one
              // ring reflects both raw QCM success AND spaced-repetition
              // progress, same two numbers CourseStatsModal already shows
              // separately — this is their honest combined summary.
              const mastery = courseMasteryBySlug.get(`studio-course-${course.id}`);
              const overallMasteryPct = mastery ? Math.round((mastery.qcmSuccessPct + mastery.srsMasteryPct) / 2) : null;
              return (
                <div
                  key={course.id}
                  className={cn(
                    "group flex items-start gap-2 rounded-2xl border p-3 transition-all duration-300",
                    isActive
                      ? "border-primary-300 bg-primary-50 shadow-glow dark:border-primary-800 dark:bg-primary-950/30"
                      : "border-border bg-card hover:-translate-y-0.5 hover:bg-accent hover:shadow-soft"
                  )}
                >
                  {onToggleSource && (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isChecked}
                      aria-label={tModulePage("selectSourceAriaLabel", language)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSource(course.id);
                      }}
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                        isChecked
                          ? "border-primary-500 bg-primary-500 text-white"
                          : "border-muted-foreground/40 bg-transparent hover:border-primary-400"
                      )}
                    >
                      {isChecked && <Check className="h-3 w-3" />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectCourse(course.id)}
                    disabled={isSwitchingCourse}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-wait"
                  >
                    <FileText className={cn("mt-0.5 h-4 w-4 shrink-0", isActive ? "text-primary-500" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm font-medium", isActive ? "text-primary-900 dark:text-primary-200" : "text-foreground")}>
                        {course.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {isActive ? tModulePage("activeCourseLabel", language) : tModulePage("clickToOpenLabel", language)}
                      </p>
                    </div>
                  </button>

                  {overallMasteryPct !== null && (
                    <ProgressRing
                      completed={overallMasteryPct}
                      total={100}
                      size={30}
                      strokeWidth={3}
                      className="mt-0.5 shrink-0"
                      label={<span className="text-[9px] font-bold text-foreground">{overallMasteryPct}%</span>}
                      aria-label={`${tModulePage("masteryAriaLabel", language)} ${overallMasteryPct}%`}
                    />
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-300 hover:bg-accent hover:text-foreground"
                      aria-label="Options de la source"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onShowCourseFile(course.id)}>
                        <Columns2 className="h-4 w-4 text-primary-600 dark:text-primary-400" />
                        Afficher le cours
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setStatsCourse(course)}>
                        <TrendingUp className="h-4 w-4 text-primary-600 dark:text-primary-400" />
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
        <div className="flex shrink-0 items-center gap-2 border-t border-border p-4">
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
            {tModulePage("addSourceLabel", language)}
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
        onRetryWithOcr={onRetryWithOcr}
        title={tModulePage("addSourceLabel", language)}
        description="Importe un document ou colle du texte pour ce module."
      />
    </>
  );
});

export default function ModuleWorkspacePage() {
  const params = useParams<{ id: string }>();
  const moduleId = Number(params.id);
  const { language } = useLanguage();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { toast } = useToast();
  const supabase = useMemo(() => createClient(), []);
  /**
   * The Cas Clinique tile's own year-based adaptation (both its label and
   * its AI prompt/schema, resolveCasCliniqueSystemPrompt/resolveStudioSchema
   * in app/api/studio/generate/route.ts) keys off exactly this value — every
   * other Studio tile ignores it entirely. `null` for a student with no
   * curriculum profile yet, or whose year is neither 1 nor 2, falls through
   * to the standard "Cas Cliniques" behavior.
   */
  const { curriculumProfile } = useAuth();
  const studyYear = curriculumProfile?.academicYear?.level ?? null;

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
  // Sources' own icon-rail collapse (Point 1) — same "shrink the fixed-width
  // <aside> to w-20" mechanism Studio already had, so Chat's flex-1 middle
  // section naturally reclaims the freed width with zero grid changes.
  const [isSourcesCollapsed, setIsSourcesCollapsed] = useState(false);
  // Multi-select CHAT-CONTEXT sources (Point 2) — deliberately independent
  // of `activeCourse` (which course's Studio tiles are showing): a student
  // can check several sources into the Chat's context without "opening"
  // every one of them in Studio. Seeded with the active course whenever it
  // changes (see the effect below `handleSelectCourse`) so the pre-existing
  // single-course behavior still feels continuous by default.
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<number>>(() => new Set());
  // Client-side cache of every full course row fetched this page visit,
  // keyed by id — switching back to a course you already opened is instant
  // (no network roundtrip), and every place that mutates `activeCourse`
  // (generate, regenerate, a fresh upload) mirrors its result in here too so
  // a later cache hit is never stale. A plain ref (not state) since writing
  // to it must never itself trigger a re-render — only `activeCourse` does.
  const courseCacheRef = useRef<Map<number, StudioCourseFull>>(new Map());
  const [isSwitchingCourse, setIsSwitchingCourse] = useState(false);
  // Sets, not a single DemoSectionId — a student can now generate/regenerate
  // several Studio sections concurrently (e.g. click Résumé, then Cas
  // Clinique, without waiting for the first to finish) instead of every
  // OTHER tile's click being silently ignored while one is in flight. The
  // backend already handles each /api/studio/generate call as its own
  // independent, stateless request — this was purely a client-side
  // single-value bottleneck, not a real backend constraint.
  //
  // Keyed by `${courseId}:${sectionId}` (sectionKey below), NOT by bare
  // section id — a real, reported bug: with a bare-section-id Set, starting
  // "Résumé" on Course A then switching to Course B (before it finished)
  // made Course B's OWN "Résumé" tile show as generating too (same section
  // id, no course scoping at all), and could even silently swallow a click
  // on Course B's "Résumé" — `if (generatingSections.has(id)) return;` saw
  // the id as already "generating" globally and did nothing. `generatingSections`/
  // `regeneratingSections` below are the derived, ACTIVE-course-scoped views
  // StudioPanel/MobileStudioCards actually consume — their own
  // Set<DemoSectionId> contract is unchanged, only this page's bookkeeping
  // became course-aware.
  const [generatingByKey, setGeneratingByKey] = useState<Set<string>>(() => new Set());
  const [regeneratingByKey, setRegeneratingByKey] = useState<Set<string>>(() => new Set());
  const activeCourseIdForSections = activeCourse?.id ?? null;
  const generatingSections = useMemo(() => scopeToActiveCourse(generatingByKey, activeCourseIdForSections), [generatingByKey, activeCourseIdForSections]);
  const regeneratingSections = useMemo(() => scopeToActiveCourse(regeneratingByKey, activeCourseIdForSections), [regeneratingByKey, activeCourseIdForSections]);
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
  // Whichever course is opened becomes part of the Chat's context by
  // default — matches the single-source behavior this page always had,
  // while never un-checking a source the student already added on top.
  useEffect(() => {
    if (!activeCourse) return;
    setSelectedSourceIds((prev) => (prev.has(activeCourse.id) ? prev : new Set(prev).add(activeCourse.id)));
    // Deliberately keyed on the id only — re-running on every activeCourse
    // CONTENT update (a generation landing, a cache refresh) would be
    // wasted work, since only a genuine course SWITCH should ever seed a
    // new id into the selection. Same pattern as this file's other
    // id-scoped effects (e.g. the generation-tracker reconciliation below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCourse?.id]);

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

  // Real, already-fetched QCM mastery for the active course's own tile (see
  // StudioPanel/MobileStudioCards' own sectionMasteryPct doc comment) — never
  // fabricated: a course with no course_mastery row yet (courseMasteryBySlug
  // has no entry) simply passes undefined, so the tile keeps its plain dot.
  const activeCourseMastery = activeCourse ? courseMasteryBySlug.get(`studio-course-${activeCourse.id}`) : undefined;
  const sectionMasteryPct = activeCourseMastery ? { qcm: Math.round(activeCourseMastery.qcmSuccessPct) } : undefined;

  const today = new Date().toLocaleDateString("fr-FR");
  const openedSectionLabel = openedSection ? getSectionLabel(openedSection, language, studyYear) : "";
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
      updatedAt: created.createdAt,
      infographicUrl: null,
      audioUrl: null,
    };
    courseCacheRef.current.set(created.id, fullCourse);
    setActiveCourse(fullCourse);
    setOpenedSection(null);
  }, []);

  /** Returns the new course's id (as a string, matching UploadModal's generic contract) or throws — UploadModal shows the thrown message inline instead of a toast, so the student sees exactly why an upload failed without losing the dialog. useCallback so ModuleSourcesPanel's React.memo isn't defeated by a fresh reference every render. */
  const handleFileSelected = useCallback(async (file: File): Promise<string> => {
    // Direct-to-storage upload (lib/upload-client.ts) — the file bytes go
    // straight to Supabase Storage, never through this Next.js server, and
    // passing `moduleId` here has the server create the studio_courses row
    // in the SAME request that extracts the text (see /api/upload/finalize's
    // own comment) instead of sending a potentially huge extracted-text
    // payload back to the browser only to immediately POST it again to
    // /api/studio/courses — both are what actually fix large course PDFs
    // failing to upload (Vercel's ~4.5 MB request-body ceiling applies to
    // every Node Function regardless of any size limit this app's own code
    // declares, in EITHER direction of a client-initiated request).
    const uploaded = await uploadDocumentDirect(file, moduleId);
    if (!uploaded.course) throw new Error("La création du cours a échoué.");

    applyCreatedCourse(uploaded.course, uploaded.text, uploaded.fileUrl);
    toast({ variant: "success", title: tModulePage("toastSourceAdded", language), description: `${file.name} a été importé et sauvegardé.` });
    return String(uploaded.course.id);
  }, [moduleId, applyCreatedCourse, toast, language]);

  /** Explicit OCR retry after handleFileSelected throws lib/upload-client.ts's OcrSuggestedError (a scanned PDF with no real text layer) — a real, billed OpenRouter call, only ever triggered by the student's own click on UploadModal's "Essayer l'OCR" action, never automatically. */
  const handleOcrRetry = useCallback(async (path: string, fileName: string): Promise<string> => {
    const uploaded = await retryUploadWithOcr(path, fileName, moduleId);
    if (!uploaded.course) throw new Error("La création du cours a échoué.");

    applyCreatedCourse(uploaded.course, uploaded.text, uploaded.fileUrl);
    toast({ variant: "success", title: tModulePage("toastSourceAdded", language), description: `${fileName} a été importé (OCR) et sauvegardé.` });
    return String(uploaded.course.id);
  }, [moduleId, applyCreatedCourse, toast, language]);

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
    toast({ variant: "success", title: tModulePage("toastSourceAdded", language), description: `${created.title} a été ajouté.` });
    return String(created.id);
  }, [moduleId, applyCreatedCourse, toast, language]);

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
        title: tModulePage("toastLoadFailed", language),
        description: error instanceof Error ? error.message : "Erreur inconnue.",
      });
      return null;
    } finally {
      setIsSwitchingCourse(false);
    }
  }, [activeCourse, toast, language]);

  /**
   * Silent background refresh — reads this course fresh from Supabase and
   * updates cache/activeCourse if it's still the one on screen, with no
   * loading spinner and no error toast (unlike handleSelectCourse above,
   * this is never a direct student action; a transient failure here just
   * means the student sees the result on their NEXT manual refresh/switch
   * instead of instantly, not a broken experience worth interrupting them
   * over). Used by the tracker-reconciliation effect below to pick up a
   * generation/regeneration that finished after THIS page (re)mounted, kept
   * running by a previous, since-unmounted instance.
   */
  const refreshCourseFromServer = useCallback(async (courseId: number) => {
    try {
      const res = await fetch(`/api/studio/courses/${courseId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) return;
      courseCacheRef.current.set(courseId, data.course);
      setActiveCourse((prev) => (prev && prev.id === courseId ? data.course : prev));
    } catch {
      // Best-effort — see this function's own comment.
    }
  }, []);

  // Matches the Pleurésie "Golden Standard" flow, using StudioPanel's
  // contract (generatingSections + getSectionStatus drive the list row;
  // openedSection drives the detail pane — generatingSections is now a Set,
  // so several tiles can each show their own spinner concurrently instead
  // of only one at a time) — StudioPanel calls this same onItemClick for
  // BOTH a grid tile and a "recent generations" list row, so the three
  // cases below are distinguished purely by this page's own state, never by
  // touching the component:
  //  1. Not generated yet, nothing in flight for THIS id -> start
  //     generating (a different id already generating no longer blocks
  //     this). Do NOT open the detail pane: StudioPanel already surfaces
  //     this as a spinning row in its own "recent generations" list purely
  //     because generatingSections.has(id), with no code needed here for
  //     that part.
  //  2. Already generated -> THIS click (on the now-ready list row, or on
  //     the grid tile again) is what opens the detail pane full-screen.
  //  3. Currently generating (a click on the spinning list row, or a second
  //     click before it resolves) -> ignored, nothing to open yet.
  // Wrapped in useCallback (not a plain function statement) specifically so
  // MobileStudioCards' React.memo actually holds: without a stable identity
  // here, every unrelated parent re-render (a chat-input keystroke, a typing
  // indicator toggling) would recreate this function and force the memoized
  // card grid to re-render right along with it.
  const handleStudioItemClick = useCallback(async (id: DemoSectionId, options?: TileGenerationOptions) => {
    if (!activeCourse) {
      toast({
        variant: "info",
        title: "Ajoute une source",
        description: "Importe d'abord un PDF dans Sources pour générer ce contenu.",
      });
      return;
    }

    // Every Studio section is independently generatable — the earlier
    // "Explication Ultra-Détaillée required first" gate (product decision,
    // now reversed) was removed by explicit request after real students hit
    // it as a hard blocker on mobile. lockedSections is no longer passed to
    // StudioPanel/MobileStudioCards for the matching visual-lock removal.
    if (getSectionValue(activeCourse, id)) {
      startNavTransition(() => setOpenedSection(id));
      return;
    }

    // Only THIS id's own spinner, on THIS course, blocks a re-click on
    // itself — a different tile (or the same tile on a DIFFERENT course)
    // already generating no longer blocks a new one from starting.
    if (generatingSections.has(id)) return;

    const courseId = activeCourse.id;
    const key = sectionKey(courseId, id);

    setGeneratingByKey((prev) => new Set(prev).add(key));

    // Wrapped in its own promise, registered with trackGeneration BEFORE
    // being awaited — this is what survives a navigation away from this
    // page (see lib/studio-generation-tracker.ts's own header comment for
    // the real bug this fixes: the request itself was NEVER actually
    // aborted by SPA navigation, only this component's OWN knowledge that
    // it was running, which risked a student re-clicking and paying for a
    // second real generation). The promise never rejects (the catch below
    // handles its own error, no rethrow) — nothing outside this function
    // needs to react to a rejection, only to "has it settled yet".
    const generationPromise = (async () => {
      try {
        // "infographic" and "audio" are NOT among the 5 JSON sections (see
        // lib/demo-content.ts's JsonSectionId comment) — each calls its own
        // dedicated route (image/audio response, its own cross-student cache
        // table, no studio_courses column to save into) instead of
        // postStudioGenerate below. All three branches converge back onto
        // the exact same withSectionValue/cache-update/UX-illusion handling
        // immediately after, so the surrounding spinner/tracker machinery
        // stays identical for every tile.
        let resultValue: unknown;
        let cached: boolean;

        if (id === "infographic") {
          const res = await fetch("/api/studio/infographic", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courseId, language: options?.language, model: options?.model }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) {
            throw new Error(res.status === 429 ? buildRateLimitMessage(res) : data?.error ?? "La génération a échoué.");
          }
          resultValue = data.imageUrl;
          cached = Boolean(data.cached);
        } else if (id === "audio") {
          // Same dedicated-route pattern as "infographic" above —
          // a single narrated episode (studio_podcast_cache), never routed
          // through postStudioGenerate. Real latency is the highest of any
          // Studio tile (a script-writing call plus one streamed ~10-15 min
          // audio narration, ~1-4 min total) but uses the exact same
          // fetch/spinner/tracker machinery regardless.
          const res = await fetch("/api/studio/podcast", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courseId, dialect: options?.dialect }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) {
            throw new Error(res.status === 429 ? buildRateLimitMessage(res) : data?.error ?? "La génération a échoué.");
          }
          resultValue = data.audioUrl;
          cached = Boolean(data.cached);
        } else if (id === "explication") {
          // Client-driven, multi-request pipeline — see
          // lib/studio-explication-client.ts's own header comment. Replaces
          // a single postStudioGenerate call: a multi-minute "ultra-détaillée"
          // generation could not reliably survive one HTTP
          // request/serverless invocation against Vercel's real duration
          // ceiling (the actual cause of repeated "échec de génération" +
          // truncation reported in production). Retries happen per-part,
          // automatically, inside generateExplicationInParts — a toast here
          // only fires on genuine, fully-exhausted failure.
          const result = await generateExplicationInParts(courseId, {
            language: options?.language,
            customPrompt: options?.customPrompt,
          });
          if (!result.success) {
            throw new Error(result.error ?? "La génération a échoué.");
          }
          resultValue = result.data;
          cached = Boolean(result.cached);
        } else {
          // /api/studio/generate now saves to Supabase itself before returning
          // success (atomic generate-then-save — see that route's header
          // comment), so there's no separate PATCH here anymore: a refresh
          // right after this resolves already reloads straight from Supabase,
          // and a refresh/tab-close mid-generation never burns an OpenRouter
          // call for a result that never gets saved. Note: no course text is
          // sent in this request anymore — the backend fetches its own raw_text
          // by courseId (see that route's own comment) instead of trusting this
          // client to resend a 60,000-char payload on every single click.
          // Every section (Explication, Résumé, Cas Clinique, QCM,
          // Exemples&Analogies) generates its complete content in ONE call on
          // first open — Résumé's earlier lazy per-mode loading was reverted by
          // explicit product direction (single-shot, hyper-concise prompt
          // instead — see STUDIO_RESUME_SYSTEM_PROMPT's own comment).
          const { res, data } = await postStudioGenerate(id, courseId, {
            language: options?.language,
            customPrompt: options?.customPrompt,
          });
          if (!res.ok || !data.success) {
            throw new Error(res.status === 429 ? buildRateLimitMessage(res) : data?.error ?? "La génération a échoué.");
          }
          resultValue = data.data;
          cached = Boolean(data.cached);
        }

        // UX ILLUSION (product direction) — a cache hit is instant, but the
        // student should still feel like the AI is actively working on it
        // rather than seeing a suspiciously-fast result. The "generating"
        // spinner/rotating label above stays visible for this whole delay,
        // since it's cleared only in the `finally` block below, after this
        // resolves. Never applied to a genuine cache miss — a real generation
        // already takes real time.
        if (cached) {
          await wait(randomFakeDelayMs());
        }

        // Keyed off the cache (not the `activeCourse` closure, which may now
        // point at a different course if the student switched mid-generation)
        // so the cache stays the single source of truth for this id regardless
        // of what's currently on screen.
        const baseCourse = courseCacheRef.current.get(courseId);
        if (baseCourse) {
          // updatedAt bumped to now — mirrors the real `updated_at` bump
          // /api/studio/generate just did server-side, so the "Récemment
          // généré" list's relative-time label reflects this generation
          // immediately, without waiting for a refetch.
          const updated = { ...withSectionValue(baseCourse, id, resultValue), updatedAt: new Date().toISOString() };
          courseCacheRef.current.set(courseId, updated);
          // Only apply to the visible state if the student hasn't switched to a different course while this was generating.
          setActiveCourse((prev) => (prev && prev.id === courseId ? updated : prev));
        }
      } catch (error) {
        toast({
          variant: "error",
          title: tModulePage("toastGenerationFailed", language),
          description: error instanceof Error ? error.message : "Erreur inconnue.",
        });
      } finally {
        setGeneratingByKey((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    })();

    trackGeneration(courseId, id, generationPromise);
    await generationPromise;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCourse, generatingSections, toast, studyYear]);

  /** Stable reference so the desktop ModuleSourcesPanel instance's React.memo actually holds. */
  const handleToggleSourcesCollapsed = useCallback(() => setIsSourcesCollapsed((prev) => !prev), []);

  /**
   * Stable reference so the desktop ModuleSourcesPanel instance's React.memo
   * actually holds. Checking a source the student never "opened" (so it has
   * no cached rawText yet — courseCacheRef only ever holds courses actually
   * loaded via handleSelectCourse/applyCreatedCourse) fetches it in the
   * background, same best-effort pattern as refreshCourseFromServer: no
   * loading spinner, no error toast, since this isn't a direct "open this
   * course" action — a transient failure here just means that source's text
   * is silently missing from the NEXT chat message's context, not a broken
   * experience worth interrupting the student over. Deliberately does NOT
   * touch `activeCourse` — checking a source for chat context must never
   * switch which course's Studio tiles are showing.
   */
  const handleToggleSelectedSource = useCallback((id: number) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        if (!courseCacheRef.current.has(id)) {
          fetch(`/api/studio/courses/${id}`)
            .then((res) => res.json())
            .then((data) => {
              if (data?.success) courseCacheRef.current.set(id, data.course);
            })
            .catch(() => {});
        }
      }
      return next;
    });
  }, []);

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
   *
   * Deliberately does NOT send `documentContext` (the course's raw text)
   * anymore — the backend now fetches it itself from `studio_courses` by
   * `courseId` (see that route's own comment). Previously this resent the
   * full text (up to 60,000 chars) from the browser on every single Studio
   * click, purely a bandwidth cost (it never affected the actual OpenRouter
   * bill either way — Anthropic's cache_control only ever discounts what
   * the SERVER sends to the model, not where the server got it from).
   */
  async function requestStudioGeneration(actionType: DemoSectionId, courseId: number, extra?: Record<string, unknown>) {
    const res = await fetch("/api/studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // studyYear is sent unconditionally (not folded into `extra`) — it
      // must reach the backend for every cas_clinique generation regardless
      // of whether the caller went through the ChevronDown options menu.
      body: JSON.stringify({ actionType, courseId, studyYear, ...extra }),
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
  async function postStudioGenerate(actionType: DemoSectionId, courseId: number, extra?: Record<string, unknown>) {
    let attempt: { res: Response; data: any };
    try {
      attempt = await requestStudioGeneration(actionType, courseId, extra);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempt = await requestStudioGeneration(actionType, courseId, extra);
    }

    if (attempt.res.status === 401) {
      await supabase.auth.getUser();
      attempt = await requestStudioGeneration(actionType, courseId, extra);
    }

    return attempt;
  }

  /**
   * Joins every CHECKED source's raw text (Point 2 — multi-select chat
   * context), not just the single active course. Falls back to the active
   * course alone when nothing is explicitly checked yet (covers the brief
   * window before the seeding effect above has run, and any caller that
   * never touched selectedSourceIds) — never silently sends empty context.
   * A course checked but not yet fetched (see handleToggleSelectedSource)
   * simply contributes nothing yet, rather than blocking the send.
   */
  function buildSelectedSourceText(): string | undefined {
    const ids = selectedSourceIds.size > 0 ? Array.from(selectedSourceIds) : activeCourse ? [activeCourse.id] : [];
    const texts = ids
      .map((id) => courseCacheRef.current.get(id))
      .filter((c): c is StudioCourseFull => Boolean(c?.rawText))
      .map((c) => (ids.length > 1 ? `### ${c.title}\n\n${c.rawText}` : c.rawText));
    return texts.length > 0 ? texts.join("\n\n---\n\n") : undefined;
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
      sourceText: buildSelectedSourceText(),
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
      toast({ variant: "error", title: tModulePage("toastDeleteFailed", language), description: data?.error ?? "Erreur inconnue." });
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
  }, [activeCourse, toast, language]);

  /** "Afficher le cours" — opens FileViewerModal for this course, loading it first if it isn't already the active one. Fully decoupled from the chat/Studio split-screen. */
  const handleShowCourseFile = useCallback(async (courseId: number) => {
    const course = await handleSelectCourse(courseId);
    if (course) setFileViewerCourse(course);
  }, [handleSelectCourse]);

  /** "Regénérer" — see app/api/studio/regenerate/route.ts's own doc comment for why this deliberately never resends the source document. */
  async function handleRegenerateSection(id: DemoSectionId) {
    // Same relaxation as handleStudioItemClick — only THIS id's own
    // regenerate/generate state, on THIS course, blocks it, not an
    // unrelated tile's or the same tile on a different course.
    if (!activeCourse || regeneratingSections.has(id) || generatingSections.has(id)) return;

    const courseId = activeCourse.id;
    const key = sectionKey(courseId, id);
    // "regen:" prefix — a separate tracker namespace from handleStudioItemClick's
    // own generations, since a section can be freshly-generating and
    // regenerating at different points in time but never both at once
    // (guarded above); keeping them distinct avoids one's tracked promise
    // ever being mistaken for the other's.
    const trackerSection = `regen:${id}`;
    setRegeneratingByKey((prev) => new Set(prev).add(key));

    // Same trackGeneration treatment as handleStudioItemClick — see
    // lib/studio-generation-tracker.ts's own comment for the real bug this
    // fixes (the request already survives navigation server-side; only this
    // component's own "is it still running" knowledge didn't, risking a
    // second paid regenerate call).
    const regenerationPromise = (async () => {
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

        // UX ILLUSION (product direction) — see handleStudioItemClick's own
        // identical comment above. A variation served from
        // studio_content_variations without a real OpenRouter call is still a
        // "cache hit" in spirit.
        if (data.cached) {
          await wait(randomFakeDelayMs());
        }

        const baseCourse = courseCacheRef.current.get(courseId);
        if (baseCourse) {
          // updatedAt bumped to now — same reasoning as handleStudioItemClick's own comment above.
          const updated = { ...withSectionValue(baseCourse, id, data.data), updatedAt: new Date().toISOString() };
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
        setRegeneratingByKey((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    })();

    trackGeneration(courseId, trackerSection, regenerationPromise);
    await regenerationPromise;
  }

  /**
   * Point 6 fix, other half — reconciles this page's own "generating"/
   * "regenerating" state against lib/studio-generation-tracker.ts whenever a
   * course becomes active (mount, or switching back to a course). Covers
   * exactly the case handleStudioItemClick's own registration can't: a
   * generation started by a PREVIOUS mount of this same page (before a
   * navigation away) that's still running now. Re-shows the spinner
   * immediately (so a re-click is correctly blocked instead of firing a
   * second paid call) and, once the tracked promise settles, refetches this
   * course fresh from Supabase — the ORIGINAL closure that will eventually
   * update ITS OWN activeCourse/courseCacheRef belongs to that previous,
   * now-unmounted instance, so THIS instance needs its own refresh to pick
   * up the result. Idempotent/harmless for the common case (nothing tracked
   * for this course): every check below is a no-op.
   */
  useEffect(() => {
    if (!activeCourse) return;
    const courseId = activeCourse.id;

    for (const section of DEMO_SECTIONS) {
      const generating = getInFlightGeneration(courseId, section.id);
      if (generating) {
        const key = sectionKey(courseId, section.id);
        setGeneratingByKey((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
        generating.then(() => refreshCourseFromServer(courseId));
      }

      const regenerating = getInFlightGeneration(courseId, `regen:${section.id}`);
      if (regenerating) {
        const key = sectionKey(courseId, section.id);
        setRegeneratingByKey((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
        regenerating.then(() => refreshCourseFromServer(courseId));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCourse?.id]);

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
      <div className="aurora-canvas-bg flex h-dvh items-center justify-center">
        <BrandLoader />
      </div>
    );
  }

  if (notFound || !module) {
    return (
      <div className="aurora-canvas-bg flex h-dvh flex-col items-center justify-center gap-4">
        <p className="text-sm font-medium text-muted-foreground">Ce module est introuvable.</p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-bold text-white shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary-500 hover:shadow-glow"
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
      sources={courses.map((c) => ({ id: c.id, title: c.title }))}
      selectedSourceIds={selectedSourceIds}
      onToggleSource={handleToggleSelectedSource}
      moduleId={moduleId}
      courseTitle={activeCourse?.title}
      courseSlug={courseChatSlug}
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
      courseSlug={courseChatSlug}
      sourceTextLength={activeCourse?.rawText?.length}
    />
  );

  const studioPanel = (
    <StudioPanel
      sections={DEMO_SECTIONS}
      openedSection={openedSection}
      openedLabel={openedSectionLabel}
      studyYear={studyYear}
      onItemClick={handleStudioItemClick}
      onItemClickWithOptions={handleStudioItemClick}
      onCloseSection={() => setOpenedSection(null)}
      getSectionStatus={getSectionStatus}
      generatingSections={generatingSections}
      regeneratingSections={regeneratingSections}
      onRegenerateSection={handleRegenerateSection}
      lastGeneratedAt={activeCourse?.updatedAt ?? null}
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
      sectionMasteryPct={sectionMasteryPct}
    >
      {isSwitchingCourse ? (
        <div className="animate-fade-in flex h-full flex-col items-center justify-center gap-3 py-20">
          <BrandLoader className="h-6 w-6" />
          <p className="text-sm text-muted-foreground">Chargement du cours...</p>
        </div>
      ) : openedSection && generatingSections.has(openedSection) ? (
        <div className="animate-fade-in flex h-full flex-col items-center justify-center gap-3 py-20">
          <BrandLoader className="h-6 w-6" />
          {/* Podcast Audio genuinely takes ~1-4 min (a script-writing call
              plus one streamed ~10-15 min narration) — a rotating,
              feature-specific message reads as "working", where the generic
              static line would read as stalled over that much longer wait. */}
          {openedSection === "audio" ? (
            <PodcastGeneratingLabel className="text-sm text-muted-foreground" />
          ) : (
            <p className="text-sm text-muted-foreground">Génération en cours...</p>
          )}
        </div>
      ) : openedSection && activeCourse && getSectionValue(activeCourse, openedSection) ? (
        <div className="animate-fade-in">
          {openedSection === "explication" && (
            <article dir="auto" className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "max-w-none")}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}>
                {normalizeCallouts(activeCourse.explication!)}
              </ReactMarkdown>
              <ClinicalConnectionsPanel key={activeCourse.id} courseId={activeCourse.id} />
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
              // Shape-based, not studyYear-based: whichever shape was
              // actually stored is what renders, since the student's CURRENT
              // year may differ from the year this content was generated
              // under (see StudioCourseFull.casClinique's own comment).
              "paragraphes" in activeCourse.casClinique ? (
                <ClinicalRelevanceStudio key={activeCourse.id} data={activeCourse.casClinique} />
              ) : (
                <GastriteCasCliniqueStudio
                  key={activeCourse.id}
                  data={{ slug: `studio-course-${activeCourse.id}`, section: "cas_clinique", ...activeCourse.casClinique }}
                />
              )
            )}
            {openedSection === "qcm" && activeCourse.qcms && (
              <GastriteQcmsStudio
                key={activeCourse.id}
                data={activeCourse.qcms}
                courseSlug={`studio-course-${activeCourse.id}`}
                explicationMarkdown={activeCourse.explication ?? undefined}
              />
            )}
            {openedSection === "infographic" && activeCourse.infographicUrl && (
              <InfographicViewer key={activeCourse.id} imageUrl={activeCourse.infographicUrl} courseTitle={activeCourse.title} />
            )}
            {openedSection === "audio" && activeCourse.audioUrl && (
              <AudioPodcastViewer key={activeCourse.id} audioUrl={activeCourse.audioUrl} courseTitle={activeCourse.title} />
            )}
          </Suspense>
        </div>
      ) : openedSection && !activeCourse ? (
        <div className="animate-fade-in flex h-full flex-col items-center justify-center gap-2 py-20 text-center">
          <p className="text-sm font-medium text-foreground">Ajoute une source pour générer ce contenu</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Importe un PDF dans le panneau Sources à gauche, puis reclique sur « {openedSectionLabel} ».
          </p>
        </div>
      ) : null}
    </StudioPanel>
  );

  const panelShellClasses = "glass-card flex flex-col overflow-hidden rounded-3xl shadow-glass transition-all duration-300 dark:shadow-glass-dark";

  return (
    <div className="aurora-canvas-bg relative flex h-dvh flex-col overflow-hidden">
      <div aria-hidden className="aurora-mesh-bg animate-mesh-pulse pointer-events-none fixed inset-0 -z-10" />
      <WorkspaceTopbar title={moduleTitle} />

      {/* Desktop (md+) — the original fixed-width 3-column shell, completely
          unchanged. `isDesktop` (useMediaQuery, not a CSS class) gates which
          of this block or the mobile one below actually mounts, so neither
          pays the cost of the other sitting hidden in the DOM. */}
      {isDesktop && (
        <div className="flex flex-1 flex-row gap-4 overflow-hidden p-4">
          {!isSplitScreen && (
            <aside className={cn(panelShellClasses, "shrink-0 transition-all duration-300", isSourcesCollapsed ? "w-20" : "w-72")}>
              <ModuleSourcesPanel
                courses={courses}
                activeCourseId={activeCourse?.id ?? null}
                isCollapsed={isSourcesCollapsed}
                onToggleCollapse={handleToggleSourcesCollapsed}
                selectedSourceIds={selectedSourceIds}
                onToggleSource={handleToggleSelectedSource}
                isSwitchingCourse={isSwitchingCourse}
                onSubmitFile={handleFileSelected}
                onSubmitText={handleTextSubmitted}
                onRetryWithOcr={handleOcrRetry}
                onSelectCourse={handleSelectCourse}
                onShowCourseFile={handleShowCourseFile}
                onDeleteCourse={handleDeleteCourse}
                courseMasteryBySlug={courseMasteryBySlug}
              />
            </aside>
          )}

          <div
            className={cn(
              "grid flex-1 gap-4 overflow-hidden transition-all duration-300",
              // Was `isSplitScreen ? "...lg:grid-cols-2" : "grid-cols-1"` — that
              // ignored isStudioCollapsed entirely, so collapsing/closing
              // Studio inside split-screen mode left the grid hardcoded at a
              // 50/50 split with an empty collapsed-Studio cell, and Chat never
              // reclaimed the freed width. Collapsed Studio now renders in its
              // own w-20 rail OUTSIDE this grid (below) instead, so Chat's
              // single remaining grid column can genuinely stretch full-width.
              isSplitScreen && !isStudioCollapsed ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
            )}
          >
            {/* min-w-0 on Chat's own cell — Tailwind's grid-cols-2 tracks
                are `minmax(0, 1fr)` with no floor, so without an explicit
                min-width somewhere, a genuinely wide chat message could
                force this 50/50 split to squeeze the Studio cell arbitrarily
                thin (overlapping text, deformed icons) instead of just
                scrolling internally. min-w-0 here restores the normal
                "this cell can shrink, its CONTENT scrolls instead of
                pushing" grid behavior; the real floor is the min-w on
                Studio's own aside below. */}
            <main className={cn(panelShellClasses, "min-w-0")}>{chatPanel}</main>
            {isSplitScreen && !isStudioCollapsed && (
              <aside className={cn(panelShellClasses, "min-w-[260px]")}>{studioPanel}</aside>
            )}
          </div>

          {isSplitScreen && isStudioCollapsed && (
            <aside className={cn(panelShellClasses, "w-20 shrink-0 transition-all duration-300")}>{studioPanel}</aside>
          )}

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
          <div className={cn(panelShellClasses, "m-2 flex-1")}>
            {mobileTab === "sources" && (
              <ModuleSourcesPanel
                variant="mobile"
                courses={courses}
                activeCourseId={activeCourse?.id ?? null}
                isSwitchingCourse={isSwitchingCourse}
                onSubmitFile={handleFileSelected}
                onSubmitText={handleTextSubmitted}
                onRetryWithOcr={handleOcrRetry}
                onSelectCourse={handleSelectCourse}
                onShowCourseFile={handleShowCourseFile}
                onDeleteCourse={handleDeleteCourse}
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
                  generatingSections={generatingSections}
                  onItemClick={handleStudioItemClick}
                  onItemClickWithOptions={handleStudioItemClick}
                  studyYear={studyYear}
                  sectionMasteryPct={sectionMasteryPct}
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
