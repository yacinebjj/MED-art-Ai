"use client";

import { DragEvent, KeyboardEvent, useRef, useState } from "react";
import { Cloud, FileText, FileUp, Upload, UploadCloud } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ACCEPTED_FILE_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { openGoogleDrivePicker } from "@/lib/google-drive-picker";
import { useToast } from "@/components/ui/Toast";

// Statically inlined at build time by Next.js (NEXT_PUBLIC_ vars) — reading
// it here just lets the Drive card show an honest "not configured" state
// instead of only failing once the student actually clicks the button.
const GOOGLE_DRIVE_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && process.env.NEXT_PUBLIC_GOOGLE_API_KEY);

// Must match the server-side MAX_FILE_BYTES in app/api/generate-course/route.ts
// AND app/api/upload/route.ts (whichever ends up handling this file — see
// onSubmitFile's own doc comment above for why the two differ by caller).
// Checked here purely so an oversized file is rejected INSTANTLY, before
// spending a student's time (and mobile data) uploading e.g. 150 Mo of
// radiology scans over a slow connection just to get turned away by the
// server at the very end.
const MAX_UPLOAD_FILE_BYTES = 100 * 1024 * 1024; // 100 Mo

function formatOversizedFileError(file: File): string {
  return `Fichier trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024)} Mo).`;
}

// Shared shell for the three method cards — a distinct, self-contained zone
// per import method (local file / Drive / pasted text) rather than tabs that
// hide two of the three at any given time.
const CARD_BASE_CLASS =
  "flex h-full flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-card transition-all duration-300 hover:border-primary hover:shadow-lg";

/** Enter/Space activates a non-<button> clickable zone, matching native button semantics. */
function handleZoneKeyDown(e: KeyboardEvent<HTMLDivElement>, action: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
}

export interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with whatever identifier the submit handler resolved with (a course slug for the default dashboard flow; a studio_courses id for a caller overriding onSubmitFile/onSubmitText) once the upload succeeds. */
  onUploaded: (result: string) => void;
  /** Overrides the default POST /api/generate-course (public `courses` table) flow — e.g. the module workspace instead creates a studio_courses row scoped to one curriculum module. Must resolve with an identifier string, or throw an Error with a user-facing message. */
  onSubmitFile?: (file: File) => Promise<string>;
  /** Same override, for the "Texte direct" card. */
  onSubmitText?: (text: string, title: string) => Promise<string>;
  title?: string;
  description?: string;
}

export function UploadModal({ open, onOpenChange, onUploaded, onSubmitFile, onSubmitText, title: modalTitle, description }: UploadModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDriveImporting, setIsDriveImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  function reset() {
    setIsDragging(false);
    setFile(null);
    setText("");
    setTitle("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    // Radix routes the built-in X button, Escape, AND an overlay click all
    // through this same callback — blocking it here while a submission is
    // in flight covers all three at once. Without this, closing mid-upload
    // (no request is ever aborted) let the student reopen and resubmit
    // immediately, firing two concurrent course-creation requests from one
    // upload. Found during a security/UX audit.
    if (!next && (isSubmitting || isDriveImporting)) return;
    if (!next) reset();
    onOpenChange(next);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    if (dropped.size > MAX_UPLOAD_FILE_BYTES) {
      setFile(null);
      setError(formatOversizedFileError(dropped));
      return;
    }
    setError(null);
    setFile(dropped);
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
      const message = err instanceof Error ? err.message : "Le téléversement a échoué.";
      setError(message);
      toast({ variant: "error", title: "Le téléversement a échoué", description: message });
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
      const message = err instanceof Error ? err.message : "L'import a échoué.";
      setError(message);
      toast({ variant: "error", title: "L'import a échoué", description: message });
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Opens the Google Drive picker, downloads + extracts the chosen file
   * server-side (app/api/drive/import), then feeds the result through the
   * exact same onSubmitText path as "Texte direct" — from this point on, a
   * Drive import is indistinguishable from pasted text to whatever caller
   * customized onSubmitText (or the default /api/generate-course flow).
   */
  async function handleDriveImport() {
    // Deliberately NOT gated on GOOGLE_DRIVE_CONFIGURED here (unlike the old
    // version of this function/activateDriveZone below) — production report:
    // clicking the Drive card did "literally nothing, no popup, no error".
    // Root cause was this exact silent early-return: when the env vars
    // aren't baked into the build, the click produced zero feedback of any
    // kind. openGoogleDrivePicker() already throws a clear, specific error
    // in that exact case ("Google Drive n'est pas configuré...") — routing
    // through the SAME try/catch below (which already surfaces both an
    // inline message AND a toast) means a missing/stale config now fails
    // exactly as visibly as any other Drive error, never silently.
    if (isDriveImporting) return;
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
      const message = err instanceof Error ? err.message : "L'import depuis Google Drive a échoué.";
      setError(message);
      toast({ variant: "error", title: "L'import Google Drive a échoué", description: message });
    } finally {
      setIsDriveImporting(false);
    }
  }

  /** Whole-card click/keyboard zone — see handleDriveImport's own comment for why this no longer short-circuits on GOOGLE_DRIVE_CONFIGURED. */
  function activateDriveZone() {
    if (isDriveImporting) return;
    void handleDriveImport();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{modalTitle ?? "Ajouter un cours"}</DialogTitle>
          <DialogDescription>
            {description ?? "Importe un document, connecte Google Drive, ou colle du texte pour créer un nouvel espace de travail."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* 1. Upload local */}
          <div className={CARD_BASE_CLASS}>
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Fichier local</p>
                <p className="mt-0.5 text-xs text-muted-foreground">PDF, DOCX, PPTX, TXT (max 100 Mo)</p>
              </div>
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => handleZoneKeyDown(e, () => inputRef.current?.click())}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              aria-label="Glisser-déposer un fichier, ou appuyer pour parcourir"
              className={cn(
                "flex min-h-[6.5rem] flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-6 text-center transition-colors duration-300",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/40 hover:bg-muted/60"
              )}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_FILE_TYPES.join(",")}
                className="hidden"
                onChange={(e) => {
                  const chosen = e.target.files?.[0] ?? null;
                  if (chosen && chosen.size > MAX_UPLOAD_FILE_BYTES) {
                    setFile(null);
                    setError(formatOversizedFileError(chosen));
                    return;
                  }
                  setError(null);
                  setFile(chosen);
                }}
              />
              <UploadCloud className="h-6 w-6 text-muted-foreground" />
              <p className="line-clamp-2 text-xs font-medium text-foreground">
                {file ? file.name : "Glisse-dépose ton fichier ici, ou clique pour parcourir"}
              </p>
            </div>

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

          {/* 2. Google Drive / Cloud */}
          <div className={CARD_BASE_CLASS}>
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Cloud className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Google Drive</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {GOOGLE_DRIVE_CONFIGURED ? "PDF, DOCX, Docs, Slides…" : "Non configuré"}
                </p>
              </div>
            </div>

            <div
              role="button"
              tabIndex={GOOGLE_DRIVE_CONFIGURED ? 0 : -1}
              aria-disabled={!GOOGLE_DRIVE_CONFIGURED}
              onClick={activateDriveZone}
              onKeyDown={(e) => handleZoneKeyDown(e, activateDriveZone)}
              aria-label="Importer un document depuis Google Drive"
              className={cn(
                "flex min-h-[6.5rem] flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-6 text-center transition-colors duration-300",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                GOOGLE_DRIVE_CONFIGURED
                  ? "cursor-pointer border-border bg-muted/40 hover:bg-muted/60"
                  : "cursor-not-allowed border-border/60 bg-muted/20 opacity-60"
              )}
            >
              <Cloud className="h-6 w-6 text-muted-foreground" />
              <p className="text-xs font-medium text-foreground">
                {GOOGLE_DRIVE_CONFIGURED ? "Choisir un fichier dans Drive" : "Voir la configuration requise"}
              </p>
            </div>

            <Button
              variant="outline"
              className="w-full"
              // Deliberately NOT disabled when !GOOGLE_DRIVE_CONFIGURED — a
              // native `disabled` button swallows the click before any JS
              // runs at all, which was the other half of the "click does
              // literally nothing" production report (the div zone above was
              // the other half, already fixed). Clicking now always reaches
              // handleDriveImport, which surfaces a clear, specific error
              // either way (missing config, or a real Drive/network failure).
              disabled={isDriveImporting}
              isLoading={isDriveImporting}
              onClick={handleDriveImport}
            >
              {!isDriveImporting && <Cloud className="h-4 w-4" />}
              Importer depuis Drive
            </Button>
          </div>

          {/* 3. Texte direct */}
          <div className={CARD_BASE_CLASS}>
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Texte direct</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Coller ou saisir du texte</p>
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-2">
              <Input
                label="Titre (optionnel)"
                placeholder="Ex : Physiologie rénale"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                placeholder="Colle ici le texte de ton cours…"
                aria-label="Contenu du cours"
                className="w-full flex-1 resize-none rounded-xl border border-input bg-card px-3.5 py-2.5 text-base text-foreground shadow-soft transition-all duration-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm"
              />
            </div>

            <Button
              className="w-full"
              disabled={isSubmitting}
              isLoading={isSubmitting}
              onClick={handleSubmitText}
            >
              {!isSubmitting && <FileText className="h-4 w-4" />}
              Ajouter le cours
            </Button>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
