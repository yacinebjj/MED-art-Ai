"use client";

import { memo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Lock, MoreVertical, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import { tStudio, getSectionLabel } from "@/lib/translations/studio";
import { ProgressRing } from "@/components/ui/ProgressRing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import {
  SECTIONS_WITH_OPTIONS_MENU,
  TILE_TINTS,
  TileOptionsMenu,
  type SectionStatus,
  type TileGenerationOptions,
} from "@/components/course/workspace/StudioPanel";
import { GeneratingRotatingLabel } from "@/components/course/workspace/GeneratingRotatingLabel";
import { ExplicationGeneratingLabel } from "@/components/course/workspace/ExplicationGeneratingLabel";
import type { DemoSection, DemoSectionId } from "@/lib/demo-content";

interface MobileStudioCardsProps {
  sections: DemoSection[];
  getSectionStatus: (id: DemoSectionId) => SectionStatus;
  /** A Set, not a single id — mirrors StudioPanelProps' own field: several sections can now generate concurrently, each card checks its OWN membership. */
  generatingSections: Set<DemoSectionId>;
  onItemClick: (id: DemoSectionId) => void;
  /** Point 5 fix — mirrors StudioPanelProps' own field verbatim: fires from a not-yet-generated card's ChevronDown options menu with the student's chosen language/prompt/model/dialect, instead of the plain default-options onItemClick above. Optional: a caller that omits this simply never renders the ChevronDown (every card falls back to its previous plain-click-only behavior). */
  onItemClickWithOptions?: (id: DemoSectionId, options: TileGenerationOptions) => void;
  /** Optional — mirrors StudioPanelProps' own field of the same name verbatim (see that file's doc comment): omitted entirely by pages backed by a data model "Régénérer" doesn't support yet, in which case an already-generated card simply never shows the "Régénération en cours..." busy state, it has no way to reach one. */
  regeneratingSections?: Set<DemoSectionId>;
  /** Optional — mirrors StudioPanelProps' own field of the same name verbatim. Omitted entirely by pages backed by a data model "Régénérer" doesn't support yet, in which case an already-generated card's "..." menu simply doesn't render a "Régénérer" item (falls back to just "Supprimer") — see StudioPanel.tsx's own identical gate. */
  onRegenerateSection?: (id: DemoSectionId) => void;
  /** The student's own curriculum level (StudentCurriculumProfile.academicYear.level, types/academic.ts) — only ever changes the "Cas Clinique" tile's own label (getSectionLabel, lib/translations/studio.ts); every other tile ignores it. Mirrors StudioPanelProps' own field of the same name verbatim. */
  studyYear?: number | null;
  /** Visual-only lock badge — mirrors StudioPanelProps.lockedSections verbatim (see that file's own doc comment). The real gate stays entirely in the caller's onItemClick. */
  lockedSections?: Set<DemoSectionId>;
  /** Real mastery percentage per section (today only ever "qcm") — mirrors StudioPanelProps.sectionMasteryPct verbatim. Never fabricated. */
  sectionMasteryPct?: Partial<Record<DemoSectionId, number>>;
}

/**
 * The "..." trigger + its menu for one already-generated card. Pulled out of
 * the map body purely to keep that map readable — it owns no state of its
 * own. Mirrors StudioPanel's own desktop "Récemment généré" list menu
 * verbatim (same two items, same conditional Régénérer gate, same bare/
 * unwired Supprimer — see that file for why Supprimer has no handler yet)
 * rather than inventing a second, divergent menu design for mobile.
 */
function CardOptionsMenu({
  sectionId,
  onRegenerateSection,
}: {
  sectionId: DemoSectionId;
  onRegenerateSection?: (id: DemoSectionId) => void;
}) {
  const { language } = useLanguage();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label="Options"
          className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-all duration-300 hover:bg-accent hover:text-foreground active:scale-[0.94]"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Cas Clinique regeneration is permanently disabled by product
            direction — mirrors StudioPanel's own identical gate. */}
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
 * Mobile Studio "browse" view — NotebookLM-style large horizontal cards, one
 * per real Studio mode (see lib/demo-content.ts's own doc comment: no
 * fabricated "Audio Overview"/"Flashcards" tiles for features this app
 * doesn't have, every card here opens a real, working section). Reuses
 * StudioPanel's own TILE_TINTS so the color identity for e.g. "Résumé" is
 * identical between the desktop small-tile grid and this mobile large-card
 * one. Shown only while no section is open — once `onItemClick` leads to an
 * already-generated section, the caller swaps this out for the full
 * StudioPanel detail view (compact inline, or its own fullscreen mode)
 * instead of duplicating that rendering here.
 *
 * Three distinct card states, one per row in the map below:
 *  - generating (first ever run): a plain, non-interactive status row
 *    (Loader2 spin + "Génération en cours...") — nothing to tap into yet,
 *    so it gets no role/handlers at all, mirroring StudioPanel's own
 *    generating row in its desktop "Récemment généré" list.
 *  - regenerating (content already exists, a fresh variation is in
 *    flight): stays a normal, tappable card — a student can keep reading
 *    the current version while the new one is generated — but its "..."
 *    trigger morphs into a static RefreshCw spin in the same slot, so the
 *    one button that actually kicked this off is what visibly shows the
 *    animation, without reinventing a new busy-state system beyond the
 *    regeneratingSections/onRegenerateSection pair StudioPanelProps already
 *    defines.
 *  - idle (available or not-yet-generated): the ordinary tappable card.
 *    Only the "available" case — an already-generated result — gets the
 *    "..." (MoreVertical) trigger; a not-yet-generated tile has nothing to
 *    regenerate or delete, so it keeps its plain ChevronRight instead.
 *
 * Wrapped in React.memo — the caller (app/dashboard/module/[id]/page.tsx)
 * passes `getSectionStatus`/`onItemClick` as useCallback-stabilized
 * references specifically so this skips re-rendering on unrelated parent
 * state changes (a chat-input keystroke, a typing indicator), re-rendering
 * only when `sections`, `generatingSections`, or the two callbacks actually
 * change.
 */
export const MobileStudioCards = memo(function MobileStudioCards({
  sections,
  getSectionStatus,
  generatingSections,
  onItemClick,
  onItemClickWithOptions,
  regeneratingSections,
  onRegenerateSection,
  studyYear,
  lockedSections,
  sectionMasteryPct,
}: MobileStudioCardsProps) {
  const { language } = useLanguage();
  const hasAnyResult = sections.some((section) => getSectionStatus(section.id) === "available");
  // Point 5 fix — which not-yet-generated card's options popover is open,
  // if any. Mirrors StudioPanel.tsx's own identical `optionsMenuFor` state.
  const [optionsMenuFor, setOptionsMenuFor] = useState<DemoSectionId | null>(null);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="flex flex-col gap-2">
        {sections.map((section) => {
          const Icon = section.icon;
          const status = getSectionStatus(section.id);
          const isGenerating = generatingSections.has(section.id);
          const tint = TILE_TINTS[section.id];

          // Nothing exists yet for this tile — a plain busy row, no
          // role/handlers (there is no content to open mid-generation).
          if (isGenerating) {
            return (
              <div
                key={section.id}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border p-2.5 text-left shadow-soft opacity-70",
                  tint.bg
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background/70 shadow-soft dark:bg-background/30",
                    tint.icon
                  )}
                >
                  <Loader2 className="h-5 w-5 animate-spin" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{getSectionLabel(section.id, language, studyYear)}</p>
                  {section.id === "explication" ? (
                    <ExplicationGeneratingLabel className="truncate text-xs text-muted-foreground" />
                  ) : (
                    <GeneratingRotatingLabel className="truncate text-xs text-muted-foreground" />
                  )}
                </div>
              </div>
            );
          }

          const isAvailable = status === "available";
          const isRegenerating = regeneratingSections?.has(section.id) ?? false;
          const isLocked = lockedSections?.has(section.id) ?? false;
          const masteryPct = sectionMasteryPct?.[section.id];
          // Point 5 fix — same gate as StudioPanel.tsx's own showOptionsMenu:
          // only a not-yet-generated card offers the pre-generation
          // language/prompt menu; Exemples & Analogies never gets one.
          const showOptionsMenu =
            Boolean(onItemClickWithOptions) && !isAvailable && !isLocked && SECTIONS_WITH_OPTIONS_MENU.has(section.id);

          return (
            <div
              key={section.id}
              role="button"
              tabIndex={0}
              title={isLocked ? tStudio("lockedTileTooltip", language) : undefined}
              onClick={() => onItemClick(section.id)}
              onKeyDown={(e) => e.key === "Enter" && onItemClick(section.id)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-2xl border p-2.5 text-left shadow-soft transition-all duration-300 active:scale-[0.98]",
                tint.bg,
                isLocked && "opacity-50 saturate-[0.4] active:scale-100"
              )}
            >
              <span
                className={cn(
                  "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background/70 shadow-soft dark:bg-background/30",
                  tint.icon
                )}
              >
                {isLocked ? <Lock className="h-4 w-4" /> : <Icon className="h-5 w-5" />}
              </span>
              <div className="min-w-0 flex-1">
                {/* line-clamp-2, not truncate — a long label ("Ultra-
                    Detailed Summary", "Examples & Analogies") used to
                    hard-truncate to one illegible line on this card too. */}
                <p className="line-clamp-2 break-words text-sm font-semibold text-foreground" title={getSectionLabel(section.id, language, studyYear)}>
                  {getSectionLabel(section.id, language, studyYear)}
                </p>
                {isRegenerating ? (
                  <GeneratingRotatingLabel className="truncate text-xs text-muted-foreground" />
                ) : (
                  <p className="truncate text-xs text-muted-foreground">
                    {isAvailable
                      ? tStudio("alreadyGeneratedCaption", language)
                      : tStudio("tapToGenerateCaption", language)}
                  </p>
                )}
              </div>
              {isRegenerating ? (
                <RefreshCw aria-hidden className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : isAvailable ? (
                <>
                  {typeof masteryPct === "number" ? (
                    <ProgressRing
                      completed={masteryPct}
                      total={100}
                      size={28}
                      strokeWidth={3}
                      className="shrink-0"
                      label={<span className="text-[9px] font-bold text-foreground">{masteryPct}%</span>}
                      aria-label={`${tStudio("masteryAriaLabel", language)} ${masteryPct}%`}
                    />
                  ) : (
                    <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tint.dot)} />
                  )}
                  <CardOptionsMenu sectionId={section.id} onRegenerateSection={onRegenerateSection} />
                </>
              ) : showOptionsMenu ? (
                <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    aria-label={tStudio("optionsMenuAria", language)}
                    onClick={() => setOptionsMenuFor((prev) => (prev === section.id ? null : section.id))}
                    className="rounded-full p-1.5 text-muted-foreground transition-all duration-300 hover:bg-accent hover:text-foreground active:scale-[0.94]"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  {optionsMenuFor === section.id && (
                    <TileOptionsMenu
                      sectionId={section.id}
                      language={language}
                      onClose={() => setOptionsMenuFor(null)}
                      onGenerate={(options) => onItemClickWithOptions?.(section.id, options)}
                    />
                  )}
                </div>
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </div>
          );
        })}
      </div>

      {!hasAnyResult && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {tStudio("emptyState", language)}
        </p>
      )}
    </div>
  );
});
