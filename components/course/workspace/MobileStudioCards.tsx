"use client";

import { memo } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TILE_TINTS, type SectionStatus } from "@/components/course/workspace/StudioPanel";
import type { DemoSection, DemoSectionId } from "@/lib/demo-content";

interface MobileStudioCardsProps {
  sections: DemoSection[];
  getSectionStatus: (id: DemoSectionId) => SectionStatus;
  generatingSection: DemoSectionId | null;
  onItemClick: (id: DemoSectionId) => void;
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
 * StudioPanel detail view instead of duplicating that rendering here.
 *
 * Wrapped in React.memo — the caller (app/dashboard/module/[id]/page.tsx)
 * passes `getSectionStatus`/`onItemClick` as useCallback-stabilized
 * references specifically so this skips re-rendering on unrelated parent
 * state changes (a chat-input keystroke, a typing indicator), re-rendering
 * only when `sections`, `generatingSection`, or the two callbacks actually
 * change.
 */
export const MobileStudioCards = memo(function MobileStudioCards({
  sections,
  getSectionStatus,
  generatingSection,
  onItemClick,
}: MobileStudioCardsProps) {
  const hasAnyResult = sections.some((section) => getSectionStatus(section.id) === "available");

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="flex flex-col gap-2">
        {sections.map((section) => {
          const Icon = section.icon;
          const status = getSectionStatus(section.id);
          const isGenerating = generatingSection === section.id;
          const tint = TILE_TINTS[section.id];

          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onItemClick(section.id)}
              disabled={isGenerating}
              className={cn(
                "flex items-center gap-3 rounded-2xl border p-2.5 text-left shadow-sm transition-transform active:scale-[0.98] disabled:cursor-wait disabled:opacity-70",
                tint.bg
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 dark:bg-black/20",
                  tint.icon
                )}
              >
                {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{section.label}</p>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {isGenerating ? "Génération en cours..." : status === "available" ? "Déjà généré — appuie pour ouvrir" : "Appuie pour générer"}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 dark:text-neutral-600" />
            </button>
          );
        })}
      </div>

      {!hasAnyResult && (
        <p className="py-4 text-center text-xs text-gray-400 dark:text-neutral-600">
          Les résultats de Studio seront enregistrés ici.
        </p>
      )}
    </div>
  );
});
