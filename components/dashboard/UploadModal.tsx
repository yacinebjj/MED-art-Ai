"use client";

import { DragEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { Cloud, FileText, FileUp, Loader2, Upload, UploadCloud } from "lucide-react";
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
import { openGoogleDrivePicker, preloadGoogleDriveScripts } from "@/lib/google-drive-picker";
import { useToast } from "@/components/ui/Toast";
import { OcrSuggestedError } from "@/lib/upload-client";

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

// Horizontal pill-nav row (NotebookLM-style "Upload files / Drive / Texte
// direct" bar below the central dropzone) — see this file's own header
// comment on why this deliberately only covers this app's 3 REAL import
// methods, not NotebookLM's full set (web search, "Websites", Play Books
// have no backend here — shipping them would be a dead button, the exact
// bug class already found and fixed elsewhere in this app).
const NAV_PILL_BASE =
  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60";
const NAV_PILL_ACTIVE = "border-primary/60 bg-primary/10 text-primary shadow-glow";
const NAV_PILL_INACTIVE = "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground";

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
  /**
   * Only meaningful when onSubmitFile throws lib/upload-client.ts's
   * OcrSuggestedError (a PDF with no real text layer — a scanned/rasterized
   * document — for which a real OCR fallback exists). Callers that support
   * it wire this to lib/upload-client.ts's retryUploadWithOcr (closing over
   * their own moduleId, exactly like onSubmitFile does); callers that don't
   * pass it simply never see the "Essayer l'OCR" action rendered.
   */
  onRetryWithOcr?: (path: string, fileName: string) => Promise<string>;
  title?: string;
  description?: string;
}

export function UploadModal({ open, onOpenChange, onUploaded, onSubmitFile, onSubmitText, onRetryWithOcr, title: modalTitle, description }: UploadModalProps) {
  // Which method's content shows in the central zone — "Drive" has no
  // inline content of its own (it opens Google's own popup immediately,
  // see activateDriveZone), so it's never a value of this state, just a
  // pill that fires an action.
  const [activeMethod, setActiveMethod] = useState<"upload" | "text">("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDriveImporting, setIsDriveImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocrSuggestion, setOcrSuggestion] = useState<{ path: string; fileName: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Fires the moment this modal opens, well before any click — see
  // preloadGoogleDriveScripts' own doc comment: by the time the student
  // actually taps "Importer depuis Drive", the Google scripts this needs are
  // already loaded, so the click handler's own await on them resolves near-
  // instantly instead of introducing a real async gap between the tap and
  // Google's own popup call (the gap several mobile browsers treat as
  // "gesture no longer trusted", silently blocking the popup).
  useEffect(() => {
    if (open) preloadGoogleDriveScripts();
  }, [open]);

  function reset() {
    setActiveMethod("upload");
    setIsDragging(false);
    setFile(null);
    setText("");
    setTitle("");
    setError(null);
    setOcrSuggestion(null);
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
    setOcrSuggestion(null);

    try {
      const result = await (onSubmitFile ?? defaultSubmitFile)(file);
      onUploaded(result);
      handleOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Le téléversement a échoué.";
      setError(message);
      // Only offer the OCR retry action if THIS caller actually wired
      // onRetryWithOcr — a caller that didn't (e.g. one with no course/
      // moduleId concept to attach the result to) just sees the plain error,
      // same as any other extraction failure.
      if (err instanceof OcrSuggestedError && onRetryWithOcr) {
        setOcrSuggestion({ path: err.path, fileName: err.fileName });
      }
      toast({ variant: "error", title: "Le téléversement a échoué", description: message });
    } finally {
      setIsSubmitting(false);
    }
  }

  /** Explicit, student-initiated OCR retry after handleSubmitFile surfaced an OcrSuggestedError — never triggered automatically (see onRetryWithOcr's own doc comment: a real, billed OpenRouter call). */
  async function handleOcrRetry() {
    if (!ocrSuggestion || !onRetryWithOcr) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await onRetryWithOcr(ocrSuggestion.path, ocrSuggestion.fileName);
      setOcrSuggestion(null);
      onUploaded(result);
      handleOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "L'extraction OCR a échoué.";
      setError(message);
      setOcrSuggestion(null);
      toast({ variant: "error", title: "L'extraction OCR a échoué", description: message });
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

        <div className="flex flex-col gap-5">
          {/* Central content zone — dropzone or paste-text form, whichever
              method is active. This is the visually dominant element, per
              the request's own "central dropzone" spec — Drive has no
              content of its own here (see the pill nav below), it opens
              Google's popup directly the moment its pill is clicked. */}
          {activeMethod === "upload" ? (
            <div className="flex flex-col items-center gap-4">
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
                  "flex min-h-[13rem] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all duration-300",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isDragging
                    ? "scale-[1.01] border-primary bg-gradient-to-br from-primary/10 via-primary/5 to-transparent shadow-glow"
                    : "border-border bg-gradient-to-br from-muted/50 via-muted/30 to-transparent hover:border-primary/40 hover:from-primary/5 hover:via-muted/40"
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
                <UploadCloud className={cn("h-10 w-10 transition-transform duration-300", isDragging ? "scale-110 text-primary" : "text-muted-foreground")} />
                <p className="text-base font-semibold text-foreground">{file ? file.name : "Glisse-dépose ton fichier ici"}</p>
                <p className="text-xs text-muted-foreground">PDF, DOCX, PPTX, TXT — max 100 Mo</p>
              </div>

              <Button className="w-full max-w-xs" disabled={!file || isSubmitting} isLoading={isSubmitting} onClick={handleSubmitFile}>
                {!isSubmitting && <Upload className="h-4 w-4" />}
                Ajouter le cours
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Input
                label="Titre (optionnel)"
                placeholder="Ex : Physiologie rénale"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder="Colle ici le texte de ton cours…"
                aria-label="Contenu du cours"
                className="w-full resize-none rounded-xl border border-input bg-card px-3.5 py-2.5 text-base text-foreground shadow-soft transition-all duration-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm"
              />
              <Button className="w-full max-w-xs self-center" disabled={isSubmitting} isLoading={isSubmitting} onClick={handleSubmitText}>
                {!isSubmitting && <FileText className="h-4 w-4" />}
                Ajouter le cours
              </Button>
            </div>
          )}

          {/* Horizontal pill nav — the 3 REAL import methods this app
              supports. Deliberately not disabled by !GOOGLE_DRIVE_CONFIGURED
              (see handleDriveImport's own comment): clicking it must always
              reach a real, visible error rather than doing nothing. */}
          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setActiveMethod("upload")}
              className={cn(NAV_PILL_BASE, activeMethod === "upload" ? NAV_PILL_ACTIVE : NAV_PILL_INACTIVE)}
              aria-pressed={activeMethod === "upload"}
            >
              <FileUp className="h-4 w-4" />
              Upload files
            </button>
            <button
              type="button"
              onClick={activateDriveZone}
              disabled={isDriveImporting}
              className={cn(NAV_PILL_BASE, NAV_PILL_INACTIVE, !GOOGLE_DRIVE_CONFIGURED && "opacity-60")}
              aria-label="Importer un document depuis Google Drive"
              title={GOOGLE_DRIVE_CONFIGURED ? undefined : "Google Drive n'est pas configuré — cliquer affichera les détails."}
            >
              {isDriveImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
              Drive
            </button>
            <button
              type="button"
              onClick={() => setActiveMethod("text")}
              className={cn(NAV_PILL_BASE, activeMethod === "text" ? NAV_PILL_ACTIVE : NAV_PILL_INACTIVE)}
              aria-pressed={activeMethod === "text"}
            >
              <FileText className="h-4 w-4" />
              Texte direct
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-destructive">{error}</p>
            {ocrSuggestion && (
              <Button type="button" variant="outline" isLoading={isSubmitting} disabled={isSubmitting} onClick={handleOcrRetry}>
                Essayer l&apos;OCR (1-2 min)
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
