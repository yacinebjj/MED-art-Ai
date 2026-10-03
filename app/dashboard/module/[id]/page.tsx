"use client";

import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  BookOpen,
  Camera,
  Check,
  ClipboardCheck,
  Columns2,
  FileText,
  Focus,
  FolderOpen,
  Globe,
  LayoutDashboard,
  Loader2,
  MessageSquarePlus,
  MonitorCog,
  MoreVertical,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Rows3,
  Search,
  Settings,
  SquarePen,
  SunMoon,
  Trash2,
  TrendingUp,
  Workflow,
  X,
} from "lucide-react";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { ClinicalConnectionsPanel } from "@/components/course/workspace/ClinicalConnectionsPanel";
import { useLanguage } from "@/providers/LanguageProvider";
import { useAuth } from "@/providers/AuthProvider";
import { tModulePage } from "@/lib/translations/modulePage";
import { getSectionLabel } from "@/lib/translations/studio";
import { cn } from "@/lib/utils";
import { buildRateLimitMessage, buildRateLimitMessageFromSeconds } from "@/lib/rate-limit-message";
import { uploadDocumentDirect, retryUploadWithOcr } from "@/lib/upload-client";
import { generateExplicationInParts } from "@/lib/studio-explication-client";
import { postJsonWithHeartbeat } from "@/lib/heartbeat-fetch";
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
import { WorkspaceCommandBar, type WorkspaceSyncState } from "@/components/course/workspace/os/WorkspaceCommandBar";
import { CommandPalette, type CommandItem } from "@/components/course/workspace/os/CommandPalette";
import { ResizeHandle } from "@/components/course/workspace/os/ResizeHandle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { ChatDocumentPanel, CHAT_MODE_OPTIONS, type ChatDocumentPanelHandle } from "@/components/course/workspace/ChatDocumentPanel";
import { SOURCES_WIDTH, STUDIO_WIDTH, useWorkspaceLayout } from "@/hooks/useWorkspaceLayout";
import { useHotkeys, useModKeyLabel } from "@/hooks/useHotkeys";
import { LAB_TOOLS, type LabToolId } from "@/lib/workspace-lab";
// Global AI-content language: read at REQUEST time (getContentLanguage), so a
// plain tile click generates in the language chosen anywhere in the app — not
// only when the student opens a tile's options popover.
import { getContentLanguage } from "@/store/useLanguageStore";
import type { ChatMode } from "@/lib/chat-constants";
import type { CitationSourceText } from "@/lib/chat-citations";
import { ACCEPTED_FILE_TYPES } from "@/lib/constants";
import { OcrSuggestedError } from "@/lib/upload-client";
import type { CurriculumYearData } from "@/types/academic";
import { QCM_REGENERATE_CAP, StudioPanel, type SectionStatus, type TileGenerationOptions } from "@/components/course/workspace/StudioPanel";
import { FileViewerModal } from "@/components/course/workspace/FileViewerModal";
import { StudioTileSkeleton } from "@/components/course/workspace/StudioTileSkeleton";
import { MobileWorkspaceTabBar, type MobileWorkspaceTab } from "@/components/course/workspace/MobileWorkspaceTabBar";
import { MobileStudioCards } from "@/components/course/workspace/MobileStudioCards";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useCourseChat } from "@/hooks/useCourseChat";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { MAX_LEITNER_BOX } from "@/lib/srs";
import { DARK_MARKDOWN_COMPONENTS, DARK_PROSE_CLASSES, MARKDOWN_COMPONENTS, PROSE_CLASSES, normalizeCallouts } from "@/lib/markdown";
import { DEMO_SECTIONS, buildQuotedChatMessage, type DemoSectionId } from "@/lib/demo-content";
import { getInFlightGeneration, trackGeneration } from "@/lib/studio-generation-tracker";
import { PodcastGeneratingLabel } from "@/components/course/workspace/PodcastGeneratingLabel";
import { ExplicationGeneratingLabel, type ExplicationProgressView } from "@/components/course/workspace/ExplicationGeneratingLabel";
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

// MedArt Lab tools — same code-splitting reasoning as the Studio tiles
// above: each is a full interactive engine most visits never open.
const ClinicalCaseSimulator = dynamic(
  () => import("@/components/course/workspace/lab/ClinicalCaseSimulator").then((m) => m.ClinicalCaseSimulator),
  { ssr: false, loading: () => <StudioTileSkeleton /> }
);
const MedicalMatrixStudio = dynamic(
  () => import("@/components/course/workspace/lab/MedicalMatrixStudio").then((m) => m.MedicalMatrixStudio),
  { ssr: false, loading: () => <StudioTileSkeleton /> }
);
const MindMapLab = dynamic(
  () => import("@/components/course/workspace/lab/MindMapLab").then((m) => m.MindMapLab),
  { ssr: false, loading: () => <StudioTileSkeleton /> }
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

/**
 * Every real shape a generated section's value can take — one member per
 * StudioCourseFull field this function can write to. Not a per-`section`
 * discriminated match (that would need the CALLER's `resultValue`, which
 * comes from more than one generation pathway, to already be narrowed by
 * section — a larger change than this function's own scope) but still a
 * real, closed type: it rejects anything that isn't a genuine section value
 * shape, which a bare `any` did not.
 */
type StudioSectionValue =
  | StudioCourseFull["explication"]
  | StudioCourseFull["resume"]
  | StudioCourseFull["casClinique"]
  | StudioCourseFull["qcms"]
  | StudioCourseFull["exemplesAnalogies"]
  | StudioCourseFull["infographicUrl"]
  | StudioCourseFull["audioUrl"];

/** The `{success, data, error, cached}` shape /api/studio/generate actually returns — `data` stays `unknown` deliberately, since its real shape depends on which `actionType` was requested; it only becomes a `StudioSectionValue` once withSectionValue's own explicit cast is applied, at the one call site that already knows which section it is. */
interface StudioGenerateResponse {
  success: boolean;
  error?: string;
  data?: unknown;
  cached?: boolean;
}

function withSectionValue(course: StudioCourseFull, section: DemoSectionId, value: StudioSectionValue): StudioCourseFull {
  // A per-case cast is still needed here: TS narrows `section` inside each
  // branch, but has no way to correlate that with `value`'s type, since
  // `value` isn't itself a member of a union discriminated by `section` (see
  // StudioSectionValue's own comment for why — that would need the CALLER's
  // return value, which comes from more than one generation pathway, to
  // already be tagged by section). Each cast asserts exactly the single
  // field type that case writes to — narrower than the last `any` was, and
  // it's what actually catches a wrong TYPE FAMILY (e.g. a bare number, or
  // an object shape matching none of the seven real sections) at the call
  // site below, which `any` did not.
  switch (section) {
    case "explication":
      return { ...course, explication: value as StudioCourseFull["explication"] };
    case "resume":
      return { ...course, resume: value as StudioCourseFull["resume"] };
    case "cas_clinique":
      return { ...course, casClinique: value as StudioCourseFull["casClinique"] };
    case "qcm":
      return { ...course, qcms: value as StudioCourseFull["qcms"] };
    case "exemples_analogies":
      return { ...course, exemplesAnalogies: value as StudioCourseFull["exemplesAnalogies"] };
    case "infographic":
      return { ...course, infographicUrl: value as StudioCourseFull["infographicUrl"] };
    case "audio":
      return { ...course, audioUrl: value as StudioCourseFull["audioUrl"] };
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

// Color-coded by real file extension (this app's own lucide set has no
// brand-specific PDF/Word/PowerPoint glyphs, so the honest way to visually
// distinguish source types — matching the request's "distinct file type
// badges" ask — is by color + a short type label, not a fake per-format
// icon). A course's title IS its original filename (see the upload flow),
// so its own extension is real, not inferred/guessed.
const FILE_TYPE_STYLES: Record<string, { label: string; className: string }> = {
  pdf: { label: "PDF", className: "bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400" },
  docx: { label: "DOCX", className: "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400" },
  pptx: { label: "PPTX", className: "bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400" },
  txt: { label: "TXT", className: "bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400" },
};
function fileTypeStyleFor(title: string): { label: string; className: string } {
  const ext = title.split(".").pop()?.toLowerCase() ?? "";
  return FILE_TYPE_STYLES[ext] ?? { label: "DOC", className: "bg-primary-50 text-primary-600 dark:bg-primary-950/30 dark:text-primary-400" };
}

/** One full-text hit inside a source's extracted text (Sources panel search). */
export interface SourceSearchHit {
  courseId: number;
  courseTitle: string;
  before: string;
  match: string;
  after: string;
}

const SEARCH_COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");
const MAX_HITS_PER_SOURCE = 3;

/**
 * Accent/case-insensitive search through every loaded course's extracted
 * text. Normalization keeps string length 1:1 (each character is folded on
 * its own), so a match index in the folded text is the same index in the
 * original — the snippet is cut from the real text.
 */
function searchCourseTexts(courses: StudioCourseFull[], query: string): SourceSearchHit[] {
  // Per UTF-16 code unit, so the folded string's indices line up exactly
  // with the original's (a character whose folded form isn't exactly one
  // unit — a lone combining mark, a surrogate half — is kept as-is).
  const fold = (text: string) => {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const folded = text[i].normalize("NFD").replace(SEARCH_COMBINING_MARKS, "").toLowerCase();
      out += folded.length === 1 ? folded : text[i];
    }
    return out;
  };
  const needle = fold(query.trim());
  if (needle.length < 3) return [];
  const hits: SourceSearchHit[] = [];
  for (const course of courses) {
    const original = course.rawText ?? "";
    const folded = fold(original);
    let from = 0;
    let found = 0;
    while (found < MAX_HITS_PER_SOURCE) {
      const at = folded.indexOf(needle, from);
      if (at === -1) break;
      const start = Math.max(0, at - 70);
      const end = Math.min(original.length, at + needle.length + 90);
      hits.push({
        courseId: course.id,
        courseTitle: course.title,
        before: `${start > 0 ? "…" : ""}${original.slice(start, at)}`.replace(/\s+/g, " "),
        match: original.slice(at, at + needle.length),
        after: `${original.slice(at + needle.length, end)}${end < original.length ? "…" : ""}`.replace(/\s+/g, " "),
      });
      found++;
      from = at + needle.length;
    }
  }
  return hits;
}

const GENERATED_SECTION_FIELDS: (keyof StudioCourseFull)[] = ["explication", "resume", "casClinique", "qcms", "exemplesAnalogies", "infographicUrl", "audioUrl"];

function courseMeta(course: StudioCourseFull | undefined): string | null {
  if (!course) return null;
  const words = course.rawText ? course.rawText.trim().split(/\s+/).length : 0;
  const generated = GENERATED_SECTION_FIELDS.filter((field) => Boolean(course[field])).length;
  return `${words.toLocaleString("fr-FR")} mots · ${generated}/${GENERATED_SECTION_FIELDS.length} sections`;
}

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
  uploadRequestNonce = 0,
  loadedCourses,
  onSearchSources,
  onViewSourceFile,
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
  /** Bumped by the caller (command palette "Ajouter une source") to open the upload modal from outside this panel. */
  uploadRequestNonce?: number;
  /** Full rows already loaded client-side — powers each card's word-count / generated-sections line. */
  loadedCourses?: Map<number, StudioCourseFull>;
  /** Full-text search through the module's sources (loads any course not fetched yet). Optional: omitted, the search box only searches the web. */
  onSearchSources?: (query: string) => Promise<SourceSearchHit[]>;
  /** Opens a source's document without making it the active course (search hits). Falls back to onShowCourseFile. */
  onViewSourceFile?: (id: number) => void;
}) {
  const { language } = useLanguage();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [statsCourse, setStatsCourse] = useState<StudioCourseSummary | null>(null);
  const [deleteCourse, setDeleteCourse] = useState<StudioCourseSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [webSearchQuery, setWebSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SourceSearchHit[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const searchRunRef = useRef(0);
  // Starts at the nonce current on mount — a request consumed by a previous
  // instance (before Zen / split-screen / a mobile tab switch remounted this
  // panel) must not pop the modal open again.
  const consumedUploadNonceRef = useRef(uploadRequestNonce);

  useEffect(() => {
    if (uploadRequestNonce === consumedUploadNonceRef.current) return;
    consumedUploadNonceRef.current = uploadRequestNonce;
    setUploadOpen(true);
  }, [uploadRequestNonce]);

  // Debounced in-source search — every keystroke past 3 characters reruns
  // it 250 ms after typing stops; a stale (superseded) run never overwrites
  // a newer one's results.
  useEffect(() => {
    const query = webSearchQuery.trim();
    if (!onSearchSources || query.length < 3) {
      searchRunRef.current++;
      setSearchHits(null);
      setIsSearching(false);
      return;
    }
    const run = ++searchRunRef.current;
    setIsSearching(true);
    const timer = setTimeout(() => {
      onSearchSources(query)
        .then((hits) => {
          if (run === searchRunRef.current) setSearchHits(hits);
        })
        .catch(() => {
          if (run === searchRunRef.current) setSearchHits([]);
        })
        .finally(() => {
          if (run === searchRunRef.current) setIsSearching(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [webSearchQuery, onSearchSources]);

  function openWebSearch() {
    const query = webSearchQuery.trim();
    if (!query) return;
    window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
  }

  function handleWebSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setWebSearchQuery("");
      return;
    }
    if (e.key !== "Enter") return;
    // Enter searches the web only when there's no in-source search to show.
    if (!onSearchSources) openWebSearch();
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
        <div className={cn("flex h-12 shrink-0 items-center border-b border-[color-mix(in_oklab,var(--border)_70%,transparent)] px-2 md:h-14 md:px-4", isRail ? "justify-center" : "justify-between")}>
          {!isRail && (
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FolderOpen className="h-4 w-4 text-primary-500" />
              {tModulePage("sourcesHeading", language)}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">{courses.length}</span>
              {selectedSourceIds && selectedSourceIds.size > 0 && (
                <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-primary-700 dark:bg-primary-900/50 dark:text-primary-300">
                  {selectedSourceIds.size} en contexte
                </span>
              )}
            </h2>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label={tModulePage(isRail ? "openPanelAriaLabel" : "collapsePanelAriaLabel", language)}
                aria-pressed={isRail}
                className="rounded-xl p-2 text-muted-foreground transition-all duration-300 hover:bg-accent hover:text-foreground active:scale-[0.94]"
              >
                {isRail ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{tModulePage(isRail ? "openPanelAriaLabel" : "collapsePanelAriaLabel", language)}</TooltipContent>
          </Tooltip>
        </div>
      )}

      <div className={cn("flex flex-1 flex-col overflow-y-auto", isRail ? "items-center space-y-1.5 p-2" : "space-y-4 p-4")}>
        {variant === "desktop" && !isRail && (
          <>
            {/* Always enabled — adding a 2nd, 3rd, ... course never disables this, per the multi-course mandate. */}
            <Button variant="outline" size="sm" className="w-full rounded-xl border-dashed" onClick={() => setUploadOpen(true)}>
              <Plus className="h-4 w-4" />
              {tModulePage("addSourceLabel", language)}
            </Button>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={onSearchSources ? "Rechercher dans tes sources…" : tModulePage("searchWebPlaceholder", language)}
                value={webSearchQuery}
                onChange={(e) => setWebSearchQuery(e.target.value)}
                onKeyDown={handleWebSearchKeyDown}
                aria-label="Rechercher dans tes sources"
                className="border-none bg-muted pl-9 pr-16 shadow-none"
              />
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                {isSearching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                {webSearchQuery && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={openWebSearch}
                        aria-label="Rechercher sur le web"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                      >
                        <Globe className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Rechercher « {webSearchQuery.trim()} » sur le web</TooltipContent>
                  </Tooltip>
                )}
                {webSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setWebSearchQuery("")}
                    aria-label="Effacer la recherche"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <AnimatePresence initial={false}>
              {searchHits !== null && (
                <motion.div
                  key="search-results"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-1.5 rounded-2xl border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--background)_60%,transparent)] p-2">
                    <p className="px-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      {searchHits.length === 0 ? "Aucun passage trouvé" : `${searchHits.length} passage${searchHits.length > 1 ? "s" : ""} trouvé${searchHits.length > 1 ? "s" : ""}`}
                    </p>
                    {searchHits.map((hit, index) => (
                      <button
                        key={`${hit.courseId}-${index}`}
                        type="button"
                        onClick={() => (onViewSourceFile ?? onShowCourseFile)(hit.courseId)}
                        className="block w-full rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-accent"
                      >
                        <span className="block truncate text-[11px] font-semibold text-primary-700 dark:text-primary-300">{hit.courseTitle}</span>
                        <span className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                          {hit.before}
                          <mark className="rounded bg-primary-200/70 px-0.5 font-semibold text-foreground dark:bg-primary-500/30">{hit.match}</mark>
                          {hit.after}
                        </span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
              <FileText className="h-6 w-6 text-[color-mix(in_oklab,var(--muted-foreground)_50%,transparent)]" />
            </motion.div>
            <p className="text-sm font-medium text-muted-foreground">{tModulePage("noSourcesEmptyState", language)}</p>
            <p className="text-xs text-[color-mix(in_oklab,var(--muted-foreground)_70%,transparent)]">
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
                      title={isChecked ? "Retirer du contexte du co-pilote" : "Ajouter au contexte du co-pilote"}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSource(course.id);
                      }}
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                        isChecked
                          ? "border-primary-500 bg-primary-500 text-white"
                          : "border-[color-mix(in_oklab,var(--muted-foreground)_40%,transparent)] bg-transparent hover:border-primary-400"
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
                    <span
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[9px] font-bold tracking-wide",
                        fileTypeStyleFor(course.title).className
                      )}
                      aria-hidden
                    >
                      {fileTypeStyleFor(course.title).label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm font-medium", isActive ? "text-primary-900 dark:text-primary-200" : "text-foreground")} title={course.title}>
                        {course.title}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {isActive && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-600 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white dark:bg-primary-500">
                            <span className="h-1 w-1 rounded-full bg-white" />
                            Ouvert
                          </span>
                        )}
                        <span className="truncate">
                          {courseMeta(loadedCourses?.get(course.id)) ?? (isActive ? tModulePage("activeCourseLabel", language) : tModulePage("clickToOpenLabel", language))}
                        </span>
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

  // Mobile keyboard handling for the Chat tab — same two-part fix already
  // proven on app/dashboard/(shell)/assistant/page.tsx (this page renders its
  // own standalone shell instead of the dashboard (shell) layout, so it never
  // got either half of that fix "for free"):
  //  1. useKeyboardInset() — iOS Safari doesn't shrink `h-dvh` for the
  //     on-screen keyboard at all, so without this the keyboard simply
  //     overlaid the bottom of the page with nothing reflowing underneath it.
  //     Applied as bottom padding on the mobile column below (see its own
  //     comment for why padding, not a replacement height).
  //  2. isMobileChatInputFocused — hides MobileWorkspaceTabBar the instant
  //     the composer is focused (mirroring MobileBottomNav's identical
  //     focus-driven hide in the shell layout), so the tab bar never sits
  //     uselessly underneath the keyboard and the composer gets the reclaimed
  //     space instead.
  const keyboardInset = useKeyboardInset();
  const [isMobileChatInputFocused, setIsMobileChatInputFocused] = useState(false);

  const chatPanelRef = useRef<ChatDocumentPanelHandle>(null);
  const [isSplitScreen, setIsSplitScreen] = useState(false);

  // --- MedArt OS shell state ---------------------------------------------
  const router = useRouter();
  const { setTheme } = useTheme();
  const modKey = useModKeyLabel();
  const { layout, resizeSources, resizeStudio, resetSources, resetStudio, setDensity } = useWorkspaceLayout();
  const isCompact = layout.density === "compact";
  /** Zen / Focus mode: only the co-pilot stays on screen (Sources and Studio hidden). */
  const [isZen, setIsZen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("standard");
  const [openedLabTool, setOpenedLabTool] = useState<LabToolId | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  /** Notes in "Mes notes" tied to this module — null until the first fetch lands. */
  const [notesCount, setNotesCount] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  /** Bumped whenever courseCacheRef gains a row outside a state update (background fetches), so memos reading the cache recompute. */
  const [cacheVersion, setCacheVersion] = useState(0);
  const [uploadsInFlight, setUploadsInFlight] = useState(0);
  const [uploadRequestNonce, setUploadRequestNonce] = useState(0);
  const [paletteModules, setPaletteModules] = useState<{ id: number; title: string }[] | null>(null);

  // The answer mode is a per-student habit, not a per-visit one.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("medart:chat-mode");
      if (stored && CHAT_MODE_OPTIONS.some((option) => option.id === stored)) setChatMode(stored as ChatMode);
    } catch {
      // Storage blocked — the default mode is fine.
    }
  }, []);

  const handleChatModeChange = useCallback((mode: ChatMode) => {
    setChatMode(mode);
    try {
      window.localStorage.setItem("medart:chat-mode", mode);
    } catch {
      // Storage blocked — the mode still applies for this visit.
    }
  }, []);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  /** Total notes in "Mes notes", read from the server — never guessed client-side (a save may append to an existing module note rather than create one). */
  const refreshNotesCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notes");
      const data = (await res.json().catch(() => null)) as { success?: boolean; notes?: unknown[] } | null;
      if (res.ok && data?.success && Array.isArray(data.notes)) setNotesCount(data.notes.length);
    } catch {
      // The counter simply keeps its last value (or stays hidden).
    }
  }, []);

  useEffect(() => {
    void refreshNotesCount();
  }, [refreshNotesCount]);

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
  useEffect(() => {
    if (window.innerWidth < 1024) setIsSourcesCollapsed(true);
  }, []);
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
  // the id as already "generating" globally and did nothing. `generatingSections`
  // below is the derived, ACTIVE-course-scoped view StudioPanel/MobileStudioCards
  // actually consume — their own Set<DemoSectionId> contract is unchanged,
  // only this page's bookkeeping became course-aware.
  const [generatingByKey, setGeneratingByKey] = useState<Set<string>>(() => new Set());
  const activeCourseIdForSections = activeCourse?.id ?? null;
  const generatingSections = useMemo(() => scopeToActiveCourse(generatingByKey, activeCourseIdForSections), [generatingByKey, activeCourseIdForSections]);
  // "Régénérer" (Examen QCM ONLY, capped at QCM_REGENERATE_CAP per course) —
  // same course-scoped bookkeeping as generatingByKey above, kept separate
  // because a section can be regenerating while it already HAS content.
  const [regeneratingByKey, setRegeneratingByKey] = useState<Set<string>>(() => new Set());
  const regeneratingSections = useMemo(() => scopeToActiveCourse(regeneratingByKey, activeCourseIdForSections), [regeneratingByKey, activeCourseIdForSections]);
  // Bumped after each successful QCM regeneration and folded into the quiz's
  // React key: the new set reuses question ids 1..15, so without a remount
  // the quiz's internal answer state would carry the OLD answers onto the
  // NEW questions.
  const [qcmRegenNonce, setQcmRegenNonce] = useState(0);
  // Live per-part progress for the multi-request Explication pipeline — see
  // the onProgress call site below for why surfacing this matters.
  const [explicationProgress, setExplicationProgress] = useState<ExplicationProgressView | null>(null);
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
  // Sent with every chat turn: the checked sources become the server-side
  // RAG context (ownership-checked there), `structured` turns on the medical
  // callouts + verifiable citations this page renders.
  const chatRequestExtras = useMemo(
    () => ({ mode: chatMode, sourceCourseIds: Array.from(selectedSourceIds), structured: true }),
    [chatMode, selectedSourceIds]
  );
  const { chatMessages, chatInput, setChatInput, isTyping, isStreaming, sendChatMessage, regenerateFrom, clearMessages } = useCourseChat(courseChatSlug, chatRequestExtras);
  /** True from send until the reply has fully streamed — the guard against a second overlapping request. */
  const isChatBusy = isTyping || isStreaming;

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
  /** Régénérations de l'Examen QCM restantes pour le cours ouvert (undefined tant que le serveur ne l'a pas renvoyé). */
  const qcmRegenerationsLeft =
    activeCourse?.qcmRegenerateCount !== undefined ? Math.max(0, QCM_REGENERATE_CAP - activeCourse.qcmRegenerateCount) : undefined;

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
            body: JSON.stringify({ courseId, language: options?.language ?? getContentLanguage(), model: options?.model }),
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
          // Studio tile (a script-writing call plus one streamed audio
          // narration, ~1-4 min total). Uses postJsonWithHeartbeat — the
          // route streams a heartbeat over one held-open connection while it
          // works (see that route's own header comment for why this, not a
          // background-job/poll design, is the architecture actually proven
          // reliable this session: a live diagnostic proved a real
          // OpenRouter call run via `waitUntil` can hang for 450+ seconds
          // and never resolve, while the same call directly awaited in the
          // foreground completes reliably).
          // postJsonWithHeartbeat never throws — every outcome carries a
          // `diagnostic` string naming concretely what happened (see
          // lib/heartbeat-fetch.ts's own comment), appended below so a
          // failure toast is actual forensic evidence, not another bare
          // "échec de génération".
          const outcome = await postJsonWithHeartbeat("/api/studio/podcast", { courseId, dialect: options?.dialect ?? (getContentLanguage() === "en" ? "en" : undefined) }, 320_000);
          if (!outcome.ok || outcome.data.success !== true) {
            const baseError =
              outcome.status === 429
                ? buildRateLimitMessageFromSeconds(outcome.retryAfterSeconds)
                : typeof outcome.data.error === "string"
                  ? outcome.data.error
                  : "La génération a échoué.";
            throw new Error(`${baseError} [${outcome.diagnostic}]`);
          }
          resultValue = outcome.data.audioUrl;
          cached = Boolean(outcome.data.cached);
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
          // onProgress is what makes the per-part retry/subdivision recovery
          // VISIBLE. It used to be omitted entirely, so a part quietly
          // retrying for minutes looked identical to a frozen app — which is
          // exactly how a real production report concluded "the client did
          // NOT auto-retry" about logic that was in fact retrying.
          const result = await generateExplicationInParts(
            courseId,
            { language: options?.language ?? getContentLanguage(), customPrompt: options?.customPrompt },
            (progress) => setExplicationProgress(progress)
          );
          setExplicationProgress(null);
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
            language: options?.language ?? getContentLanguage(),
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
          // `resultValue` is genuinely `unknown` here — it's assigned from
          // one of several different generation call sites above
          // (postStudioGenerate, the Explication pipeline, the podcast
          // route), each with its own real response shape, and none of them
          // narrow it by `id`/`section` before this point. This cast is the
          // one place that trust boundary is crossed, made explicit instead
          // of silent — see withSectionValue's own comment for the rest of
          // the story.
          const updated = {
            ...withSectionValue(baseCourse, id, resultValue as StudioSectionValue),
            updatedAt: new Date().toISOString(),
          };
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
        // Cleared here too (not only on the success path) so a failed
        // Explication never leaves a stale "Partie 3/7 — tentative 2" label
        // behind for the next generation to inherit.
        setExplicationProgress(null);
      }
    })();

    trackGeneration(courseId, id, generationPromise);
    await generationPromise;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCourse, generatingSections, toast, studyYear]);

  /**
   * "Régénérer" in the Examen QCM tile's ⋮ menu — a brand new set of
   * questions from the same course (app/api/studio/regenerate). The server
   * enforces QCM_REGENERATE_CAP per course atomically (reserve_qcm_regenerate)
   * and answers with how many remain; that number is mirrored onto the course
   * (qcmRegenerateCount) so the menu entry disables itself at the limit
   * without another round trip. Registered with trackGeneration under a
   * separate "regen:" namespace so leaving the page mid-regeneration can't
   * lead to a second paid call on return (see the reconciliation effect).
   * Only ever reachable for "qcm" — no other tile or Lab tool has the entry.
   */
  const handleRegenerateSection = useCallback(async (id: DemoSectionId) => {
    if (id !== "qcm") return;
    if (!activeCourse || regeneratingSections.has(id) || generatingSections.has(id)) return;
    if (QCM_REGENERATE_CAP - (activeCourse.qcmRegenerateCount ?? 0) <= 0) {
      toast({ variant: "error", title: "Limite atteinte", description: `Tu as utilisé tes ${QCM_REGENERATE_CAP} régénérations pour l'Examen QCM de ce cours.` });
      return;
    }

    const courseId = activeCourse.id;
    const key = sectionKey(courseId, id);
    setRegeneratingByKey((prev) => new Set(prev).add(key));

    const regenerationPromise = (async () => {
      try {
        const res = await fetch("/api/studio/regenerate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ courseId, section: id, language: getContentLanguage() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          // The server is the authority on the cap: when it says 0 remain, sync the counter so the entry disables.
          if (typeof data?.remaining === "number" && data.remaining <= 0) {
            const base = courseCacheRef.current.get(courseId);
            if (base) {
              const synced = { ...base, qcmRegenerateCount: QCM_REGENERATE_CAP };
              courseCacheRef.current.set(courseId, synced);
              setActiveCourse((prev) => (prev && prev.id === courseId ? synced : prev));
            }
          }
          throw new Error(res.status === 429 ? buildRateLimitMessage(res) : data?.error ?? "La régénération a échoué.");
        }

        const remaining = typeof data.remaining === "number" ? data.remaining : null;
        const baseCourse = courseCacheRef.current.get(courseId);
        if (baseCourse) {
          const updated = {
            ...withSectionValue(baseCourse, id, data.data as StudioSectionValue),
            ...(remaining !== null ? { qcmRegenerateCount: QCM_REGENERATE_CAP - remaining } : {}),
            updatedAt: new Date().toISOString(),
          };
          courseCacheRef.current.set(courseId, updated);
          setActiveCourse((prev) => (prev && prev.id === courseId ? updated : prev));
        }
        setQcmRegenNonce((n) => n + 1);

        toast({
          variant: "success",
          title: "Nouvelle série de QCM générée",
          description:
            remaining === null
              ? undefined
              : remaining > 0
                ? `Il te reste ${remaining} régénération${remaining > 1 ? "s" : ""} pour ce cours.`
                : "C'était ta dernière régénération pour ce cours.",
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

    trackGeneration(courseId, `regen:${id}`, regenerationPromise);
    await regenerationPromise;
  }, [activeCourse, regeneratingSections, generatingSections, toast]);

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
              if (data?.success) {
                courseCacheRef.current.set(id, data.course);
                setCacheVersion((v) => v + 1);
              }
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
  async function requestStudioGeneration(
    actionType: DemoSectionId,
    courseId: number,
    extra?: Record<string, unknown>
  ): Promise<{ res: Response; data: StudioGenerateResponse }> {
    const res = await fetch("/api/studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // studyYear is sent unconditionally (not folded into `extra`) — it
      // must reach the backend for every cas_clinique generation regardless
      // of whether the caller went through the ChevronDown options menu.
      body: JSON.stringify({ actionType, courseId, studyYear, ...extra }),
    });
    const data = (await res.json().catch(() => ({}))) as StudioGenerateResponse;
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
    let attempt: { res: Response; data: StudioGenerateResponse };
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

  // Course context for the chat is resolved SERVER-side from the checked
  // sources' indexed chunks (chatRequestExtras.sourceCourseIds — see
  // app/api/courses/chat/route.ts). This page used to also inline every
  // checked course's full raw text as `sourceText` on each message: the
  // route never reads that field, so it was pure upload weight — and with a
  // few long polycops checked it could push the request past the
  // platform's ~4.5 MB body ceiling and fail the message outright.
  function handleSend() {
    const text = chatInput.trim();
    if (!text) return;
    if (isChatBusy) return;

    setChatInput("");
    sendChatMessage(text);
  }

  /** Starter suggestions and Lab tools ("Approfondir dans le chat") — sends a ready-made prompt straight away, bringing the chat into view first. */
  function handleSendPrompt(prompt: string) {
    if (isChatBusy) {
      toast({ variant: "error", title: "MedArt répond déjà", description: "Attends la fin de la réponse en cours." });
      return;
    }
    if (!activeCourse) {
      toast({ variant: "info", title: "Ajoute une source", description: "Importe d'abord un cours dans Sources pour discuter avec le co-pilote." });
      return;
    }
    setIsZen(false);
    if (!isDesktop) setMobileTab("chat");
    sendChatMessage(prompt);
  }

  /**
   * Shared by "Ask MedArt" and "Translate". These USED to only stage the
   * selection as a quote (setQuotedText/setQuotedMode) and silently wait for
   * the student to notice the citation chip and press Send themselves — from
   * a student's perspective that read as "I clicked the button and nothing
   * happened", which is exactly the "doesn't work / inconsistent" complaint
   * this was rewritten to fix. Both quick actions now send immediately: the
   * quote + question appear as a real chat bubble right away and the reply
   * starts streaming in, with no extra manual step required on either
   * desktop or mobile.
   *
   * Still switches to the chat view first (split-screen on desktop, the Chat
   * tab on mobile) so the new message/reply is actually visible the instant
   * it's sent — this is the one part of the old staging behavior worth
   * keeping, and keeping it identical on both layouts is what makes the two
   * platforms behave consistently instead of diverging here.
   */
  function sendSelectionQuickAction(text: string, mode: "ask" | "translate") {
    // Mirrors handleSend's own guard — never fire a second overlapping
    // request while one is still streaming in.
    if (isChatBusy) {
      toast({ variant: "error", title: "MedArt répond déjà", description: "Attends la fin de la réponse en cours." });
      return;
    }

    if (isDesktop) {
      setIsSplitScreen(true);
    } else {
      setMobileTab("chat");
    }

    const isTranslate = mode === "translate";
    // Any question the student had already been typing before selecting
    // text is preserved as their question/instruction alongside the quote,
    // exactly as the old manual-Send flow would have combined them —
    // switching to instant-send must not silently discard it.
    const typedText = chatInput.trim();
    const fullMessage = buildQuotedChatMessage(
      text,
      typedText || (isTranslate ? "Traduis ce texte médical sélectionné." : "")
    );
    setChatInput("");
    sendChatMessage(fullMessage, {
      concise: !isTranslate,
      translate: isTranslate,
      excludeFromHistory: true,
      selectedText: text,
    });
  }

  function handleAskSelection(text: string) {
    sendSelectionQuickAction(text, "ask");
  }

  function handleTranslateSelection(text: string) {
    sendSelectionQuickAction(text, "translate");
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

  /**
   * Opens a source's document WITHOUT making it the active course — used by
   * citation chips and source-search hits. Switching the active course
   * would swap the chat to that course's own thread (history is per
   * course), wiping the conversation the student was reading.
   */
  const handleViewSourceFile = useCallback(
    async (courseId: number) => {
      const cached = courseCacheRef.current.get(courseId);
      if (cached) {
        setFileViewerCourse(cached);
        return;
      }
      try {
        const res = await fetch(`/api/studio/courses/${courseId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data?.error ?? "Impossible de charger ce cours.");
        courseCacheRef.current.set(courseId, data.course);
        setCacheVersion((v) => v + 1);
        setFileViewerCourse(data.course as StudioCourseFull);
      } catch (error) {
        toast({ variant: "error", title: tModulePage("toastLoadFailed", language), description: error instanceof Error ? error.message : "Erreur inconnue." });
      }
    },
    [toast, language]
  );

  /** "Afficher le cours" — opens FileViewerModal for this course, loading it first if it isn't already the active one. Fully decoupled from the chat/Studio split-screen. */
  const handleShowCourseFile = useCallback(async (courseId: number) => {
    const course = await handleSelectCourse(courseId);
    if (course) setFileViewerCourse(course);
  }, [handleSelectCourse]);

  /**
   * Point 6 fix, other half — reconciles this page's own "generating"
   * state against lib/studio-generation-tracker.ts whenever a course becomes
   * active (mount, or switching back to a course). Covers exactly the case
   * handleStudioItemClick's own registration can't: a generation started by a
   * PREVIOUS mount of this same page (before a navigation away) that's still
   * running now. Re-shows the spinner immediately (so a re-click is
   * correctly blocked instead of firing a second paid call) and, once the
   * tracked promise settles, refetches this course fresh from Supabase — the
   * ORIGINAL closure that will eventually update ITS OWN activeCourse/
   * courseCacheRef belongs to that previous, now-unmounted instance, so THIS
   * instance needs its own refresh to pick up the result. Idempotent/harmless
   * for the common case (nothing tracked for this course): every check below
   * is a no-op.
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
      // Same for an Examen QCM "Régénérer" still running from a previous visit.
      const regenerating = getInFlightGeneration(courseId, `regen:${section.id}`);
      if (regenerating) {
        const key = sectionKey(courseId, section.id);
        setRegeneratingByKey((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
        regenerating.then(() => {
          setRegeneratingByKey((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          if (section.id === "qcm") setQcmRegenNonce((n) => n + 1);
          return refreshCourseFromServer(courseId);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCourse?.id]);

  /** "Save to Notes" under an assistant reply — persists that message straight to /api/notes (Mes notes), titled after the active course/module and tagged with the course when there is one. Toast-only feedback; the panel shows its own inline check-mark. */
  async function handleSaveMessageToNotes(content: string) {
    const trimmed = content.trim();
    if (!trimmed) return;
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `MedArt — ${activeCourse?.title ?? moduleTitle}`,
          content: trimmed,
          ...(activeCourse ? { moduleId, courseTitle: activeCourse.title } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "L'enregistrement de la note a échoué.");
      void refreshNotesCount();
      toast({ variant: "success", title: "Réponse enregistrée", description: "Retrouve-la dans « Mes notes »." });
    } catch (error) {
      toast({
        variant: "error",
        title: "Échec de l'enregistrement",
        description: error instanceof Error ? error.message : "Erreur inconnue.",
      });
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
        // No moduleId on purpose: with one, /api/notes appends to the single
        // per-module note and discards this note's own title.
        body: JSON.stringify({ title: noteTitle.trim() || activeCourse?.title || moduleTitle, content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "L'enregistrement de la note a échoué.");

      void refreshNotesCount();
      setIsNoteOpen(false);
      setNoteContent("");
      setNoteTitle("");
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

  // ---------------------------------------------------------------------
  // MedArt OS wiring — every hook below runs before the early returns.

  // The Lab and a Studio section share the right pane's detail area: opening
  // a section closes whichever Lab tool was open.
  useEffect(() => {
    if (openedSection) setOpenedLabTool(null);
  }, [openedSection]);

  // Deep link ?course=<id> — used by the "📎 Source" links the note editor
  // inserts (note → course). Read once the module's course list is known.
  const activeCourseRef = useRef<StudioCourseFull | null>(null);
  activeCourseRef.current = activeCourse;

  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current || courses.length === 0) return;
    deepLinkHandledRef.current = true;
    const requested = Number(new URLSearchParams(window.location.search).get("course"));
    if (Number.isInteger(requested) && courses.some((c) => c.id === requested)) void handleSelectCourse(requested);
    // handleSelectCourse is intentionally not a dependency: this must run once, for the first list load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses]);

  // Keeps ?course= in the address bar in sync with the open course, so a
  // copied workspace link reopens the same polycop.
  useEffect(() => {
    if (!activeCourse) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("course") === String(activeCourse.id)) return;
    url.searchParams.set("course", String(activeCourse.id));
    window.history.replaceState(window.history.state, "", url.toString());
  }, [activeCourse]);

  const citationSources = useMemo<CitationSourceText[]>(() => {
    const ids = new Set(selectedSourceIds);
    if (activeCourse) ids.add(activeCourse.id);
    return Array.from(ids)
      .map((id) => courseCacheRef.current.get(id))
      .filter((c): c is StudioCourseFull => Boolean(c))
      .map((c) => ({ id: c.id, title: c.title, rawText: c.rawText, explication: c.explication }));
    // cacheVersion: the cache is a ref — this is what makes a background-loaded source count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSourceIds, activeCourse, cacheVersion]);

  const loadedCourses = useMemo(
    () => new Map(courseCacheRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeCourse, cacheVersion, courses]
  );

  const handleSearchSources = useCallback(
    async (query: string): Promise<SourceSearchHit[]> => {
      const missing = courses.filter((c) => !courseCacheRef.current.has(c.id));
      if (missing.length > 0) {
        await Promise.all(
          missing.map((c) =>
            fetch(`/api/studio/courses/${c.id}`)
              .then((res) => res.json())
              .then((data) => {
                if (data?.success) courseCacheRef.current.set(c.id, data.course);
              })
              .catch(() => {})
          )
        );
        setCacheVersion((v) => v + 1);
      }
      const loaded = courses.map((c) => courseCacheRef.current.get(c.id)).filter((c): c is StudioCourseFull => Boolean(c));
      return searchCourseTexts(loaded, query);
    },
    [courses]
  );

  /** Files dropped on (or attached in) the co-pilot become new sources — same direct-to-storage pipeline as the Add-source modal. */
  const handleImportFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        if (file.size > 100 * 1024 * 1024) {
          toast({ variant: "error", title: "Fichier trop volumineux", description: `${file.name} dépasse 100 Mo.` });
          continue;
        }
        if (!ACCEPTED_FILE_TYPES.some((ext) => file.name.toLowerCase().endsWith(ext))) continue;
        setUploadsInFlight((n) => n + 1);
        toast({ variant: "info", title: "Import en cours", description: `${file.name} — extraction du texte…` });
        try {
          if (!activeCourseRef.current) {
            await handleFileSelected(file);
          } else {
            const uploaded = await uploadDocumentDirect(file, moduleId);
            if (!uploaded.course) throw new Error("La création du cours a échoué.");
            const created = uploaded.course;
            setCourses((prev) => [...prev, created]);
            courseCacheRef.current.set(created.id, {
              id: created.id,
              title: created.title,
              rawText: uploaded.text,
              explication: null,
              resume: null,
              casClinique: null,
              qcms: null,
              exemplesAnalogies: null,
              sourceFileUrl: uploaded.fileUrl,
              updatedAt: created.createdAt,
              infographicUrl: null,
              audioUrl: null,
            });
            setCacheVersion((v) => v + 1);
            setSelectedSourceIds((prev) => new Set(prev).add(created.id));
            toast({ variant: "success", title: tModulePage("toastSourceAdded", language), description: `${file.name} est ajouté et coché comme source du co-pilote.` });
          }
        } catch (error) {
          toast({
            variant: "error",
            title: error instanceof OcrSuggestedError ? "PDF scanné détecté" : "Import impossible",
            description:
              error instanceof OcrSuggestedError
                ? `${file.name} ne contient pas de texte sélectionnable. Utilise « Ajouter une source » pour lancer la reconnaissance OCR.`
                : error instanceof Error
                  ? error.message
                  : "Erreur inconnue.",
          });
        } finally {
          setUploadsInFlight((n) => n - 1);
        }
      }
    },
    [handleFileSelected, toast, moduleId, language]
  );

  const openLabTool = useCallback(
    (id: LabToolId) => {
      setIsZen(false);
      setIsNoteOpen(false);
      startNavTransition(() => {
        setOpenedSection(null);
        setOpenedLabTool(id);
      });
      setIsStudioCollapsed(false);
      if (!isDesktop) setMobileTab("studio");
    },
    [isDesktop]
  );

  const openStudioSection = useCallback(
    (id: DemoSectionId) => {
      setIsZen(false);
      setIsStudioCollapsed(false);
      if (!isDesktop) setMobileTab("studio");
      void handleStudioItemClick(id);
    },
    [isDesktop, handleStudioItemClick]
  );

  const openQuickNote = useCallback(() => {
    setIsZen(false);
    setIsStudioCollapsed(false);
    startNavTransition(() => {
      setOpenedSection(null);
      setOpenedLabTool(null);
    });
    if (!isDesktop) setMobileTab("studio");
    setNoteTitle((prev) => prev || activeCourse?.title || "");
    setIsNoteOpen(true);
  }, [isDesktop, activeCourse]);

  const toggleZen = useCallback(() => {
    setIsZen((prev) => {
      const next = !prev;
      if (next && !isDesktop) setMobileTab("chat");
      return next;
    });
  }, [isDesktop]);

  const toggleTheme = useCallback(() => setTheme(isDark ? "light" : "dark"), [isDark, setTheme]);

  const focusComposer = useCallback(() => {
    if (!isDesktop) setMobileTab("chat");
    requestAnimationFrame(() => chatPanelRef.current?.focusInput());
  }, [isDesktop]);

  useHotkeys([
    { combo: "mod+k", allowInInputs: true, handler: () => setIsPaletteOpen((open) => !open) },
    { combo: "mod+/", allowInInputs: true, handler: toggleZen },
    { combo: "mod+shift+l", allowInInputs: true, handler: toggleTheme },
    { combo: "shift+n", handler: openQuickNote, enabled: !isPaletteOpen },
    { combo: "/", handler: focusComposer, enabled: !isPaletteOpen },
  ]);

  // The palette's "Modules" group — the student's own curriculum year,
  // loaded the first time the palette opens (same endpoint as the dashboard).
  const curriculumSpecialtyName = curriculumProfile?.specialty?.name ?? null;
  useEffect(() => {
    if (!isPaletteOpen || paletteModules !== null || !curriculumSpecialtyName || studyYear == null) return;
    let cancelled = false;
    fetch(`/api/curriculum?specialty=${encodeURIComponent(curriculumSpecialtyName)}&level=${studyYear}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: CurriculumYearData | null) => {
        if (cancelled || !data) return;
        const all = [...data.teachingUnits.flatMap((unit) => unit.modules), ...data.independentModules];
        setPaletteModules(all.map((m) => ({ id: m.id, title: m.title })));
      })
      .catch(() => {
        if (!cancelled) setPaletteModules([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isPaletteOpen, paletteModules, curriculumSpecialtyName, studyYear]);

  const pendingGenerations = generatingByKey.size + regeneratingByKey.size;
  const syncState: WorkspaceSyncState = !isOnline ? "offline" : pendingGenerations + uploadsInFlight > 0 || isChatBusy ? "working" : "synced";
  const syncDetail = !isOnline
    ? "Hors ligne — tes cours et générations déjà enregistrés restent sur ton compte ; reconnecte-toi pour continuer."
    : syncState === "working"
      ? [
          pendingGenerations > 0 ? `${pendingGenerations} génération${pendingGenerations > 1 ? "s" : ""} en cours` : null,
          uploadsInFlight > 0 ? `${uploadsInFlight} import${uploadsInFlight > 1 ? "s" : ""} en cours` : null,
          isChatBusy ? "le co-pilote rédige" : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "Synchronisé — chaque cours et chaque contenu généré est enregistré automatiquement sur ton compte.";

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

  const labContent = !openedLabTool ? null : !activeCourse ? (
    <div className="animate-fade-in flex flex-col items-center justify-center gap-2 py-20 text-center">
      <p className="text-sm font-medium text-foreground">Ouvre une source pour utiliser cet outil</p>
      <p className="max-w-sm text-xs text-muted-foreground">Les outils du Lab travaillent sur le cours ouvert : importe ou sélectionne un cours dans le panneau Sources.</p>
    </div>
  ) : openedLabTool === "case-simulator" ? (
    <ClinicalCaseSimulator key={activeCourse.id} courseId={activeCourse.id} courseTitle={activeCourse.title} onAskInChat={handleSendPrompt} />
  ) : openedLabTool === "matrix" ? (
    <MedicalMatrixStudio key={activeCourse.id} courseId={activeCourse.id} courseTitle={activeCourse.title} onAskInChat={handleSendPrompt} />
  ) : (
    <MindMapLab key={activeCourse.id} courseId={activeCourse.id} courseTitle={activeCourse.title} onAskInChat={handleSendPrompt} />
  );

  const PALETTE_GROUPS = ["Co-pilote", "Studio", "Lab", "Sources", "Espace de travail", "Navigation", "Modules"];
  const paletteItems: CommandItem[] = [
    {
      id: "ask",
      group: "Co-pilote",
      label: "Poser une question au co-pilote",
      icon: MessageSquarePlus,
      shortcut: ["/"],
      keywords: ["chat", "question", "assistant"],
      run: focusComposer,
    },
    ...CHAT_MODE_OPTIONS.map<CommandItem>((option) => ({
      id: `mode-${option.id}`,
      group: "Co-pilote",
      label: `${option.id === chatMode ? "✓ " : ""}Mode de réponse : ${option.label}`,
      description: option.description,
      icon: option.icon,
      keywords: ["mode", option.id],
      run: () => handleChatModeChange(option.id),
    })),
    {
      id: "new-conversation",
      group: "Co-pilote",
      label: "Nouvelle conversation",
      description: "Efface l'historique du chat pour ce cours",
      icon: Trash2,
      disabled: chatMessages.length === 0,
      run: () => void clearMessages(),
    },
    ...DEMO_SECTIONS.map<CommandItem>((section) => ({
      id: `studio-${section.id}`,
      group: "Studio",
      label: getSectionLabel(section.id, language, studyYear),
      description: activeCourse && getSectionValue(activeCourse, section.id) ? "Déjà généré — ouvrir" : "Générer pour le cours ouvert",
      icon: section.icon,
      disabled: !activeCourse,
      run: () => openStudioSection(section.id),
    })),
    ...LAB_TOOLS.map<CommandItem>((tool) => ({
      id: `lab-${tool.id}`,
      group: "Lab",
      label: tool.label,
      description: tool.description,
      icon: tool.icon,
      keywords: tool.keywords,
      run: () => openLabTool(tool.id),
    })),
    {
      id: "add-source",
      group: "Sources",
      label: "Ajouter une source",
      description: "PDF, DOCX, PPTX, TXT, Google Drive ou texte collé",
      icon: Plus,
      keywords: ["importer", "upload", "polycop"],
      run: () => {
        setIsZen(false);
        setIsSourcesCollapsed(false);
        setIsSplitScreen(false);
        if (!isDesktop) setMobileTab("sources");
        setUploadRequestNonce((n) => n + 1);
      },
    },
    ...courses.map<CommandItem>((course) => ({
      id: `source-${course.id}`,
      group: "Sources",
      label: course.title,
      description: course.id === activeCourse?.id ? "Cours ouvert — afficher le document" : "Ouvrir ce cours",
      icon: course.id === activeCourse?.id ? BookOpen : FileText,
      run: () => (course.id === activeCourse?.id ? void handleShowCourseFile(course.id) : void handleSelectCourse(course.id)),
    })),
    {
      id: "quick-note",
      group: "Espace de travail",
      label: "Note rapide",
      icon: SquarePen,
      shortcut: ["⇧", "N"],
      run: openQuickNote,
    },
    {
      id: "zen",
      group: "Espace de travail",
      label: isZen ? "Quitter le mode Zen" : "Mode Zen — focus sur le co-pilote",
      icon: Focus,
      shortcut: [modKey, "/"],
      run: toggleZen,
    },
    {
      id: "split",
      group: "Espace de travail",
      label: isSplitScreen ? "Quitter l'écran partagé" : "Écran partagé Chat + Studio",
      icon: Columns2,
      disabled: !isDesktop,
      run: () => setIsSplitScreen((prev) => !prev),
    },
    {
      id: "theme",
      group: "Espace de travail",
      label: isDark ? "Passer en mode clair" : "Passer en mode sombre",
      icon: SunMoon,
      shortcut: [modKey, "⇧", "L"],
      run: toggleTheme,
    },
    {
      id: "density",
      group: "Espace de travail",
      label: isCompact ? "Densité confortable" : "Densité compacte",
      icon: Rows3,
      run: () => setDensity(isCompact ? "comfortable" : "compact"),
    },
    {
      id: "reset-layout",
      group: "Espace de travail",
      label: "Réinitialiser la disposition des panneaux",
      icon: RotateCcw,
      run: () => {
        resetSources();
        resetStudio();
        setIsSourcesCollapsed(false);
        setIsStudioCollapsed(false);
        setIsSplitScreen(false);
        setIsZen(false);
      },
    },
    { id: "nav-dashboard", group: "Navigation", label: "Tableau de bord", icon: LayoutDashboard, run: () => router.push("/dashboard") },
    { id: "nav-exam", group: "Navigation", label: "Examen de module (Semaine Bloquée)", icon: ClipboardCheck, run: () => router.push(`/dashboard/module/${moduleId}/exam`) },
    { id: "nav-synthesis", group: "Navigation", label: "Synthèse du module", icon: Workflow, run: () => router.push(`/dashboard/workspace/module/${moduleId}`) },
    { id: "nav-notes", group: "Navigation", label: "Mes notes", icon: NotebookPen, run: () => router.push("/dashboard/notes") },
    { id: "nav-assistant", group: "Navigation", label: "MedArt Assistant", icon: MessageSquarePlus, run: () => router.push("/dashboard/assistant") },
    { id: "nav-settings", group: "Navigation", label: "Paramètres du compte", icon: Settings, run: () => router.push("/dashboard/settings") },
    ...(paletteModules ?? [])
      .filter((m) => m.id !== moduleId)
      .map<CommandItem>((m) => ({
        id: `module-${m.id}`,
        group: "Modules",
        label: m.title,
        description: "Ouvrir le workspace de ce module",
        icon: MonitorCog,
        run: () => router.push(`/dashboard/module/${m.id}`),
      })),
  ];

  const chatPanel = (
    <ChatDocumentPanel
      ref={chatPanelRef}
      title={moduleTitle}
      dateLabel={today}
      sourceCount={courses.length}
      messages={chatMessages}
      isTyping={isTyping}
      isBusy={isChatBusy}
      input={chatInput}
      onInputChange={setChatInput}
      onSend={handleSend}
      onClearHistory={clearMessages}
      onAskSelection={handleAskSelection}
      onTranslateSelection={handleTranslateSelection}
      onRegenerate={regenerateFrom}
      onSaveToNotes={handleSaveMessageToNotes}
      onSendPrompt={handleSendPrompt}
      pendingThinkingLabel={null}
      isSplitScreen={isSplitScreen}
      onToggleSplitScreen={() => setIsSplitScreen((prev) => !prev)}
      showSplitScreenToggle={!isZen}
      dark={isDark}
      sources={courses.map((c) => ({ id: c.id, title: c.title }))}
      selectedSourceIds={selectedSourceIds}
      onToggleSource={handleToggleSelectedSource}
      mode={chatMode}
      onModeChange={handleChatModeChange}
      citationSources={citationSources}
      onOpenCitationSource={handleViewSourceFile}
      onImportFiles={handleImportFiles}
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
      isBusy={isChatBusy}
      input={chatInput}
      onInputChange={setChatInput}
      onSend={handleSend}
      onClearHistory={clearMessages}
      onAskSelection={handleAskSelection}
      onTranslateSelection={handleTranslateSelection}
      onRegenerate={regenerateFrom}
      onSaveToNotes={handleSaveMessageToNotes}
      onSendPrompt={handleSendPrompt}
      onInputFocusChange={setIsMobileChatInputFocused}
      mode={chatMode}
      onModeChange={handleChatModeChange}
      citationSources={citationSources}
      onOpenCitationSource={handleViewSourceFile}
      onImportFiles={handleImportFiles}
      pendingThinkingLabel={null}
      isSplitScreen={false}
      onToggleSplitScreen={() => {}}
      showSplitScreenToggle={false}
      dark={isDark}
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
      qcmRegenerationsLeft={qcmRegenerationsLeft}
      lastGeneratedAt={activeCourse?.updatedAt ?? null}
      isNoteOpen={isNoteOpen}
      onOpenNote={() => setIsNoteOpen(true)}
      onBackFromNote={() => setIsNoteOpen(false)}
      onDeleteNote={() => {
        setIsNoteOpen(false);
        setNoteContent("");
        setNoteTitle("");
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
      collapsed={isStudioCollapsed}
      sectionMasteryPct={sectionMasteryPct}
      labTools={LAB_TOOLS}
      openedLabTool={openedLabTool}
      onOpenLabTool={openLabTool}
      onCloseLabTool={() => setOpenedLabTool(null)}
      labContent={labContent}
      noteTitle={noteTitle}
      onNoteTitleChange={setNoteTitle}
      noteSourceLink={activeCourse ? { label: activeCourse.title, href: `/dashboard/module/${moduleId}?course=${activeCourse.id}` } : null}
    >
      {isSwitchingCourse ? (
        <div className="animate-fade-in flex h-full flex-col items-center justify-center gap-3 py-20">
          <BrandLoader className="h-6 w-6" />
          <p className="text-sm text-muted-foreground">Chargement du cours...</p>
        </div>
      ) : openedSection && (generatingSections.has(openedSection) || regeneratingSections.has(openedSection)) ? (
        // A regenerating section shows the same loader as a first generation,
        // so the student never keeps answering questions that are about to
        // be replaced.
        <div className="animate-fade-in flex h-full flex-col items-center justify-center gap-3 py-20">
          <BrandLoader className="h-6 w-6" />
          {/* Podcast Audio genuinely takes ~1-4 min (a script-writing call
              plus one streamed ~10-15 min narration) — a rotating,
              feature-specific message reads as "working", where the generic
              static line would read as stalled over that much longer wait. */}
          {openedSection === "audio" ? (
            <PodcastGeneratingLabel className="text-sm text-muted-foreground" />
          ) : openedSection === "explication" ? (
            <ExplicationGeneratingLabel className="text-sm text-muted-foreground" progress={explicationProgress} />
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
                key={`${activeCourse.id}:${qcmRegenNonce}`}
                data={activeCourse.qcms}
                courseSlug={`studio-course-${activeCourse.id}`}
                explicationMarkdown={activeCourse.explication ?? undefined}
                concoursTools
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

  const panelShellClasses = cn(
    "glass-card flex flex-col overflow-hidden shadow-glass transition-[border-radius,box-shadow] duration-300 dark:shadow-glass-dark",
    isCompact ? "rounded-2xl" : "rounded-3xl"
  );
  const showSourcesPane = !isZen && !isSplitScreen;
  const showStudioPane = !isZen;

  const sourcesPanelProps = {
    courses,
    activeCourseId: activeCourse?.id ?? null,
    isSwitchingCourse,
    onSubmitFile: handleFileSelected,
    onSubmitText: handleTextSubmitted,
    onRetryWithOcr: handleOcrRetry,
    onSelectCourse: handleSelectCourse,
    onShowCourseFile: handleShowCourseFile,
    onDeleteCourse: handleDeleteCourse,
    courseMasteryBySlug,
    uploadRequestNonce,
    loadedCourses,
    onSearchSources: handleSearchSources,
    onViewSourceFile: handleViewSourceFile,
  };

  return (
    <div className="aurora-canvas-bg relative flex h-dvh flex-col overflow-hidden" data-density={layout.density}>
      <div aria-hidden className="aurora-mesh-bg animate-mesh-pulse pointer-events-none fixed inset-0 -z-10" />
      <WorkspaceCommandBar
        moduleTitle={moduleTitle}
        moduleId={moduleId}
        courseTitle={activeCourse?.title ?? null}
        sourceCount={courses.length}
        contextCount={selectedSourceIds.size}
        notesCount={notesCount}
        syncState={syncState}
        syncDetail={syncDetail}
        density={layout.density}
        onDensityChange={setDensity}
        zen={isZen}
        onToggleZen={toggleZen}
        onOpenPalette={() => setIsPaletteOpen(true)}
        onQuickNote={openQuickNote}
        modKey={modKey}
      />

      {/* Desktop (md+) — resizable 3-pane shell: Sources | Co-pilot | Studio & Lab.
          Each side pane keeps its own icon-rail collapse; the splitters
          between them drag (or ←/→ with the keyboard) and double-click to
          reset. `isDesktop` (useMediaQuery) mounts exactly one of this block
          or the mobile one below. */}
      {isDesktop && (
        <div className={cn("flex min-h-0 flex-1 flex-row overflow-hidden", isCompact ? "gap-2 p-2" : "gap-3 p-3 xl:gap-4 xl:p-4")}>
          <AnimatePresence initial={false}>
            {showSourcesPane && (
              <motion.aside
                key="sources-pane"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
                className={cn(panelShellClasses, "min-w-0")}
                style={{
                  flex: `0 1 ${isSourcesCollapsed ? 80 : layout.sourcesWidth}px`,
                  minWidth: isSourcesCollapsed ? 80 : Math.round(SOURCES_WIDTH.min * 0.85),
                }}
              >
                <ModuleSourcesPanel
                  {...sourcesPanelProps}
                  isCollapsed={isSourcesCollapsed}
                  onToggleCollapse={handleToggleSourcesCollapsed}
                  selectedSourceIds={selectedSourceIds}
                  onToggleSource={handleToggleSelectedSource}
                />
              </motion.aside>
            )}
          </AnimatePresence>

          {showSourcesPane && !isSourcesCollapsed && (
            <ResizeHandle
              onResize={resizeSources}
              onReset={resetSources}
              label="Redimensionner le panneau Sources"
              valueNow={layout.sourcesWidth}
              valueMin={SOURCES_WIDTH.min}
              valueMax={SOURCES_WIDTH.max}
              keyboardDirection={1}
            />
          )}

          {/* min-w — the co-pilot is the one pane that must never be
              squeezed unreadable; the side panes shrink first. */}
          <main className={cn(panelShellClasses, "min-w-[320px] flex-1", isZen && "mx-auto w-full max-w-4xl")}>{chatPanel}</main>

          {showStudioPane && !isStudioCollapsed && !isSplitScreen && (
            <ResizeHandle
              onResize={(delta) => resizeStudio(-delta)}
              onReset={resetStudio}
              label="Redimensionner le Studio"
              valueNow={layout.studioWidth}
              valueMin={STUDIO_WIDTH.min}
              valueMax={STUDIO_WIDTH.max}
              keyboardDirection={1}
            />
          )}

          <AnimatePresence initial={false}>
            {showStudioPane && (
              <motion.aside
                key="studio-pane"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
                className={cn(panelShellClasses, "min-w-0")}
                style={
                  isSplitScreen && !isStudioCollapsed
                    ? { flex: "1 1 0px", minWidth: 300 }
                    : { flex: `0 1 ${isStudioCollapsed ? 80 : layout.studioWidth}px`, minWidth: isStudioCollapsed ? 80 : 280 }
                }
              >
                {studioPanel}
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Mobile (<md) — exactly one of Sources/Chat/Studio at a time,
          switched via the bottom tab bar. The Studio tab shows the same
          detail view (studioPanel) as desktop once a section, a Lab tool or
          the note editor is opened; only the browse grid gets the large-card
          mobile treatment. */}
      {!isDesktop && (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden transition-[padding-bottom] duration-200 ease-out"
          style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
        >
          <div className={cn(panelShellClasses, "m-2 min-h-0 flex-1")}>
            {mobileTab === "sources" && !isZen && <ModuleSourcesPanel variant="mobile" {...sourcesPanelProps} />}
            {(mobileTab === "chat" || isZen) && mobileChatPanel}
            {mobileTab === "studio" &&
              !isZen &&
              (openedSection || openedLabTool || isNoteOpen ? (
                studioPanel
              ) : (
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                  <div className="shrink-0">
                  <MobileStudioCards
                    sections={DEMO_SECTIONS}
                    getSectionStatus={getSectionStatus}
                    generatingSections={generatingSections}
                    regeneratingSections={regeneratingSections}
                    onRegenerateSection={handleRegenerateSection}
                    qcmRegenerationsLeft={qcmRegenerationsLeft}
                    onItemClick={handleStudioItemClick}
                    onItemClickWithOptions={handleStudioItemClick}
                    studyYear={studyYear}
                    sectionMasteryPct={sectionMasteryPct}
                  />
                  </div>
                  <section aria-label="MedArt Lab" className="space-y-2 px-3 pb-24 pt-1">
                    <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">MedArt Lab</p>
                    <div className="grid grid-cols-2 gap-2">
                      {LAB_TOOLS.map((tool) => {
                        const ToolIcon = tool.icon;
                        return (
                          <motion.button
                            key={tool.id}
                            type="button"
                            whileTap={{ scale: 0.97 }}
                            onClick={() => openLabTool(tool.id)}
                            className={cn("flex min-h-[72px] flex-col items-start justify-between gap-2 rounded-2xl border p-3 text-left", tool.tint.bg)}
                          >
                            <ToolIcon className={cn("h-5 w-5", tool.tint.icon)} />
                            <span className="text-xs font-semibold leading-tight text-foreground">{tool.label}</span>
                          </motion.button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={openQuickNote}
                      className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary-600 py-3 text-sm font-semibold text-white shadow-glow dark:bg-primary-500"
                    >
                      <SquarePen className="h-4 w-4" />
                      Ajouter une note
                    </button>
                  </section>
                </div>
              ))}
          </div>

          {/* Hidden while the chat composer is focused (keyboard open) and in Zen mode. */}
          {!isZen && !(mobileTab === "chat" && isMobileChatInputFocused) && (
            <MobileWorkspaceTabBar active={mobileTab} onChange={handleMobileTabChange} />
          )}
        </div>
      )}

      <AnimatePresence>
        {isZen && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center max-md:bottom-24"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleZen}
                  className="pointer-events-auto flex items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_90%,transparent)] px-4 py-2 text-xs font-semibold text-foreground shadow-glass backdrop-blur-md transition-colors hover:border-primary-300"
                >
                  <Focus className="h-3.5 w-3.5 text-primary-500" />
                  Mode Zen — afficher tous les panneaux
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {modKey} + / pour basculer
              </TooltipContent>
            </Tooltip>
          </motion.div>
        )}
      </AnimatePresence>

      <CommandPalette open={isPaletteOpen} onOpenChange={setIsPaletteOpen} items={paletteItems} groupOrder={PALETTE_GROUPS} />

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
