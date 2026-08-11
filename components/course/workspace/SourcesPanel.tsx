"use client";

import { useState } from "react";
import { Columns2, FileText, MoreVertical, PanelLeftClose, Plus, Trash2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { useToast } from "@/components/ui/Toast";
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
import type { CourseStats } from "@/lib/course-stats";

interface SourcesPanelProps {
  sourceFileName: string;
  sourceSize: string;
  dateLabel: string;
  selected: boolean;
  onToggleSelected: (value: boolean) => void;
  courseTitle: string;
  courseSlug: string;
  /** Real when available (see the dashboard's course_mastery fetch) — undefined fields render an honest "—"/"pas encore de données" in CourseStatsModal rather than a fabricated number. This workspace doesn't fetch mastery data itself (yet), so this is deliberately the honest-empty default until it does. */
  stats?: CourseStats;
  isSplitScreen: boolean;
  onToggleSplitScreen: () => void;
  /** Collapses this panel to the Chat+Studio split view (the same layout "Afficher le cours" opens, minus its source-view content) — reversible any time via the Chat header's own split-screen toggle. */
  onClosePanel: () => void;
}

/**
 * Left "Sources" panel. Only the course's ONE real uploaded source is
 * rendered — inventing extra placeholder rows would misrepresent real course
 * content to a real student. "Add sources" opens the same unified,
 * tabbed <UploadModal> used on the dashboard (Fichier/Texte brut/Drive) —
 * this app has no multi-source-per-course backend yet, so both submit paths
 * honestly reject with an explanatory message shown inline in the modal
 * (never a false "success") instead of silently doing nothing.
 */
export function SourcesPanel({
  sourceFileName,
  sourceSize,
  dateLabel,
  selected,
  onToggleSelected,
  courseTitle,
  courseSlug,
  stats,
  isSplitScreen,
  onToggleSplitScreen,
  onClosePanel,
}: SourcesPanelProps) {
  const { toast } = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  async function rejectNotYetAvailable(): Promise<string> {
    throw new Error("Ce cours ne supporte qu'une seule source pour l'instant — l'ajout d'une source supplémentaire arrive dans une prochaine mise à jour.");
  }

  function handleConfirmDelete() {
    setDeleteOpen(false);
    toast({ variant: "info", title: "Bientôt disponible", description: "La suppression d'une source individuelle arrive dans une prochaine mise à jour." });
  }

  return (
    <>
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

      <div className="flex flex-1 flex-col space-y-4 overflow-y-auto p-4">
        <Button variant="outline" size="sm" className="w-full rounded-xl" onClick={() => setUploadOpen(true)}>
          <Plus className="h-4 w-4" />
          Add sources
        </Button>

        <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{sourceFileName}</p>
            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
              {dateLabel} · {sourceSize}
            </p>
          </div>
          <Checkbox checked={selected} onCheckedChange={(v) => onToggleSelected(v === true)} />

          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-neutral-800 dark:hover:text-gray-200"
              aria-label="Options de la source"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onToggleSplitScreen}>
                <Columns2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                {isSplitScreen ? "Fermer l'écran partagé" : "Afficher le cours"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setStatsOpen(true)}>
                <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                Statistiques
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" />
                Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer cette source ?</DialogTitle>
            <DialogDescription>
              « {sourceFileName} » sera retirée de ce cours. Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Annuler
            </Button>
            <Button type="button" variant="danger" onClick={handleConfirmDelete}>
              Supprimer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CourseStatsModal
        open={statsOpen}
        onOpenChange={setStatsOpen}
        courseTitle={courseTitle}
        courseSlug={courseSlug}
        stats={stats ?? { qcmSuccessPct: undefined, srsMasteryPct: undefined, readingPct: undefined }}
      />

      <UploadModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => {}}
        onSubmitFile={rejectNotYetAvailable}
        onSubmitText={rejectNotYetAvailable}
        title="Ajouter une source"
        description="Importe un document ou colle du texte pour ce cours."
      />
    </>
  );
}
