"use client";

import { DragEvent, useRef, useState } from "react";
import { FileText, HardDrive, Upload, UploadCloud } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ACCEPTED_FILE_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { openGoogleDrivePicker } from "@/lib/google-drive-picker";

// Statically inlined at build time by Next.js (NEXT_PUBLIC_ vars) — reading
// it here just lets the Drive tab show an honest "not configured" state
// instead of only failing once the student actually clicks the button.
const GOOGLE_DRIVE_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && process.env.NEXT_PUBLIC_GOOGLE_API_KEY);

type UploadTab = "file" | "text" | "drive";

export interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with whatever identifier the submit handler resolved with (a course slug for the default dashboard flow; a studio_courses id for a caller overriding onSubmitFile/onSubmitText) once the upload succeeds. */
  onUploaded: (result: string) => void;
  /** Overrides the default POST /api/generate-course (public `courses` table) flow — e.g. the module workspace instead creates a studio_courses row scoped to one curriculum module. Must resolve with an identifier string, or throw an Error with a user-facing message. */
  onSubmitFile?: (file: File) => Promise<string>;
  /** Same override, for the "Texte brut" tab. */
  onSubmitText?: (text: string, title: string) => Promise<string>;
  title?: string;
  description?: string;
}

export function UploadModal({ open, onOpenChange, onUploaded, onSubmitFile, onSubmitText, title: modalTitle, description }: UploadModalProps) {
  const [tab, setTab] = useState<UploadTab>("file");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDriveImporting, setIsDriveImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setTab("file");
    setIsDragging(false);
    setFile(null);
    setText("");
    setTitle("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }

  async function defaultSubmitFile(f: File): Promise<string> {
    const body = new FormData();
    body.append("file", f);
    const res = await fetch("/api/generate-course", { method: "POST", body });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error ?? "Le téléversement a échoué.");
    return data.slug;
  }

  async function defaultSubmitText(t: string, courseTitle: string): Promise<string> {
    const body = new FormData();
    body.append("text", t);
    body.append("title", courseTitle);
    const res = await fetch("/api/generate-course", { method: "POST", body });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error ?? "L'import a échoué.");
    return data.slug;
  }

  async function handleSubmitFile() {
    if (!file) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await (onSubmitFile ?? defaultSubmitFile)(file);
      onUploaded(result);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Le téléversement a échoué.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmitText() {
    if (text.trim().length < 50) {
      setError("Le texte est trop court (50 caractères minimum).");
      return;
    }
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await (onSubmitText ?? defaultSubmitText)(text, title);
      onUploaded(result);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'import a échoué.");
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Opens the Google Drive picker, downloads + extracts the chosen file
   * server-side (app/api/drive/import), then feeds the result through the
   * exact same onSubmitText path as "Texte brut" — from this point on, a
   * Drive import is indistinguishable from pasted text to whatever caller
   * customized onSubmitText (or the default /api/generate-course flow).
   */
  async function handleDriveImport() {
    setError(null);
    setIsDriveImporting(true);

    try {
      const picked = await openGoogleDrivePicker();
      if (!picked) return; // student closed the picker without choosing anything

      const res = await fetch("/api/drive/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: picked.id, mimeType: picked.mimeType, accessToken: picked.accessToken, fileName: picked.name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "L'import depuis Google Drive a échoué.");

      const result = await (onSubmitText ?? defaultSubmitText)(data.text, picked.name);
      onUploaded(result);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'import depuis Google Drive a échoué.");
    } finally {
      setIsDriveImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{modalTitle ?? "Ajouter un cours"}</DialogTitle>
          <DialogDescription>
            {description ?? "Importe un document ou colle du texte pour créer un nouvel espace de travail."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as UploadTab)}>
          <TabsList className="mb-4">
            <TabsTrigger value="file">Fichier (PDF/DOCX/PPTX/TXT)</TabsTrigger>
            <TabsTrigger value="text">Texte</TabsTrigger>
            <TabsTrigger value="drive">Google Drive</TabsTrigger>
          </TabsList>

          {tab === "file" && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                  isDragging
                    ? "border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/30"
                    : "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-slate-800"
                )}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED_FILE_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <UploadCloud className="mb-3 h-8 w-8 text-slate-400 dark:text-slate-400" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {file ? file.name : "Glisse-dépose ton fichier ici, ou clique pour parcourir"}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">PDF, DOCX, PPTX, TXT</p>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button
                className="w-full"
                disabled={!file || isSubmitting}
                isLoading={isSubmitting}
                onClick={handleSubmitFile}
              >
                {!isSubmitting && <Upload className="h-4 w-4" />}
                Ajouter le cours
              </Button>
            </div>
          )}

          {tab === "text" && (
            <div className="space-y-4">
              <Input
                label="Titre (optionnel)"
                placeholder="Ex : Physiologie rénale"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Contenu du cours
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={8}
                  placeholder="Colle ici le texte de ton cours…"
                  className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm text-foreground shadow-soft focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button
                className="w-full"
                disabled={isSubmitting}
                isLoading={isSubmitting}
                onClick={handleSubmitText}
              >
                <FileText className="h-4 w-4" />
                Ajouter le cours
              </Button>
            </div>
          )}

          {tab === "drive" && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center dark:border-slate-600 dark:bg-slate-800/50">
                <HardDrive className="mb-3 h-8 w-8 text-slate-400" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Google Drive</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {GOOGLE_DRIVE_CONFIGURED
                    ? "PDF, DOCX, PPTX, TXT, ou un Google Doc / Google Slides."
                    : "Non configuré sur cet environnement — voir NEXT_PUBLIC_GOOGLE_CLIENT_ID / NEXT_PUBLIC_GOOGLE_API_KEY."}
                </p>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button
                className="w-full"
                variant="outline"
                disabled={!GOOGLE_DRIVE_CONFIGURED || isDriveImporting}
                isLoading={isDriveImporting}
                onClick={handleDriveImport}
              >
                {!isDriveImporting && <HardDrive className="h-4 w-4" />}
                Importer depuis Google Drive
              </Button>
            </div>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
