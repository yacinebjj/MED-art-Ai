"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Bold,
  Code,
  Italic,
  Link2,
  Loader2,
  Maximize2,
  Minimize2,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  RefreshCw,
  SlidersHorizontal,
  SquarePen,
  Trash2,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTextSelection } from "@/hooks/useTextSelection";
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
  generatingSection: DemoSectionId | null;
  /** Optional — omitted entirely by pages backed by a data model "Regénérer" doesn't support yet (see app/dashboard/demo/[slug]/page.tsx's legacy production pipeline), in which case the menu item is simply not rendered. */
  regeneratingSection?: DemoSectionId | null;
  onRegenerateSection?: (id: DemoSectionId) => void;
  sourceCount: number;
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
  /** Notified whenever the internal collapse toggle fires — the panel's own root controls its ephemeral (w-20 vs w-full) width, but the page-level `<aside>` wrapping it may want to shrink/grow its own fixed width in lockstep (see app/dashboard/module/[id]/page.tsx). Optional: a caller that omits this still gets a fully working collapse, just without the outer wrapper reacting. */
  onCollapsedChange?: (collapsed: boolean) => void;
  children: React.ReactNode;
}

/** Contrasted, interactive icon-button style for panel chrome (collapse/expand controls). */
const PANEL_ICON_BUTTON_CLASSES =
  "p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-neutral-400 dark:hover:text-gray-100 dark:hover:bg-neutral-800 transition-colors";

const TOOLBAR_BUTTON_CLASSES =
  "rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-neutral-800";

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

/** Soft tint per study mode — light-mode pastel + a discreet dark-mode counterpart. Exported for reuse by MobileStudioCards' large-card grid, so both surfaces share the exact same per-section color identity. */
export const TILE_TINTS: Record<DemoSectionId, { bg: string; icon: string }> = {
  explication: {
    bg: "bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-900/40",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  resume: {
    bg: "bg-blue-50/80 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-900/40",
    icon: "text-blue-600 dark:text-blue-400",
  },
  cas_clinique: {
    bg: "bg-amber-50/80 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-900/40",
    icon: "text-amber-600 dark:text-amber-400",
  },
  qcm: {
    bg: "bg-purple-50/80 dark:bg-purple-950/20 border-purple-200/50 dark:border-purple-900/40",
    icon: "text-purple-600 dark:text-purple-400",
  },
  exemples_analogies: {
    bg: "bg-yellow-50/80 dark:bg-yellow-950/20 border-yellow-200/50 dark:border-yellow-900/40",
    icon: "text-yellow-600 dark:text-yellow-400",
  },
};

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
  generatingSection,
  regeneratingSection,
  onRegenerateSection,
  sourceCount,
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
  onCollapsedChange,
  children,
}: StudioPanelProps) {
  const [isSectionExpanded, setIsSectionExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { containerRef, tooltipRef, selection, clearSelection } = useTextSelection();

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
    (section) => getSectionStatus(section.id) === "available" || generatingSection === section.id
  );

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden transition-all duration-300",
        isCollapsed ? "w-20" : "w-full"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between border-b border-gray-200 p-2 dark:border-neutral-800 md:p-4",
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
            {!isCollapsed && "Studio"}
          </button>
        ) : openedSection ? (
          <button
            type="button"
            onClick={onCloseSection}
            className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span className="truncate">{openedLabel}</span>}
          </button>
        ) : (
          !isCollapsed && (
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Filtrer" className={TOOLBAR_BUTTON_CLASSES}>
                <SlidersHorizontal className="h-4 w-4" />
              </button>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Studio</h2>
            </div>
          )
        )}

        <div className="flex items-center gap-1">
          {isNoteOpen ? (
            <button
              type="button"
              onClick={onDeleteNote}
              aria-label="Supprimer la note"
              className={PANEL_ICON_BUTTON_CLASSES}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : (
            <>
              {openedSection && !isCollapsed && (
                <button
                  type="button"
                  onClick={() => setIsSectionExpanded(true)}
                  aria-label="Agrandir"
                  className={PANEL_ICON_BUTTON_CLASSES}
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={isCollapsed ? "Ouvrir le panneau" : "Réduire le panneau"}
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
              <div ref={containerRef} className="p-2 md:p-4">
                {children}
              </div>
            )
          ) : (
            <div className={cn("space-y-3 p-2 pb-20 md:space-y-6 md:p-4 md:pb-24", isCollapsed && "px-2")}>
              <div className={cn("grid gap-1.5 md:gap-2", isCollapsed ? "grid-cols-1" : "grid-cols-2")}>
                {sections.map((section) => {
                  const Icon = section.icon;
                  const isGenerating = generatingSection === section.id;
                  const tint = TILE_TINTS[section.id];
                  return (
                    <button
                      key={section.id}
                      type="button"
                      disabled={isGenerating}
                      onClick={() => onItemClick(section.id)}
                      title={isCollapsed ? section.label : undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border text-xs font-medium text-gray-700 transition-all hover:scale-[1.01] hover:shadow-sm disabled:cursor-wait disabled:opacity-70 disabled:hover:scale-100 dark:text-gray-200 md:text-sm",
                        isCollapsed ? "aspect-square flex-col justify-center p-2" : "justify-between p-2 text-left md:p-3",
                        tint.bg
                      )}
                    >
                      {!isCollapsed && <span className="truncate">{section.label}</span>}
                      {isGenerating ? (
                        <Loader2 className={cn("shrink-0 animate-spin text-gray-400", isCollapsed ? "h-5 w-5" : "h-4 w-4")} />
                      ) : (
                        <Icon className={cn("shrink-0", isCollapsed ? "h-5 w-5" : "h-4 w-4", tint.icon)} />
                      )}
                    </button>
                  );
                })}
              </div>

              {!isCollapsed && generations.length > 0 && (
                <div className="flex flex-col gap-1">
                  {generations.map((section) => {
                    const Icon = section.icon;
                    const isGenerating = generatingSection === section.id;
                    const isRegenerating = regeneratingSection === section.id;

                    if (isGenerating) {
                      return (
                        <div
                          key={section.id}
                          className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm text-gray-500 dark:text-gray-400"
                        >
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                          <span className="truncate">
                            Generating {section.label.toLowerCase()}... based on {sourceCount} source
                            {sourceCount > 1 ? "s" : ""}
                          </span>
                        </div>
                      );
                    }

                    if (isRegenerating) {
                      return (
                        <div
                          key={section.id}
                          className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm text-gray-500 dark:text-gray-400"
                        >
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                          <span className="truncate">Régénération de {section.label.toLowerCase()}...</span>
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
                        className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                            {section.label}
                          </p>
                          <p className="text-xs text-gray-400">
                            {sourceCount} source{sourceCount > 1 ? "s" : ""}
                          </p>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Options"
                              className="shrink-0 rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-neutral-700"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {onRegenerateSection && (
                              <DropdownMenuItem onSelect={() => onRegenerateSection(section.id)}>
                                <RefreshCw className="h-4 w-4" />
                                Regénérer
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem>Supprimer</DropdownMenuItem>
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
              "absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-gray-900 text-sm font-medium text-white shadow-lg transition-transform hover:scale-105 dark:bg-gray-100 dark:text-gray-900",
              isCollapsed ? "p-3" : "px-6 py-3"
            )}
          >
            <SquarePen className="h-4 w-4" />
            {!isCollapsed && "Add note"}
          </button>
        )}

        {isNoteOpen && (
          <div className="absolute inset-0 z-20 flex flex-col rounded-3xl bg-white dark:bg-neutral-900">
            <div className="flex items-center gap-1 border-b border-gray-200 px-3 py-2 dark:border-neutral-800">
              <button type="button" aria-label="Annuler" className={TOOLBAR_BUTTON_CLASSES}>
                <Undo2 className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Rétablir" className={TOOLBAR_BUTTON_CLASSES}>
                <Redo2 className="h-4 w-4" />
              </button>
              <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-neutral-700" />
              <button type="button" className={cn(TOOLBAR_BUTTON_CLASSES, "px-2 text-xs font-medium")}>
                Normal
              </button>
              <button type="button" aria-label="Gras" className={TOOLBAR_BUTTON_CLASSES}>
                <Bold className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Italique" className={TOOLBAR_BUTTON_CLASSES}>
                <Italic className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Lien" className={TOOLBAR_BUTTON_CLASSES}>
                <Link2 className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Code" className={TOOLBAR_BUTTON_CLASSES}>
                <Code className="h-4 w-4" />
              </button>
            </div>

            <p className="px-4 pt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">New note</p>

            <textarea
              value={noteContent}
              onChange={(e) => onNoteContentChange(e.target.value)}
              placeholder="Écris ta note ici..."
              className="flex-1 resize-none bg-transparent p-4 text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-600"
            />

            <div className="border-t border-gray-200 p-4 dark:border-neutral-800">
              <Button
                size="sm"
                className="w-full rounded-xl"
                onClick={onSaveNote}
                disabled={isSavingNote || !noteContent.trim()}
              >
                {isSavingNote && <Loader2 className="h-4 w-4 animate-spin" />}
                Sauvegarder
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
              "fixed inset-4 z-[999] isolate flex flex-col rounded-3xl shadow-2xl",
              detailBg || "bg-white dark:bg-neutral-900"
            )}
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-neutral-800">
              <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{openedLabel}</span>
              <button
                type="button"
                onClick={() => setIsSectionExpanded(false)}
                aria-label="Réduire"
                className={PANEL_ICON_BUTTON_CLASSES}
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
            <div ref={containerRef} className="flex-1 overflow-y-auto p-6">
              {children}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
