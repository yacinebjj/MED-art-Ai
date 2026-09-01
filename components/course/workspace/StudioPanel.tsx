"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Bold,
  ChevronRight,
  Code,
  Italic,
  Link2,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Trash2,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTextSelection } from "@/hooks/useTextSelection";
import { useLanguage } from "@/providers/LanguageProvider";
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

interface StudioPanelProps {
  sections: DemoSection[];
  openedSection: DemoSectionId | null;
  openedLabel: string;
  onItemClick: (id: DemoSectionId) => void;
  onCloseSection: () => void;
  getSectionStatus: (id: DemoSectionId) => SectionStatus;
  /** A Set, not a single id — several sections can now generate concurrently (a student clicking Résumé no longer blocks clicking Cas Clinique before the first finishes). Each tile checks its OWN membership (`.has(section.id)`), never a single shared value. */
  generatingSections: Set<DemoSectionId>;
  /** Optional — omitted entirely by pages backed by a data model "Regénérer" doesn't support yet (see app/dashboard/demo/[slug]/page.tsx's legacy production pipeline), in which case the menu item is simply not rendered. Same Set-based shape as generatingSections. */
  regeneratingSections?: Set<DemoSectionId>;
  onRegenerateSection?: (id: DemoSectionId) => void;
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
};

/**
 * "..." trigger + Régénérer/Supprimer menu for the OPENED section's own
 * detail-view header (both the inline collapsed header and the fullscreen
 * overlay header below) — mirrors, item-for-item, the identical DropdownMenu
 * already used further down for each "Récemment généré" list row: same two
 * items, same conditional Régénérer gate (hidden entirely when the caller
 * omits `onRegenerateSection`), same bare/unwired Supprimer. While a
 * regeneration for THIS section is in flight, the trigger itself morphs into
 * a static spinning RefreshCw in the same slot — matching
 * MobileStudioCards' own CardOptionsMenu regenerating treatment — instead of
 * opening a menu with nothing new to offer mid-flight.
 */
function SectionOptionsMenu({
  sectionId,
  onRegenerateSection,
  isRegenerating,
  triggerClassName,
}: {
  sectionId: DemoSectionId;
  onRegenerateSection?: (id: DemoSectionId) => void;
  isRegenerating: boolean;
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
        {/* Cas Clinique regeneration is permanently disabled by product
            direction — the 3 generated cases must stay static forever, so
            this item never renders for that section regardless of what the
            caller passes as onRegenerateSection. Enforced again server-side
            in app/api/studio/regenerate/route.ts — this is the UI half only. */}
        {onRegenerateSection && sectionId !== "cas_clinique" && (
          <DropdownMenuItem onSelect={() => onRegenerateSection(sectionId)}>
            <RefreshCw className="h-4 w-4" />
            {tStudio("regenerate", language)}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem>{tStudio("delete", language)}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  onCloseSection,
  getSectionStatus,
  generatingSections,
  regeneratingSections,
  onRegenerateSection,
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
  children,
}: StudioPanelProps) {
  const { language } = useLanguage();
  const [isSectionExpanded, setIsSectionExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { containerRef, container, tooltipRef, selection, clearSelection } = useTextSelection();
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);

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
    setIsCollapsed((prev) => {
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
  }, [openedSection]);

  // Escape closes the expanded overlay, matching every real Dialog in this
  // app (Radix's DismissableLayer closes on Escape by default) — this
  // overlay is a hand-rolled portal, not a Dialog, so it never got that for
  // free. Only listens while actually expanded, so it can never intercept
  // Escape meant for something else (a Radix Dialog stacked on top, a
  // browser feature) the rest of the time.
  useEffect(() => {
    if (!isSectionExpanded) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsSectionExpanded(false);
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
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg", openedTint.bg, openedTint.icon)}>
                    <openedSectionData.icon className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="truncate">{openedLabel}</span>
              </>
            )}
          </button>
        ) : (
          !isCollapsed && (
            <div className="flex items-center gap-2">
              <button type="button" aria-label={tStudio("filterAria", language)} className={TOOLBAR_BUTTON_CLASSES}>
                <SlidersHorizontal className="h-4 w-4" />
              </button>
              <h2 className="text-sm font-semibold text-foreground">{tStudio("studioHeading", language)}</h2>
            </div>
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
              {openedSection && !isCollapsed && (
                <SectionOptionsMenu
                  sectionId={openedSection}
                  onRegenerateSection={onRegenerateSection}
                  isRegenerating={regeneratingSections?.has(openedSection) ?? false}
                  triggerClassName={PANEL_ICON_BUTTON_CLASSES}
                />
              )}
              {openedSection && !isCollapsed && (
                <button
                  type="button"
                  onClick={() => setIsSectionExpanded(true)}
                  aria-label={tStudio("expandAria", language)}
                  className={PANEL_ICON_BUTTON_CLASSES}
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={tStudio(isCollapsed ? "openPanelAria" : "collapsePanelAria", language)}
                aria-pressed={isCollapsed}
                className={PANEL_ICON_BUTTON_CLASSES}
              >
                {isCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
              </button>
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
          ) : (
            <div className={cn("space-y-3 p-2 pb-20 md:space-y-6 md:p-4 md:pb-24", isCollapsed && "px-2")}>
              <div className={cn("grid gap-1.5 md:gap-2", isCollapsed ? "grid-cols-1" : "grid-cols-2")}>
                {sections.map((section) => {
                  const Icon = section.icon;
                  const isGenerating = generatingSections.has(section.id);
                  const tint = TILE_TINTS[section.id];
                  const isDone = getSectionStatus(section.id) === "available";
                  // Enforced Studio Pipeline — every section except
                  // Explication Ultra-Détaillée is locked until that one is
                  // generated for this course. Product decision, explicitly
                  // confirmed: does not reduce chat cost, forces a real
                  // generation on every course. getSectionStatus("explication")
                  // reflects the CURRENT course regardless of which section
                  // is being rendered here — reused rather than re-derived.
                  const isLocked = section.id !== "explication" && getSectionStatus("explication") !== "available";
                  return (
                    <button
                      key={section.id}
                      type="button"
                      disabled={isGenerating || isLocked}
                      onClick={() => onItemClick(section.id)}
                      title={isLocked ? tStudio("lockedTooltip", language) : isCollapsed ? getSectionLabel(section.id, language) : undefined}
                      aria-disabled={isLocked}
                      className={cn(
                        "group relative flex items-center gap-2 rounded-xl border text-xs font-medium text-foreground/80 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-none md:text-sm",
                        isGenerating && "disabled:cursor-wait",
                        isCollapsed ? "aspect-square flex-col justify-center p-2" : "justify-between p-2 text-left md:p-3",
                        tint.bg
                      )}
                    >
                      {!isCollapsed && <span className="truncate">{getSectionLabel(section.id, language)}</span>}
                      {isGenerating ? (
                        <Loader2 className={cn("shrink-0 animate-spin text-muted-foreground", isCollapsed ? "h-5 w-5" : "h-4 w-4")} />
                      ) : isLocked ? (
                        <Lock className={cn("shrink-0 text-muted-foreground", isCollapsed ? "h-5 w-5" : "h-4 w-4")} />
                      ) : (
                        <Icon
                          className={cn(
                            "shrink-0 transition-transform duration-300 group-hover:scale-110",
                            isCollapsed ? "h-5 w-5" : "h-4 w-4",
                            tint.icon
                          )}
                        />
                      )}
                      {/* A quiet "already generated" tell (no separate label,
                          no layout shift) so a returning student can tell
                          apart a tile they already have content in from one
                          they haven't opened yet at a glance, before even
                          reading the "recent generations" list below. */}
                      {isDone && !isGenerating && (
                        <span
                          aria-hidden
                          className={cn("absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full", tint.dot)}
                        />
                      )}
                    </button>
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
                    const isGenerating = generatingSections.has(section.id);
                    const isRegenerating = regeneratingSections?.has(section.id) ?? false;

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

                    if (isRegenerating) {
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
                            {getSectionLabel(section.id, language)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            <RelativeTime timestamp={lastGeneratedAt} />
                          </p>
                        </div>
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
                            {onRegenerateSection && section.id !== "cas_clinique" && (
                              <DropdownMenuItem onSelect={() => onRegenerateSection(section.id)}>
                                <RefreshCw className="h-4 w-4" />
                                {tStudio("regenerate", language)}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem>{tStudio("delete", language)}</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {!openedSection && !isNoteOpen && (
          <button
            type="button"
            onClick={onOpenNote}
            title={isCollapsed ? "Add note" : undefined}
            className={cn(
              "absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary-600 text-sm font-medium text-white shadow-glow transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary-500 active:scale-[0.96] dark:bg-primary-500 dark:hover:bg-primary-400",
              isCollapsed ? "p-3" : "px-6 py-3"
            )}
          >
            <SquarePen className="h-4 w-4" />
            {!isCollapsed && "Add note"}
          </button>
        )}

        {isNoteOpen && (
          <div className="animate-fade-in absolute inset-0 z-20 flex flex-col rounded-3xl bg-card">
            <div className="flex items-center gap-1 border-b border-border px-3 py-2">
              <button type="button" aria-label={tStudio("undoAria", language)} onClick={() => triggerNoteHistory("undo")} className={TOOLBAR_BUTTON_CLASSES}>
                <Undo2 className="h-4 w-4" />
              </button>
              <button type="button" aria-label={tStudio("redoAria", language)} onClick={() => triggerNoteHistory("redo")} className={TOOLBAR_BUTTON_CLASSES}>
                <Redo2 className="h-4 w-4" />
              </button>
              <span className="mx-1 h-4 w-px bg-border" />
              <button
                type="button"
                onClick={clearNoteSelectionFormatting}
                title="Retirer la mise en forme de la sélection"
                className={cn(TOOLBAR_BUTTON_CLASSES, "px-2 text-xs font-medium")}
              >
                {tStudio("normal", language)}
              </button>
              <button type="button" aria-label={tStudio("boldAria", language)} onClick={() => wrapNoteSelection("**")} className={TOOLBAR_BUTTON_CLASSES}>
                <Bold className="h-4 w-4" />
              </button>
              <button type="button" aria-label={tStudio("italicAria", language)} onClick={() => wrapNoteSelection("*")} className={TOOLBAR_BUTTON_CLASSES}>
                <Italic className="h-4 w-4" />
              </button>
              <button type="button" aria-label={tStudio("linkAria", language)} onClick={() => wrapNoteSelection("[", "](https://)")} className={TOOLBAR_BUTTON_CLASSES}>
                <Link2 className="h-4 w-4" />
              </button>
              <button type="button" aria-label={tStudio("codeAria", language)} onClick={() => wrapNoteSelection("`")} className={TOOLBAR_BUTTON_CLASSES}>
                <Code className="h-4 w-4" />
              </button>
            </div>

            <p className="px-4 pt-3 text-sm font-semibold text-foreground">New note</p>

            <textarea
              ref={noteTextareaRef}
              value={noteContent}
              onChange={(e) => onNoteContentChange(e.target.value)}
              placeholder={tStudio("notePlaceholder", language)}
              className="text-reading flex-1 resize-none bg-transparent p-4 text-foreground outline-none placeholder:text-muted-foreground"
            />

            <div className="border-t border-border p-4">
              <Button
                size="sm"
                className="w-full rounded-xl"
                onClick={onSaveNote}
                disabled={isSavingNote || !noteContent.trim()}
              >
                {isSavingNote && <Loader2 className="h-4 w-4 animate-spin" />}
                {tStudio("save", language)}
              </Button>
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
        openedSection &&
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
              detailBg || "bg-card"
            )}
          >
            <div className="flex items-center gap-2 border-b border-border p-4">
              {openedTint && openedSectionData && (
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", openedTint.bg, openedTint.icon)}>
                  <openedSectionData.icon className="h-4 w-4" />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{openedLabel}</span>
              <SectionOptionsMenu
                sectionId={openedSection}
                onRegenerateSection={onRegenerateSection}
                isRegenerating={regeneratingSections?.has(openedSection) ?? false}
                triggerClassName={GLASS_ICON_BUTTON_CLASSES}
              />
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
              {children}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
