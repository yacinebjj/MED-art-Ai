"use client";

import Link from "next/link";
import {
  Clipboard,
  FileText,
  Link2 as LinkIcon,
  PanelLeftClose,
  Plus,
  Search,
  Triangle,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/Dialog";

interface SourcesPanelProps {
  sourceFileName: string;
  sourceSize: string;
  dateLabel: string;
  selected: boolean;
  onToggleSelected: (value: boolean) => void;
}

/**
 * Left "Sources" panel. Only the course's ONE real uploaded source is
 * rendered — inventing extra placeholder rows would misrepresent real course
 * content to a real student, unlike the topbar's Settings menu (inert labels,
 * not factual claims about the user's own data). This app has no
 * multi-source-per-course or web-search-for-sources feature yet, so "Add
 * sources" opens a modal whose only REAL action is "Upload files" (routes to
 * the real upload flow); the other affordances announce themselves as
 * not-yet-available instead of silently doing nothing.
 */
export function SourcesPanel({ sourceFileName, sourceSize, dateLabel, selected, onToggleSelected }: SourcesPanelProps) {
  const { toast } = useToast();

  function notYetAvailable(feature: string) {
    toast({ variant: "info", title: "Bientôt disponible", description: `${feature} arrive dans une prochaine mise à jour.` });
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
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full rounded-xl">
              <Plus className="h-4 w-4" />
              Add sources
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl rounded-3xl p-8">
            <DialogHeader>
              <DialogTitle className="text-center text-2xl font-semibold text-gray-900 dark:text-gray-100">
                Create Audio and Video Overviews from{" "}
                <span className="bg-gradient-to-r from-emerald-500 to-blue-500 bg-clip-text text-transparent">
                  your documents
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="mt-6 flex items-center gap-2 rounded-full border border-gray-300 p-2 shadow-sm dark:border-neutral-700">
              <Input
                placeholder="Search the web for new sources"
                className="flex-1 border-none bg-transparent shadow-none dark:text-gray-100 dark:placeholder:text-gray-500"
              />
              <Badge variant="neutral" className="shrink-0">
                Web
              </Badge>
              <Badge variant="neutral" className="shrink-0">
                Fast research
              </Badge>
              <button
                type="button"
                onClick={() => notYetAvailable("La recherche web de sources")}
                aria-label="Rechercher"
                className="shrink-0 rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-neutral-800"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 flex flex-col items-center justify-center gap-2 rounded-2xl bg-gray-50 p-10 text-center dark:bg-neutral-900/50">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                or drop your files (pdf, images, docs, audio, and more)
              </p>

              <div className="mt-6 flex flex-wrap justify-center gap-4">
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard">
                    <Upload className="h-4 w-4" />
                    Upload files
                  </Link>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => notYetAvailable("L'ajout de sites web")}>
                  <LinkIcon className="h-4 w-4" />
                  Websites
                </Button>
                <Button variant="ghost" size="sm" onClick={() => notYetAvailable("La connexion à Drive")}>
                  <Triangle className="h-4 w-4" />
                  Drive
                </Button>
                <Button variant="ghost" size="sm" onClick={() => notYetAvailable("Le collage de texte")}>
                  <Clipboard className="h-4 w-4" />
                  Copied text
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <Input
            placeholder="Search the web..."
            className="border-none bg-gray-100 pl-9 shadow-none dark:bg-neutral-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>

        <div className="flex items-center justify-end gap-2 text-sm text-gray-500 dark:text-gray-400">
          <label htmlFor="select-all-sources" className="cursor-pointer select-none">
            Select all
          </label>
          <Checkbox id="select-all-sources" checked={selected} onCheckedChange={(v) => onToggleSelected(v === true)} />
        </div>

        <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{sourceFileName}</p>
            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
              {dateLabel} · {sourceSize}
            </p>
          </div>
          <Checkbox checked={selected} onCheckedChange={(v) => onToggleSelected(v === true)} />
        </div>
      </div>
    </>
  );
}
