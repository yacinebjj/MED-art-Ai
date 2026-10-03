"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Bold,
  ChevronDown,
  ChevronRight,
  Code,
  Eye,
  FileDown,
  Heading2,
  Italic,
  Link2,
  List,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  PencilLine,
  Redo2,
  RefreshCw,
  Sparkles,
  SquarePen,
  Trash2,
  Undo2,
} from "lucide-react";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { Select } from "@/components/ui/Select";
import { useLanguageStore } from "@/store/useLanguageStore";
import { AiLanguageSelect } from "@/components/course/workspace/AiLanguageSelect";
import { Kbd } from "@/components/course/workspace/os/Kbd";
import { useTheme } from "next-themes";
import { DARK_MARKDOWN_COMPONENTS, DARK_PROSE_CLASSES, MARKDOWN_COMPONENTS, PROSE_CLASSES } from "@/lib/markdown";
import { exportReplyToPdf } from "@/lib/assistant-export";
import { LAB_HEADING_ICON, type LabToolDescriptor, type LabToolId } from "@/lib/workspace-lab";
import { INFOGRAPHIC_MODEL_OPTIONS, type InfographicModelKey } from "@/lib/ai/infographic-prompts";
import { type PodcastDialect } from "@/lib/ai/podcast-prompts";
import { cn } from "@/lib/utils";
import { useTextSelection } from "@/hooks/useTextSelection";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { tStudio, getSectionLabel } from "@/lib/translations/studio";
import { GeneratingRotatingLabel } from "@/components/course/workspace/GeneratingRotatingLabel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { TextSelectionToolbar } from "@/components/course/workspace/TextSelectionToolbar";
import type { DemoSection, DemoSectionId } from "@/lib/demo-content";

export type SectionStatus = "available" | "needs_generation";

/**
 * Pre-generation options gathered from a tile's own arrow/dropdown menu (see
 * TileOptionsMenu below) — a superset covering every section type, with only
 * the fields relevant to the clicked section ever populated by the caller
 * (app/dashboard/module/[id]/page.tsx routes each into the right fetch:
 * language/customPrompt into /api/studio/generate's body, model+language into
 * /api/studio/infographic's, dialect into /api/studio/podcast's).
 */
export interface TileGenerationOptions {
  language?: "fr" | "en";
  /** Explication tile only. */
  customPrompt?: string;
  /** Infographie tile only. */
  model?: InfographicModelKey;
  /** Podcast Audio tile only. */
  dialect?: PodcastDialect;
}

/**
 * The ONLY section that offers "Régénérer" (⋮ menu, next to "Supprimer"):
 * the Examen QCM tile, capped at QCM_REGENERATE_CAP per course. Every other
 * Studio tile and every Lab tool is generated once (and shared platform-wide
 * through the content caches), then only viewed. Exported so
 * MobileStudioCards gates its own menu identically.
 */
export const REGENERATABLE_SECTIONS: ReadonlySet<DemoSectionId> = new Set(["qcm"]);

/** Mirrors QCM_REGENERATE_CAP in app/api/studio/regenerate/route.ts — the server is the real enforcer; this only labels the menu. */
export const QCM_REGENERATE_CAP = 5;

/** The "Régénérer" menu entry, with the remaining-attempts counter. Disabled — not hidden — once the cap is reached, so the student sees why. */
export function RegenerateMenuItem({ onSelect, left }: { onSelect: () => void; left?: number }) {
  const { language } = useLanguage();
  const exhausted = left !== undefined && left <= 0;
  return (
    <DropdownMenuItem disabled={exhausted} onSelect={onSelect}>
      <RefreshCw className="h-4 w-4" />
      {exhausted
        ? `${tStudio("regenerate", language)} — limite atteinte (${QCM_REGENERATE_CAP}/${QCM_REGENERATE_CAP})`
        : left !== undefined
          ? `${tStudio("regenerate", language)} (${left} restante${left > 1 ? "s" : ""})`
          : tStudio("regenerate", language)}
    </DropdownMenuItem>
  );
}

/** Sections whose grid tile gets the arrow/options menu — every real study mode except Exemples & Analogies, which stays a direct, no-menu click by explicit product decision. Exported so MobileStudioCards.tsx (a completely separate component tree for the mobile browse view) gates its own equivalent menu identically instead of drifting out of sync. */
export const SECTIONS_WITH_OPTIONS_MENU: ReadonlySet<DemoSectionId> = new Set([
  "explication",
  "resume",
  "cas_clinique",
  "qcm",
  "infographic",
  "audio",
]);

interface StudioPanelProps {
  sections: DemoSection[];
  openedSection: DemoSectionId | null;
  openedLabel: string;
  onItemClick: (id: DemoSectionId) => void;
  /** Fires from a tile's arrow/options menu "Générer" button — same generation as onItemClick, but carrying the student's chosen language/prompt/model/dialect. Optional: a caller that omits this simply never renders the arrow (every tile falls back to a plain onItemClick-only button). */
  onItemClickWithOptions?: (id: DemoSectionId, options: TileGenerationOptions) => void;
  onCloseSection: () => void;
  getSectionStatus: (id: DemoSectionId) => SectionStatus;
  /** A Set, not a single id — several sections can now generate concurrently (a student clicking Résumé no longer blocks clicking Cas Clinique before the first finishes). Each tile checks its OWN membership (`.has(section.id)`), never a single shared value. */
  generatingSections: Set<DemoSectionId>;
  /** Sections currently regenerating (Examen QCM only). Same Set shape as generatingSections. */
  regeneratingSections?: Set<DemoSectionId>;
  /** Fires from the Examen QCM "Régénérer" menu entry. Omitted: the entry isn't rendered. */
  onRegenerateSection?: (id: DemoSectionId) => void;
  /** Régénérations restantes de l'Examen QCM de ce cours (plafond serveur). Drives the counter / the disabled state. */
  qcmRegenerationsLeft?: number;
  /** ISO timestamp of the active course's last section save (studio_courses.updated_at) — powers the "Récemment généré" list's relative-time label (RelativeTime). Same value for every row today (row-level, not per-section — see StudioCourseFull's own comment); null before anything has ever been generated. */
  lastGeneratedAt: string | null;
  isNoteOpen: boolean;
  onOpenNote: () => void;
  onBackFromNote: () => void;
  onDeleteNote: () => void;
  noteContent: string;
  onNoteContentChange: (value: string) => void;
  onSaveNote: () => void;
  isSavingNote: boolean;
  onAskSelection: (text: string) => void;
  onTranslateSelection: (text: string) => void;
  /** Passed straight through to TextSelectionToolbar's "Add Note" — see that component's own doc comment. Optional: omitted by callers with no module in scope. */
  moduleId?: number;
  courseTitle?: string;
  /** Passed straight through to TextSelectionToolbar so a saved highlight POSTs against the right course (see /api/highlights) — omitted by callers with no fixed slug (e.g. the generic numeric-id module workspace, which has no equivalent yet). Without this, TextSelectionToolbar's save silently no-ops. */
  courseSlug?: string;
  /** Notified whenever the internal collapse toggle fires — the panel's own root controls its ephemeral (w-20 vs w-full) width, but the page-level `<aside>` wrapping it may want to shrink/grow its own fixed width in lockstep (see app/dashboard/module/[id]/page.tsx). Optional: a caller that omits this still gets a fully working collapse, just without the outer wrapper reacting. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Controlled collapse — when provided, the caller owns the state (onCollapsedChange then just requests a change). Lets the page re-open the panel itself, e.g. for a quick note. Omitted, the panel keeps its own internal state. */
  collapsed?: boolean;
  /** The student's own curriculum level (StudentCurriculumProfile.academicYear.level, types/academic.ts) — only ever changes the "Cas Clinique" tile's own label (see lib/translations/studio.ts's getSectionLabel); every other tile ignores it. Optional: a caller that omits this simply always gets the standard "Cas Cliniques" label. */
  studyYear?: number | null;
  /**
   * Purely a VISUAL signal — any actual gate lives entirely in the caller's
   * onItemClick, never here. The caller no longer passes this (the earlier
   * "every section but Explication requires it to exist first" product gate
   * was reversed by explicit request — every Studio section is independently
   * generatable now, on every screen size), so every tile renders unlocked.
   * Kept as a real, general capability for a future caller that DOES want
   * per-tile locking — omitted entirely (or an empty Set) renders every tile
   * unlocked.
   */
  lockedSections?: Set<DemoSectionId>;
  /**
   * Real, already-fetched mastery percentage (0-100) for whichever sections
   * the caller has one for — today only ever "qcm" (course_mastery, see
   * app/dashboard/module/[id]/page.tsx's courseMasteryBySlug). Renders a
   * small ProgressRing on that tile (and its "Récemment généré" row)
   * instead of the plain dot once the section is available. Never
   * fabricated: a section with no entry here just keeps the plain dot.
   */
  sectionMasteryPct?: Partial<Record<DemoSectionId, number>>;
  /** "MedArt Lab" tool cards rendered under the Studio tiles (see lib/workspace-lab.ts). Optional: omitted, no Lab section. */
  labTools?: LabToolDescriptor[];
  openedLabTool?: LabToolId | null;
  onOpenLabTool?: (id: LabToolId) => void;
  onCloseLabTool?: () => void;
  /** The opened Lab tool's own UI, rendered by the caller (same pattern as `children` for a Studio section). */
  labContent?: React.ReactNode;
  /** Note editor title (defaults to the course title upstream). Optional: omitted, the editor shows a static heading. */
  noteTitle?: string;
  onNoteTitleChange?: (value: string) => void;
  /** Markdown link back to the active course, inserted by the note editor's "Lier au cours" button — the note → course half of the link (the course → notes half is the command bar's notes counter). */
  noteSourceLink?: { label: string; href: string } | null;
  children: React.ReactNode;
}

/** Contrasted, interactive icon-button style for panel chrome (collapse/expand controls). */
const PANEL_ICON_BUTTON_CLASSES =
  "p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-300 active:scale-[0.94]";

const TOOLBAR_BUTTON_CLASSES =
  "rounded-lg p-1.5 text-muted-foreground transition-all duration-300 hover:bg-accent hover:text-foreground active:scale-[0.94]";

/**
 * Glassmorphism icon-button style for the exit control on the fullscreen
 * (isSectionExpanded) overlay specifically — deliberately distinct from
 * PANEL_ICON_BUTTON_CLASSES above. Matches, verbatim, the "floating glass
 * pill" back-button recipe already established for full-viewport surfaces
 * elsewhere in the app (see the "Retour aux groupes" link in
 * components/groups/ChatRoom.tsx: border-white/20 + bg-white/10 +
 * backdrop-blur-md + rounded-full), so exiting Studio's own full-viewport
 * mode gets the same affordance a student already knows from that other
 * immersive surface, not a plain flat icon button.
 */
const GLASS_EXIT_BUTTON_CLASSES =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-foreground shadow-lg backdrop-blur-md transition-all duration-200 hover:-translate-x-0.5 hover:bg-white/20 active:scale-90";

/**
 * Same "floating glass pill" recipe as GLASS_EXIT_BUTTON_CLASSES above, minus
 * the horizontal hover-shift — that motion reads as "step back" and belongs
 * to the exit control alone. Used for any other icon trigger placed on the
 * same full-viewport glass overlay header (the "..." Régénérer menu next to
 * it).
 */
const GLASS_ICON_BUTTON_CLASSES =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-foreground shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-white/20 active:scale-90";

/**
 * Solid (non-alpha) background tint for the detail view — one per section,
 * covering the whole right panel while it's open. Deliberately NOT using
 * `/NN` opacity suffixes (e.g. `bg-emerald-50/50`) — on the fixed,
 * full-viewport expanded overlay below, a translucent background lets the
 * Chat/Sources text underneath show through and overlap with this view's own
 * text, making both unreadable. `bg-emerald-50`/`dark:bg-emerald-950` etc.
 * are 100% opaque solid colors, just a lighter/darker shade of the tint.
 */
const SECTION_DETAIL_BG: Record<DemoSectionId, string> = {
  explication: "bg-emerald-50 dark:bg-emerald-950",
  resume: "bg-blue-50 dark:bg-blue-950",
  cas_clinique: "bg-amber-50 dark:bg-amber-950",
  qcm: "bg-purple-50 dark:bg-purple-950",
  exemples_analogies: "bg-yellow-50 dark:bg-yellow-950",
  infographic: "bg-rose-50 dark:bg-rose-950",
  audio: "bg-orange-50 dark:bg-orange-950",
};

/**
 * Soft tint per study mode — light-mode pastel + a discreet dark-mode
 * counterpart. Exported for reuse by MobileStudioCards' large-card grid, so
 * both surfaces share the exact same per-section color identity. `dot` is a
 * SOLID counterpart of `icon`'s color, spelled out as its own literal
 * classes (not derived from `icon` at runtime via string replace) —
 * Tailwind's JIT scanner only generates CSS for class names it can see
 * verbatim in source, so a computed "bg-" + a runtime-extracted hue would
 * silently produce zero CSS and render invisible.
 */
export const TILE_TINTS: Record<DemoSectionId, { bg: string; icon: string; dot: string }> = {
  explication: {
    bg: "bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-900/40",
    icon: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500 dark:bg-emerald-400",
  },
  resume: {
    bg: "bg-blue-50/80 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-900/40",
    icon: "text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500 dark:bg-blue-400",
  },
  cas_clinique: {
    bg: "bg-amber-50/80 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-900/40",
    icon: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500 dark:bg-amber-400",
  },
  qcm: {
    bg: "bg-purple-50/80 dark:bg-purple-950/20 border-purple-200/50 dark:border-purple-900/40",
    icon: "text-purple-600 dark:text-purple-400",
    dot: "bg-purple-500 dark:bg-purple-400",
  },
  exemples_analogies: {
    bg: "bg-yellow-50/80 dark:bg-yellow-950/20 border-yellow-200/50 dark:border-yellow-900/40",
    icon: "text-yellow-600 dark:text-yellow-400",
    dot: "bg-yellow-500 dark:bg-yellow-400",
  },
  infographic: {
    bg: "bg-rose-50/80 dark:bg-rose-950/20 border-rose-200/50 dark:border-rose-900/40",
    icon: "text-rose-600 dark:text-rose-400",
    dot: "bg-rose-500 dark:bg-rose-400",
  },
  audio: {
    bg: "bg-orange-50/80 dark:bg-orange-950/20 border-orange-200/50 dark:border-orange-900/40",
    icon: "text-orange-600 dark:text-orange-400",
    dot: "bg-orange-500 dark:bg-orange-400",
  },
};

/**
 * "..." trigger + menu for the OPENED section's own detail-view header (both
 * the inline collapsed header and the fullscreen overlay header below) —
 * mirrors the identical DropdownMenu used further down for each "Récemment
 * généré" list row. "Régénérer" appears ONLY for the Examen QCM (see
 * REGENERATABLE_SECTIONS); while that regeneration is running the trigger
 * morphs into a spinning RefreshCw instead of opening a menu.
 */
function SectionOptionsMenu({
  sectionId,
  onRegenerateSection,
  isRegenerating,
  regenerationsLeft,
  triggerClassName,
}: {
  sectionId: DemoSectionId;
  onRegenerateSection?: (id: DemoSectionId) => void;
  isRegenerating: boolean;
  regenerationsLeft?: number;
  triggerClassName: string;
}) {
  const { language } = useLanguage();

  if (isRegenerating) {
    return (
      <span aria-hidden className={triggerClassName}>
        <RefreshCw className="h-4 w-4 animate-spin" />
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Options" className={triggerClassName}>
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>{tStudio("delete", language)}</DropdownMenuItem>
        {onRegenerateSection && REGENERATABLE_SECTIONS.has(sectionId) && (
          <RegenerateMenuItem onSelect={() => onRegenerateSection(sectionId)} left={regenerationsLeft} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Compact trigger for the shared Radix `Select` (components/ui/Select.tsx) inside a tile's generation-options popover. */
const TILE_SELECT_TRIGGER_CLASSES = "rounded-lg px-2.5 py-1.5 text-left text-xs font-medium shadow-none [&>span:first-child]:line-clamp-1";

/** The single language list used by every generation-options popover — Studio tiles (desktop and mobile share TileOptionsMenu). */
const LANGUAGE_OPTIONS = [
  { value: "fr", label: "🇫🇷 Français" },
  { value: "en", label: "🇬🇧 English" },
];

const PODCAST_DIALECT_OPTIONS = [
  { value: "fr", label: "🇫🇷 Français" },
  { value: "en", label: "🇬🇧 English" },
  { value: "fr-darija", label: "🇫🇷🇩🇿 Français-Arabe (Darija Algérienne)" },
  { value: "en-darija", label: "🇬🇧🇩🇿 English-Arabic (Darija Algérienne)" },
];

/**
 * Pre-generation options popover for one grid tile — a hand-rolled floating
 * panel (not the shared DropdownMenu/Radix primitive used everywhere else in
 * this file) specifically because it hosts real form controls (a `<select>`,
 * a `<textarea>`) that Radix's DropdownMenuContent would auto-close on
 * interacting with, since it isn't built to host a form. A fixed
 * transparent backdrop behind it (z-40, this panel at z-50) closes it on any
 * outside click — the same "click away to dismiss" behavior a Radix menu
 * gets for free.
 */
/** Exported so MobileStudioCards.tsx (mobile's own separate browse-view component, not this file's grid) can reuse the exact same pre-generation options popover instead of maintaining a second, divergent implementation. */
export function TileOptionsMenu({
  sectionId,
  language,
  onClose,
  onGenerate,
}: {
  sectionId: DemoSectionId;
  language: Language;
  onClose: () => void;
  onGenerate: (options: TileGenerationOptions) => void;
}) {
  // The content language is the GLOBAL choice (store/useLanguageStore.ts):
  // changing it here changes it for every other tile and Lab tool too, and a
  // plain tile click (no popover) generates in it as well.
  const contentLanguage = useLanguageStore((state) => state.language);
  const setContentLanguage = useLanguageStore((state) => state.setLanguage);
  const [draftCustomPrompt, setDraftCustomPrompt] = useState("");
  const [draftModel, setDraftModel] = useState<InfographicModelKey>("nano-banana-2");
  // Podcast keeps its own dialect list; it starts on the global language
  // (plain English, not the mixed Darija variant) when English is selected.
  const [draftDialect, setDraftDialect] = useState<PodcastDialect>(() => (contentLanguage === "en" ? "en" : "fr-darija"));

  // Rendered in a portal with fixed positioning, anchored to the tile: as a
  // plain `absolute` child it lived inside the Studio's scrolling grid
  // (overflow-y-auto), which clipped it near the panel's edges.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const PANEL_WIDTH = 256;
    const MARGIN = 8;
    function place() {
      const anchor = anchorRef.current?.parentElement;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const panelHeight = panelRef.current?.offsetHeight ?? 220;
      const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
      const openAbove = spaceBelow < panelHeight && rect.top - MARGIN > spaceBelow;
      const top = openAbove
        ? Math.max(MARGIN, rect.top - panelHeight - 4)
        : Math.max(MARGIN, Math.min(rect.bottom + 4, window.innerHeight - panelHeight - MARGIN));
      const left = Math.max(MARGIN, Math.min(rect.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - MARGIN));
      setPosition((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    }
    place();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    if (panelRef.current) observer?.observe(panelRef.current);
    window.addEventListener("resize", place);
    // capture: also follows scrolling of the Studio panel itself, not just the window.
    window.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function handleGenerate() {
    const options: TileGenerationOptions =
      sectionId === "infographic"
        ? { language: contentLanguage, model: draftModel }
        : sectionId === "audio"
          ? { dialect: draftDialect }
          : sectionId === "explication"
            ? { language: contentLanguage, customPrompt: draftCustomPrompt.trim() || undefined }
            : { language: contentLanguage };
    onGenerate(options);
    onClose();
  }

  return (
    <>
      <span ref={anchorRef} hidden aria-hidden />
      {createPortal(
        <>
          <button
            type="button"
            aria-label={tStudio("collapsePanelAria", language)}
            tabIndex={-1}
            className="fixed inset-0 z-[1040] cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-label={language === "fr" ? "Options de génération" : "Generation options"}
            onClick={(e) => e.stopPropagation()}
            style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: "hidden" }}
            className="fixed z-[1050] w-64 space-y-2.5 rounded-xl border border-border bg-card p-3 text-left shadow-glass dark:shadow-glass-dark"
          >
            {sectionId === "audio" ? (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {language === "fr" ? "Langue / dialecte" : "Language / dialect"}
                </p>
                <Select
                  value={draftDialect}
                  onValueChange={(value) => setDraftDialect(value as PodcastDialect)}
                  options={PODCAST_DIALECT_OPTIONS}
                  className={TILE_SELECT_TRIGGER_CLASSES}
                />
              </div>
            ) : (
              <>
                {sectionId === "infographic" && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {language === "fr" ? "Modèle" : "Model"}
                    </p>
                    <Select
                      value={draftModel}
                      onValueChange={(value) => setDraftModel(value as InfographicModelKey)}
                      options={Object.entries(INFOGRAPHIC_MODEL_OPTIONS).map(([key, opt]) => ({
                        value: key,
                        label: language === "fr" ? opt.labelFr : opt.labelEn,
                      }))}
                      className={TILE_SELECT_TRIGGER_CLASSES}
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {language === "fr" ? "Langue (tout le Studio et le Lab)" : "Language (whole Studio and Lab)"}
                  </p>
                  <Select
                    value={contentLanguage}
                    onValueChange={(value) => setContentLanguage(value === "en" ? "en" : "fr")}
                    options={LANGUAGE_OPTIONS}
                    className={TILE_SELECT_TRIGGER_CLASSES}
                  />
                </div>
                {sectionId === "explication" && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {language === "fr" ? "Consigne personnalisée" : "Custom instructions"}
                    </p>
                    <textarea
                      value={draftCustomPrompt}
                      onChange={(e) => setDraftCustomPrompt(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder={language === "fr" ? "Décris ce que tu veux détailler..." : "Describe what you want to detail..."}
                      rows={3}
                      className="w-full resize-none rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary-400"
                    />
                  </div>
                )}
              </>
            )}
            <Button size="sm" className="w-full rounded-lg" onClick={handleGenerate}>
              {tStudio("generateAction", language)}
            </Button>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

/**
 * Right "Studio" panel: a grid of the course's real study modes (no
 * fabricated "Audio Overview"/"Flashcards" tiles for features this app
 * doesn't have — every tile here leads to a real, working section) plus a
 * "recent generations" list, an "Add note" FAB, and a note-editor mockup.
 * Toggles between "browse" (grid + list) and "detail" (opened section
 * content, rendered by the caller and passed as `children`) internally, and
 * the detail view can itself expand into a full-viewport overlay.
 */
export function StudioPanel({
  sections,
  openedSection,
  openedLabel,
  onItemClick,
  onItemClickWithOptions,
  onCloseSection,
  getSectionStatus,
  generatingSections,
  lastGeneratedAt,
  isNoteOpen,
  onOpenNote,
  onBackFromNote,
  onDeleteNote,
  noteContent,
  onNoteContentChange,
  onSaveNote,
  isSavingNote,
  onAskSelection,
  onTranslateSelection,
  moduleId,
  courseTitle,
  courseSlug,
  onCollapsedChange,
  collapsed,
  regeneratingSections,
  onRegenerateSection,
  qcmRegenerationsLeft,
  studyYear,
  lockedSections,
  sectionMasteryPct,
  labTools,
  openedLabTool = null,
  onOpenLabTool,
  onCloseLabTool,
  labContent,
  noteTitle,
  onNoteTitleChange,
  noteSourceLink,
  children,
}: StudioPanelProps) {
  const { language } = useLanguage();
  const [isSectionExpanded, setIsSectionExpanded] = useState(false);
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = collapsed ?? internalCollapsed;
  const [optionsMenuFor, setOptionsMenuFor] = useState<DemoSectionId | null>(null);
  const { containerRef, container, tooltipRef, selection, clearSelection } = useTextSelection();
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const notePreviewRef = useRef<HTMLDivElement>(null);
  const [isNotePreview, setIsNotePreview] = useState(false);
  const [isExportingNote, setIsExportingNote] = useState(false);
  // Only read by the note preview, which renders after a click — never during SSR.
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  // A Lab tool only counts as "open" while no Studio section is — the two
  // share the detail area, and a section always wins.
  const openedLab = !openedSection && openedLabTool ? labTools?.find((tool) => tool.id === openedLabTool) ?? null : null;
  const isDetailOpen = Boolean(openedSection || openedLab);
  const detailContent = openedSection ? children : openedLab ? labContent : null;

  /** Inserts `text` at the cursor (replacing any selection) — used by the heading/list/source-link buttons. */
  function insertAtNoteCursor(text: string) {
    const el = noteTextareaRef.current;
    if (!el) {
      onNoteContentChange(`${noteContent}${text}`);
      return;
    }
    const { selectionStart, selectionEnd, value } = el;
    const next = `${value.slice(0, selectionStart)}${text}${value.slice(selectionEnd)}`;
    onNoteContentChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = selectionStart + text.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  /** Prefixes the current line(s) with a Markdown block marker ("## ", "- "). */
  function prefixNoteLines(prefix: string) {
    const el = noteTextareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const block = value.slice(lineStart, selectionEnd);
    const prefixed = block
      .split("\n")
      .map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
      .join("\n");
    onNoteContentChange(`${value.slice(0, lineStart)}${prefixed}${value.slice(selectionEnd)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + prefixed.length);
    });
  }

  /** Print-to-PDF through the same isolated iframe pipeline the Assistant's "Exporter en PDF" uses (lib/assistant-export.ts) — the app's own @media print guard never applies inside that iframe. */
  async function handleExportNotePdf() {
    if (!noteContent.trim()) return;
    setIsNotePreview(true);
    setIsExportingNote(true);
    // One frame so the preview (the HTML source of the export) is mounted.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      const html = notePreviewRef.current?.innerHTML ?? "";
      await exportReplyToPdf({ title: noteTitle?.trim() || courseTitle || "Note MedArt", html });
    } catch (error) {
      console.error("[studio:note] Export PDF impossible:", error);
    } finally {
      setIsExportingNote(false);
    }
  }

  const noteWordCount = noteContent.trim() ? noteContent.trim().split(/\s+/).length : 0;

  /**
   * The note editor is a plain <textarea> (Markdown source, rendered as
   * Markdown elsewhere in the app — same convention as Notes), not a
   * contentEditable rich-text surface, so there's no execCommand-style
   * "apply bold" to call. Wrapping the current selection in the matching
   * Markdown markers is the correct, real equivalent for a plain-text
   * input — was previously entirely unwired (every toolbar button below
   * had no onClick at all).
   */
  function wrapNoteSelection(before: string, after: string = before) {
    const el = noteTextareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    const selected = value.slice(selectionStart, selectionEnd);
    const next = `${value.slice(0, selectionStart)}${before}${selected}${after}${value.slice(selectionEnd)}`;
    onNoteContentChange(next);
    // Restore focus + a sensible selection (the wrapped text itself, or the
    // cursor between the markers if nothing was selected) on the NEXT tick —
    // onNoteContentChange re-renders the controlled value first.
    requestAnimationFrame(() => {
      el.focus();
      const cursorStart = selectionStart + before.length;
      const cursorEnd = cursorStart + selected.length;
      el.setSelectionRange(cursorStart, cursorEnd);
    });
  }

  /** Strips the common Markdown markers this toolbar itself inserts from the current selection — the "Normal" (clear formatting) button. */
  function clearNoteSelectionFormatting() {
    const el = noteTextareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    const selected = value.slice(selectionStart, selectionEnd);
    const cleaned = selected.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").replace(/`(.*?)`/g, "$1");
    const next = `${value.slice(0, selectionStart)}${cleaned}${value.slice(selectionEnd)}`;
    onNoteContentChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selectionStart, selectionStart + cleaned.length);
    });
  }

  /** Native undo/redo history for the textarea — a controlled React input still accumulates the browser's own edit history as the student types, so execCommand can drive it directly; there is no simpler reliable equivalent for a plain <textarea>. */
  function triggerNoteHistory(command: "undo" | "redo") {
    noteTextareaRef.current?.focus();
    document.execCommand(command);
  }

  function toggleCollapsed() {
    if (collapsed !== undefined) {
      onCollapsedChange?.(!collapsed);
      return;
    }
    setInternalCollapsed((prev) => {
      const next = !prev;
      onCollapsedChange?.(next);
      return next;
    });
  }

  const detailBg = openedSection ? SECTION_DETAIL_BG[openedSection] : "";

  // A freshly-opened (or closed) section always starts collapsed — otherwise
  // switching from an expanded item straight to another one would carry the
  // expanded state over to content the student never asked to maximize.
  useEffect(() => {
    setIsSectionExpanded(false);
  }, [openedSection, openedLabTool]);

  // Escape closes the expanded overlay, matching every real Dialog in this
  // app (Radix's DismissableLayer closes on Escape by default) — this
  // overlay is a hand-rolled portal, not a Dialog, so it never got that for
  // free. Only listens while actually expanded, so it can never intercept
  // Escape meant for something else (a Radix Dialog stacked on top, a
  // browser feature) the rest of the time.
  useEffect(() => {
    if (!isSectionExpanded) return;
    function handleKeyDown(e: KeyboardEvent) {
      // A tool inside the overlay that already handled Escape (deselecting a
      // mind-map node, cancelling a bookmark edit) must not also close it.
      if (e.key === "Escape" && !e.defaultPrevented) setIsSectionExpanded(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSectionExpanded]);

  // Portal-mount guard: `document` doesn't exist during SSR, and mounting a
  // portal on the very first client render (before hydration settles) can
  // still race in some setups — flipping this in an effect keeps the portal
  // strictly client-and-post-mount only.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const generations = sections.filter(
    (section) => getSectionStatus(section.id) === "available" || generatingSections.has(section.id)
  );

  // Looked up once here (rather than re-deriving inline in three places
  // below: the collapsed header, the expanded-overlay header, and its icon
  // chip) so the opened section's own icon/tint can ride along the "Studio /
  // {label}" breadcrumb — the whole point being that a student glancing at
  // the header instantly recognizes which of the study modes they're in by
  // its familiar color+icon identity, the same one they just clicked in the
  // browse grid, never just a bare label.
  const openedSectionData = openedSection ? sections.find((s) => s.id === openedSection) : undefined;
  const openedTint = openedSection ? TILE_TINTS[openedSection] : undefined;

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden transition-all duration-300",
        isCollapsed ? "w-20" : "w-full"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between border-b border-border p-2 transition-colors duration-300 md:p-4",
          !isNoteOpen && detailBg
        )}
      >
        {isNoteOpen ? (
          <button
            type="button"
            onClick={onBackFromNote}
            className={cn(PANEL_ICON_BUTTON_CLASSES, "flex items-center gap-2 !px-3 text-sm font-medium")}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            {!isCollapsed && tStudio("studioHeading", language)}
          </button>
        ) : openedSection ? (
          // "Studio / {label}" breadcrumb + the section's own icon+tint (the
          // exact identity it carries in the browse grid) — a student
          // stepping into a detail view always sees both where they came
          // from and which of the study modes they're now in, never just an
          // ambiguous back arrow + title.
          <button
            type="button"
            onClick={onCloseSection}
            className="group flex min-w-0 items-center gap-2 rounded-lg py-1 pr-2 text-sm font-semibold text-foreground transition-all duration-300 hover:-translate-x-0.5"
          >
            <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            {!isCollapsed && (
              <>
                <span className="hidden text-muted-foreground transition-colors group-hover:text-foreground sm:inline">{tStudio("studioHeading", language)}</span>
                <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:inline" />
                {openedTint && openedSectionData && (
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg shadow-glow", openedTint.bg, openedTint.icon)}>
                    <openedSectionData.icon className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="truncate">{openedLabel}</span>
              </>
            )}
          </button>
        ) : openedLab ? (
          <button
            type="button"
            onClick={onCloseLabTool}
            className="group flex min-w-0 items-center gap-2 rounded-lg py-1 pr-2 text-sm font-semibold text-foreground transition-all duration-300 hover:-translate-x-0.5"
          >
            <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            {!isCollapsed && (
              <>
                <span className="hidden text-muted-foreground transition-colors group-hover:text-foreground sm:inline">Lab</span>
                <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:inline" />
                <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border shadow-glow", openedLab.tint.bg, openedLab.tint.icon)}>
                  <openedLab.icon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">{openedLab.label}</span>
              </>
            )}
          </button>
        ) : (
          // Browse-grid header: the "Studio" title, aligned with the middle
          // column's "MedArt Assistant" header (same top border + p-4 header
          // bar), so both columns read as titled panels. Hidden in the w-20
          // collapsed rail, matching the other header controls' !isCollapsed
          // guards below.
          !isCollapsed ? (
            <h2 className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
              {tStudio("studioHeading", language)}
            </h2>
          ) : (
            <div />
          )
        )}

        <div className="flex items-center gap-1">
          {isNoteOpen ? (
            <button
              type="button"
              onClick={onDeleteNote}
              aria-label={tStudio("deleteNoteAria", language)}
              className={PANEL_ICON_BUTTON_CLASSES}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : (
            <>
              {/* Global AI-content language — one switch for every tile and Lab tool. */}
              {!isCollapsed && <AiLanguageSelect compact className="mr-0.5" />}
              {openedSection && !isCollapsed && (
                <SectionOptionsMenu
                  sectionId={openedSection}
                  onRegenerateSection={onRegenerateSection}
                  isRegenerating={regeneratingSections?.has(openedSection) ?? false}
                  regenerationsLeft={qcmRegenerationsLeft}
                  triggerClassName={PANEL_ICON_BUTTON_CLASSES}
                />
              )}
              {isDetailOpen && !isCollapsed && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setIsSectionExpanded(true)}
                      aria-label={tStudio("expandAria", language)}
                      className={PANEL_ICON_BUTTON_CLASSES}
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Plein écran</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleCollapsed}
                    aria-label={tStudio(isCollapsed ? "openPanelAria" : "collapsePanelAria", language)}
                    aria-pressed={isCollapsed}
                    className={PANEL_ICON_BUTTON_CLASSES}
                  >
                    {isCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">{tStudio(isCollapsed ? "openPanelAria" : "collapsePanelAria", language)}</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div className={cn("h-full overflow-y-auto", openedSection && detailBg)}>
          {openedSection ? (
            isSectionExpanded ? null : (
              // text-select-stable — see its own comment in app/globals.css:
              // fixes a sub-pixel blur on text selection under this panel's
              // own Framer Motion (motion.*) ancestors' transform.
              <div ref={containerRef} data-selectable className="text-select-stable p-2 md:p-4">
                {children}
              </div>
            )
          ) : openedLab ? (
            isSectionExpanded ? null : (
              <motion.div
                key={openedLab.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                ref={containerRef}
                data-selectable
                className="text-select-stable p-2 md:p-4"
              >
                {labContent}
              </motion.div>
            )
          ) : (
            <div className={cn("space-y-3 p-2 pb-20 md:space-y-6 md:p-4 md:pb-24", isCollapsed && "px-2")}>
              <div className={cn("grid gap-1.5 md:gap-2", isCollapsed ? "grid-cols-1" : "grid-cols-2")}>
                {sections.map((section) => {
                  const Icon = section.icon;
                  const isGenerating = generatingSections.has(section.id);
                  const tint = TILE_TINTS[section.id];
                  const isDone = getSectionStatus(section.id) === "available";
                  // Visual-only — see StudioPanelProps.lockedSections' own doc
                  // comment. The real gate lives entirely in the caller's
                  // onItemClick, unaffected by this.
                  const isLocked = lockedSections?.has(section.id) ?? false;
                  const masteryPct = sectionMasteryPct?.[section.id];
                  // The arrow/options menu only makes sense BEFORE a section
                  // has ever been generated — once it exists, "Régénérer"
                  // (SectionOptionsMenu, on the opened detail view) is the
                  // relevant follow-up action, not a fresh set of
                  // language/prompt options. Exemples & Analogies never gets
                  // one at all, by explicit product decision (direct click
                  // only) — see SECTIONS_WITH_OPTIONS_MENU's own comment.
                  const showOptionsMenu =
                    Boolean(onItemClickWithOptions) &&
                    !isCollapsed &&
                    !isDone &&
                    !isGenerating &&
                    SECTIONS_WITH_OPTIONS_MENU.has(section.id);
                  return (
                    // min-w-0 — grid items default to `min-width: auto`
                    // (unlike flex, which already resolves this for its own
                    // children elsewhere in this file), so without it this
                    // tile refuses to shrink below its label's intrinsic
                    // width. That's exactly what let a long label overlap/
                    // deform its neighbors whenever the panel itself
                    // narrows — during the collapse transition (grid-cols-2
                    // -> grid-cols-1 lands at the same moment as the width
                    // animation, briefly mismatched) or simply at an
                    // in-between desktop width.
                    <div key={section.id} className="relative min-w-0">
                      <button
                        type="button"
                        disabled={isGenerating}
                        onClick={() => onItemClick(section.id)}
                        // Always set (not just when collapsed) — a long
                        // label ("Ultra-Detailed Summary", "Examples &
                        // Analogies...") can still overflow this row even
                        // uncollapsed, and the native title tooltip is the
                        // one fallback that works at any width without
                        // guessing.
                        title={isLocked ? tStudio("lockedTileTooltip", language) : getSectionLabel(section.id, language, studyYear)}
                        className={cn(
                          // Compacted per explicit product direction — was
                          // p-3/md:p-4 + text-sm/md:text-base, reading as
                          // oversized blocks instead of an elegant, dense
                          // tool list.
                          "group relative flex w-full items-center gap-2 rounded-xl border text-xs font-medium text-[color-mix(in_oklab,var(--foreground)_80%,transparent)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.01] hover:border-primary/50 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:scale-100 disabled:hover:shadow-none md:text-sm",
                          isGenerating && "disabled:cursor-wait",
                          isLocked && "opacity-50 saturate-[0.4] hover:translate-y-0 hover:shadow-none",
                          // Fixed h-14 (uncollapsed) — CSS Grid rows stretch
                          // items WITHIN one row to match automatically, but
                          // each ROW still auto-sizes to ITS OWN tallest
                          // tile (a 2-line-label row vs. an all-1-line-label
                          // row), which is exactly what made tiles in
                          // different rows visibly different sizes. A fixed
                          // height on every tile removes that row-to-row
                          // variance entirely — line-clamp-2 above still
                          // wraps a long label onto 2 lines, just centered
                          // (items-center) within the same fixed box a
                          // short 1-line label also fills.
                          isCollapsed ? "aspect-square flex-col justify-center p-2" : "h-14 justify-between px-3 py-2 text-left",
                          tint.bg
                        )}
                      >
                        {!isCollapsed && (
                          // line-clamp-2 (not truncate/whitespace-nowrap) —
                          // a long label ("Ultra-Detailed Summary",
                          // "Examples & Analogies") used to hard-truncate to
                          // one illegible line; now it wraps onto a 2nd line
                          // first, only ellipsizing past that. min-w-0 lets
                          // this span actually shrink inside the flex row
                          // (it wouldn't wrap at all otherwise).
                          <span className={cn("min-w-0 line-clamp-2 break-words", showOptionsMenu && "pr-5")}>
                            {getSectionLabel(section.id, language, studyYear)}
                          </span>
                        )}
                        {isGenerating ? (
                          <Loader2 className={cn("shrink-0 animate-spin text-muted-foreground", isCollapsed ? "h-6 w-6" : "h-4 w-4")} />
                        ) : (
                          <span className="flex shrink-0 items-center gap-1">
                            <Icon
                              className={cn(
                                "shrink-0 transition-transform duration-300 group-hover:scale-110",
                                isCollapsed ? "h-6 w-6" : "h-4 w-4",
                                tint.icon
                              )}
                            />
                            {/* Subtle interactivity hint, revealed on hover —
                                only for a not-yet-generated tile: a "done"
                                tile already communicates clickability via its
                                mastery ring/dot in the opposite corner, and
                                the collapsed rail has no room for it. */}
                            {!isCollapsed && !isDone && (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color-mix(in_oklab,var(--muted-foreground)_50%,transparent)] opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" />
                            )}
                          </span>
                        )}
                        {/* A quiet "already generated" tell (no separate label,
                            no layout shift) so a returning student can tell
                            apart a tile they already have content in from one
                            they haven't opened yet at a glance, before even
                            reading the "recent generations" list below. A
                            real mastery ring (never fabricated — only ever
                            set for a section the caller has real data for,
                            see sectionMasteryPct's own doc comment) replaces
                            the plain dot when available. */}
                        {isDone && !isGenerating && (
                          typeof masteryPct === "number" ? (
                            <ProgressRing
                              completed={masteryPct}
                              total={100}
                              size={isCollapsed ? 18 : 22}
                              strokeWidth={2.5}
                              showLabel={false}
                              className="absolute right-1 top-1"
                              aria-label={`${tStudio("masteryAriaLabel", language)} ${masteryPct}%`}
                            />
                          ) : (
                            <span
                              aria-hidden
                              className={cn("absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full", tint.dot)}
                            />
                          )
                        )}
                        {isLocked && (
                          <span
                            aria-label={tStudio("lockedTileAriaLabel", language)}
                            className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--background)_80%,transparent)] text-muted-foreground shadow-sm"
                          >
                            <Lock className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </button>
                      {showOptionsMenu && (
                        <button
                          type="button"
                          aria-label={tStudio("optionsMenuAria", language)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOptionsMenuFor((prev) => (prev === section.id ? null : section.id));
                          }}
                          className="absolute right-1.5 top-1.5 z-10 rounded-md p-0.5 text-[color-mix(in_oklab,var(--foreground)_50%,transparent)] transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {optionsMenuFor === section.id && (
                        <TileOptionsMenu
                          sectionId={section.id}
                          language={language}
                          onClose={() => setOptionsMenuFor(null)}
                          onGenerate={(options) => onItemClickWithOptions?.(section.id, options)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {!isCollapsed && generations.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Sparkles className="h-3 w-3" />
                    {tStudio("recentlyGenerated", language)}
                  </p>
                  {generations.map((section) => {
                    const Icon = section.icon;
                    const isGenerating = generatingSections.has(section.id) || (regeneratingSections?.has(section.id) ?? false);

                    if (isGenerating) {
                      return (
                        <div
                          key={section.id}
                          className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm text-muted-foreground"
                        >
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                          <GeneratingRotatingLabel className="truncate" />
                        </div>
                      );
                    }

                    return (
                      <div
                        key={section.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onItemClick(section.id)}
                        onKeyDown={(e) => e.key === "Enter" && onItemClick(section.id)}
                        className="group flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 transition-all duration-300 hover:translate-x-0.5 hover:bg-accent"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {getSectionLabel(section.id, language, studyYear)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            <RelativeTime timestamp={lastGeneratedAt} />
                          </p>
                        </div>
                        {typeof sectionMasteryPct?.[section.id] === "number" && (
                          <ProgressRing
                            completed={sectionMasteryPct[section.id]!}
                            total={100}
                            size={30}
                            strokeWidth={3}
                            className="shrink-0"
                            label={<span className="text-[9px] font-bold text-foreground">{sectionMasteryPct[section.id]}%</span>}
                            aria-label={`${tStudio("masteryAriaLabel", language)} ${sectionMasteryPct[section.id]}%`}
                          />
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Options"
                              className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-all duration-300 hover:bg-accent hover:text-foreground"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>{tStudio("delete", language)}</DropdownMenuItem>
                            {onRegenerateSection && REGENERATABLE_SECTIONS.has(section.id) && (
                              <RegenerateMenuItem onSelect={() => onRegenerateSection(section.id)} left={qcmRegenerationsLeft} />
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              )}

              {labTools && labTools.length > 0 && onOpenLabTool && (
                <section aria-label="MedArt Lab" className="space-y-1.5">
                  {!isCollapsed && (
                    <p className="flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <LAB_HEADING_ICON className="h-3 w-3" />
                      MedArt Lab
                    </p>
                  )}
                  <div className={cn("grid gap-1.5 md:gap-2", isCollapsed ? "grid-cols-1" : "grid-cols-1 min-[420px]:grid-cols-2")}>
                    {labTools.map((tool, index) => {
                      const ToolIcon = tool.icon;
                      return (
                        <Tooltip key={tool.id}>
                          <TooltipTrigger asChild>
                            <motion.button
                              type="button"
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: index * 0.04, type: "spring", stiffness: 420, damping: 32 }}
                              whileHover={{ y: -2 }}
                              whileTap={{ scale: 0.97 }}
                              onClick={() => onOpenLabTool(tool.id)}
                              aria-label={tool.label}
                              className={cn(
                                "group relative flex min-w-0 items-center gap-2.5 rounded-xl border text-left transition-shadow duration-200 hover:border-primary/50 hover:shadow-glow",
                                isCollapsed ? "aspect-square justify-center p-2" : "px-3 py-2.5",
                                tool.tint.bg
                              )}
                            >
                              <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-white/70 shadow-sm dark:bg-white/5", isCollapsed ? "h-9 w-9" : "h-8 w-8", tool.tint.icon)}>
                                <ToolIcon className={isCollapsed ? "h-5 w-5" : "h-4 w-4"} />
                              </span>
                              {!isCollapsed && (
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-semibold text-foreground md:text-sm">{tool.label}</span>
                                  <span className="block truncate text-[11px] text-muted-foreground">{tool.description}</span>
                                </span>
                              )}
                            </motion.button>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-[16rem] whitespace-normal">
                            {tool.description}
                            {" — généré une seule fois pour tous : gratuit s'il existe déjà pour ce cours, sinon 1 crédit de ton forfait."}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {!openedSection && !openedLab && !isNoteOpen && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenNote}
                aria-label="Ajouter une note"
                className={cn(
                  "absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary-600 text-sm font-medium text-white shadow-glow transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary-500 active:scale-[0.96] dark:bg-primary-500 dark:hover:bg-primary-400",
                  isCollapsed ? "p-3" : "px-6 py-3"
                )}
              >
                <SquarePen className="h-4 w-4" />
                {!isCollapsed && "Ajouter une note"}
              </button>
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-2">
              Note rapide
              <span className="flex items-center gap-0.5">
                <Kbd tone="inverse">⇧</Kbd>
                <Kbd tone="inverse">N</Kbd>
              </span>
            </TooltipContent>
          </Tooltip>
        )}

        {isNoteOpen && (
          <div className="animate-fade-in absolute inset-0 z-20 flex flex-col rounded-3xl bg-card">
            <div className="flex flex-wrap items-center gap-0.5 gap-y-1 border-b border-border px-2 py-1.5">
              <button type="button" aria-label={tStudio("undoAria", language)} title={tStudio("undoAria", language)} onClick={() => triggerNoteHistory("undo")} disabled={isNotePreview} className={TOOLBAR_BUTTON_CLASSES}>
                <Undo2 className="h-4 w-4" />
              </button>
              <button type="button" aria-label={tStudio("redoAria", language)} title={tStudio("redoAria", language)} onClick={() => triggerNoteHistory("redo")} disabled={isNotePreview} className={TOOLBAR_BUTTON_CLASSES}>
                <Redo2 className="h-4 w-4" />
              </button>
              <span className="mx-1 h-4 w-px shrink-0 bg-border" />
              <button
                type="button"
                onClick={clearNoteSelectionFormatting}
                disabled={isNotePreview}
                title="Retirer la mise en forme de la sélection"
                className={cn(TOOLBAR_BUTTON_CLASSES, "px-2 text-xs font-medium")}
              >
                {tStudio("normal", language)}
              </button>
              <button type="button" aria-label="Titre de section" title="Titre de section" onClick={() => prefixNoteLines("## ")} disabled={isNotePreview} className={TOOLBAR_BUTTON_CLASSES}>
                <Heading2 className="h-4 w-4" />
              </button>
              <button type="button" aria-label={tStudio("boldAria", language)} title={tStudio("boldAria", language)} onClick={() => wrapNoteSelection("**")} disabled={isNotePreview} className={TOOLBAR_BUTTON_CLASSES}>
                <Bold className="h-4 w-4" />
              </button>
              <button type="button" aria-label={tStudio("italicAria", language)} title={tStudio("italicAria", language)} onClick={() => wrapNoteSelection("*")} disabled={isNotePreview} className={TOOLBAR_BUTTON_CLASSES}>
                <Italic className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Liste à puces" title="Liste à puces" onClick={() => prefixNoteLines("- ")} disabled={isNotePreview} className={TOOLBAR_BUTTON_CLASSES}>
                <List className="h-4 w-4" />
              </button>
              <button type="button" aria-label={tStudio("linkAria", language)} title={tStudio("linkAria", language)} onClick={() => wrapNoteSelection("[", "](https://)")} disabled={isNotePreview} className={TOOLBAR_BUTTON_CLASSES}>
                <Link2 className="h-4 w-4" />
              </button>
              <button type="button" aria-label={tStudio("codeAria", language)} title={tStudio("codeAria", language)} onClick={() => wrapNoteSelection("`")} disabled={isNotePreview} className={TOOLBAR_BUTTON_CLASSES}>
                <Code className="h-4 w-4" />
              </button>
              {noteSourceLink && (
                <button
                  type="button"
                  aria-label="Lier la note au cours"
                  title={`Insérer un lien vers « ${noteSourceLink.label} »`}
                  onClick={() => insertAtNoteCursor(`\n> 📎 Source : [${noteSourceLink.label}](${noteSourceLink.href})\n`)}
                  disabled={isNotePreview}
                  className={TOOLBAR_BUTTON_CLASSES}
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              )}
              <span className="ml-auto flex shrink-0 items-center rounded-lg border border-border p-0.5" role="group" aria-label="Mode d'affichage de la note">
                <button
                  type="button"
                  onClick={() => setIsNotePreview(false)}
                  aria-pressed={!isNotePreview}
                  className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors", !isNotePreview ? "bg-primary-600 text-white dark:bg-primary-500" : "text-muted-foreground hover:text-foreground")}
                >
                  <PencilLine className="h-3 w-3" />
                  Écrire
                </button>
                <button
                  type="button"
                  onClick={() => setIsNotePreview(true)}
                  aria-pressed={isNotePreview}
                  className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors", isNotePreview ? "bg-primary-600 text-white dark:bg-primary-500" : "text-muted-foreground hover:text-foreground")}
                >
                  <Eye className="h-3 w-3" />
                  Aperçu
                </button>
              </span>
            </div>

            {onNoteTitleChange ? (
              <input
                value={noteTitle ?? ""}
                onChange={(e) => onNoteTitleChange(e.target.value)}
                placeholder="Titre de la note"
                aria-label="Titre de la note"
                maxLength={160}
                className="mx-4 mt-3 border-b border-transparent bg-transparent pb-1 text-base font-semibold text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary-300"
              />
            ) : (
              <p className="px-4 pt-3 text-sm font-semibold text-foreground">Nouvelle note</p>
            )}

            {isNotePreview ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {noteContent.trim() ? (
                  <div ref={notePreviewRef} className={cn(isDarkTheme ? DARK_PROSE_CLASSES : PROSE_CLASSES, "prose-base md:prose-base max-w-none md:max-w-none")}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={isDarkTheme ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}>
                      {noteContent}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Rien à afficher pour l&apos;instant — écris ta note en Markdown.</p>
                )}
              </div>
            ) : (
              <textarea
                ref={noteTextareaRef}
                value={noteContent}
                onChange={(e) => onNoteContentChange(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                    e.preventDefault();
                    if (!isSavingNote && noteContent.trim()) onSaveNote();
                  }
                }}
                placeholder={tStudio("notePlaceholder", language)}
                autoFocus
                className="text-reading min-h-0 flex-1 resize-none bg-transparent p-4 text-foreground outline-none placeholder:text-muted-foreground"
              />
            )}

            <div className="flex items-center gap-2 border-t border-border p-3">
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {noteWordCount} mot{noteWordCount > 1 ? "s" : ""}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleExportNotePdf}
                    disabled={!noteContent.trim() || isExportingNote}
                    aria-label="Exporter la note en PDF"
                    className="ml-auto flex h-8 items-center gap-1.5 rounded-xl border border-border px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                  >
                    {isExportingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                    PDF
                  </button>
                </TooltipTrigger>
                <TooltipContent>Exporter la note en PDF</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" className="rounded-xl" onClick={onSaveNote} disabled={isSavingNote || !noteContent.trim()}>
                    {isSavingNote && <Loader2 className="h-4 w-4 animate-spin" />}
                    {tStudio("save", language)}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="flex items-center gap-2">
                  Enregistrer dans Mes notes
                  <span className="flex items-center gap-0.5">
                    <Kbd tone="inverse">Ctrl</Kbd>
                    <Kbd tone="inverse">S</Kbd>
                  </span>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
      </div>

      {selection && (
        <TextSelectionToolbar
          ref={tooltipRef}
          selection={selection}
          onAsk={(text) => {
            onAskSelection(text);
            clearSelection();
          }}
          onTranslate={(text) => {
            onTranslateSelection(text);
            clearSelection();
          }}
          moduleId={moduleId}
          courseTitle={courseTitle}
          courseSlug={courseSlug}
          container={container}
        />
      )}

      {isSectionExpanded &&
        isDetailOpen &&
        isMounted &&
        createPortal(
          // Rendered via a portal straight to <body> — deliberately, not for
          // style. `position: fixed` is only viewport-relative as long as no
          // ancestor sets `transform`/`filter`/`will-change` (which creates a
          // new containing block and traps a "fixed" child inside it instead
          // of the real viewport). This panel sits under several such
          // ancestors elsewhere in the app (Framer Motion's `motion.*`
          // components, used by Button, set `transform`), so a portal is the
          // reliable fix rather than hoping the DOM tree never grows one.
          <div
            className={cn(
              // True edge-to-edge (inset-0, no rounding) below sm — this is
              // the actual "100dvh fullscreen" mode the mobile bottom-sheet
              // spec asked for, not a floating panel with margins. From sm:
              // up (real trackpad/mouse precision, no thumb reaching for a
              // corner), the softer inset-4 floating-card treatment returns.
              "animate-fade-in fixed inset-0 z-[999] isolate flex flex-col rounded-none shadow-glass dark:shadow-glass-dark sm:inset-4 sm:rounded-3xl",
              "max-sm:pb-[env(safe-area-inset-bottom)] max-sm:pl-[env(safe-area-inset-left)] max-sm:pr-[env(safe-area-inset-right)] max-sm:pt-[env(safe-area-inset-top)]",
              detailBg || "bg-card"
            )}
          >
            <div className="flex items-center gap-2 border-b border-border p-4">
              {openedSection && openedTint && openedSectionData && (
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-xl shadow-glow", openedTint.bg, openedTint.icon)}>
                  <openedSectionData.icon className="h-4 w-4" />
                </span>
              )}
              {openedLab && (
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border shadow-glow", openedLab.tint.bg, openedLab.tint.icon)}>
                  <openedLab.icon className="h-4 w-4" />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{openedSection ? openedLabel : openedLab?.label}</span>
              {openedSection && (
                <SectionOptionsMenu
                  sectionId={openedSection}
                  onRegenerateSection={onRegenerateSection}
                  isRegenerating={regeneratingSections?.has(openedSection) ?? false}
                  regenerationsLeft={qcmRegenerationsLeft}
                  triggerClassName={GLASS_ICON_BUTTON_CLASSES}
                />
              )}
              <button
                type="button"
                onClick={() => setIsSectionExpanded(false)}
                aria-label={tStudio("minimizeAria", language)}
                className={GLASS_EXIT_BUTTON_CLASSES}
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
            {/* text-select-stable — see its own comment in app/globals.css. */}
            <div ref={containerRef} data-selectable className="text-select-stable flex-1 overflow-y-auto p-6">
              {detailContent}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
