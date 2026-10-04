"use client";

import "@/components/cyber/cyber.css";

import { DragEvent, KeyboardEvent, useEffect, useRef, useState, type ComponentType } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Cloud, File, FileImage, FileSpreadsheet, FileText, FileType2, Globe, Link2, Loader2, Presentation, Sparkles, Trash2, Upload, UploadCloud, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ACCEPTED_FILE_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { preloadGoogleDriveScripts, type DriveListItem } from "@/lib/google-drive-picker";
import { DriveBrowser } from "@/components/dashboard/DriveBrowser";
import { useToast } from "@/components/ui/Toast";
import { OcrSuggestedError } from "@/lib/upload-client";
import { useCyberTilt } from "@/components/cyber/hooks";

// Must match the server-side MAX_FILE_BYTES in app/api/generate-course/route.ts
// AND app/api/upload/route.ts. Checked here so an oversized file is rejected
// instantly, before spending a student's time and mobile data.
const MAX_UPLOAD_FILE_BYTES = 100 * 1024 * 1024; // 100 Mo
const MAX_BATCH_FILES = 10;

type Method = "upload" | "drive" | "text" | "link";
type QueueStatus = "pending" | "uploading" | "done" | "error";

interface QueueItem {
  id: string;
  file: File;
  status: QueueStatus;
  message?: string;
  ocr?: { path: string; fileName: string };
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Icon + tint per document family. */
function fileVisual(name: string): { icon: ComponentType<{ className?: string }>; tint: string; label: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return { icon: FileType2, tint: "from-rose-400 to-red-600", label: "PDF" };
  if (ext === "doc" || ext === "docx") return { icon: FileText, tint: "from-sky-400 to-blue-600", label: "Word" };
  if (ext === "ppt" || ext === "pptx") return { icon: Presentation, tint: "from-amber-300 to-orange-600", label: "PowerPoint" };
  if (ext === "xls" || ext === "xlsx" || ext === "csv") return { icon: FileSpreadsheet, tint: "from-emerald-400 to-green-600", label: "Tableur" };
  if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext)) return { icon: FileImage, tint: "from-violet-400 to-fuchsia-600", label: "Image" };
  if (ext === "txt" || ext === "md") return { icon: FileText, tint: "from-slate-400 to-slate-600", label: "Texte" };
  return { icon: File, tint: "from-slate-400 to-slate-600", label: ext.toUpperCase() || "Fichier" };
}

function handleZoneKeyDown(e: KeyboardEvent<HTMLDivElement>, action: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
}

const METHODS: { id: Method; label: string; hint: string; icon: ComponentType<{ className?: string }>; tint: string }[] = [
  { id: "upload", label: "Fichiers", hint: "PDF, DOCX, PPTX, TXT…", icon: UploadCloud, tint: "from-cyan-300 to-sky-500" },
  { id: "drive", label: "Google Drive", hint: "Parcourir tes dossiers", icon: Cloud, tint: "from-emerald-300 to-teal-500" },
  { id: "text", label: "Texte direct", hint: "Notes, polycopié collé", icon: FileText, tint: "from-violet-400 to-fuchsia-500" },
  { id: "link", label: "Lien web", hint: "Page de cours en ligne", icon: Globe, tint: "from-amber-300 to-orange-500" },
];

function MethodCard({ method, active, disabled, onSelect }: { method: (typeof METHODS)[number]; active: boolean; disabled: boolean; onSelect: () => void }) {
  const ref = useCyberTilt<HTMLButtonElement>(6);
  const Icon = method.icon;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "cyber-tilt group relative flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl border p-2.5 text-center transition-[border-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[5.5rem] sm:flex-row sm:justify-start sm:gap-3 sm:p-3.5 sm:text-left",
        active ? "border-cyan-400/60 bg-cyan-400/10 shadow-[0_0_26px_-8px_rgba(34,211,238,0.7)]" : "border-border hover:border-cyan-400/40"
      )}
    >
      <span aria-hidden className="cyber-reflect" />
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg sm:h-11 sm:w-11", method.tint)}>
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-black text-foreground sm:text-sm">{method.label}</span>
        <span className="hidden truncate text-[11px] text-muted-foreground sm:block">{method.hint}</span>
      </span>
    </button>
  );
}

export interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with whatever identifier the submit handler resolved with (a course slug for the default dashboard flow; a studio_courses id for a caller overriding onSubmitFile/onSubmitText) once an import succeeds. */
  onUploaded: (result: string) => void;
  /** Overrides the default POST /api/generate-course flow — e.g. the module workspace creates a studio_courses row scoped to one module. Must resolve with an identifier string, or throw an Error with a user-facing message. Enables multi-file batches. */
  onSubmitFile?: (file: File) => Promise<string>;
  /** Same override, for "Texte direct", Drive and "Lien web" (all become text). */
  onSubmitText?: (text: string, title: string) => Promise<string>;
  /** Only meaningful when onSubmitFile throws lib/upload-client.ts's OcrSuggestedError (a scanned PDF). */
  onRetryWithOcr?: (path: string, fileName: string) => Promise<string>;
  title?: string;
  description?: string;
}

/**
 * Source import studio: files (batch, per-file status), Google Drive, direct
 * text and web link — the four real import paths this app supports.
 */
export function UploadModal({ open, onOpenChange, onUploaded, onSubmitFile, onSubmitText, onRetryWithOcr, title: modalTitle, description }: UploadModalProps) {
  const [method, setMethod] = useState<Method>("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDriveImporting, setIsDriveImporting] = useState(false);
  // Lifted out of DriveBrowser so the OAuth connection survives switching tabs.
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  // Batches only where the caller handles each file itself (module workspace) —
  // the default dashboard flow navigates to the one course it just created.
  const allowsBatch = Boolean(onSubmitFile);
  const busy = isSubmitting || isDriveImporting;

  // Preload Google's scripts as soon as the modal opens (popup must follow the tap synchronously on mobile).
  useEffect(() => {
    if (open) preloadGoogleDriveScripts();
  }, [open]);

  function reset() {
    setMethod("upload");
    setIsDragging(false);
    setQueue([]);
    setText("");
    setTitle("");
    setLink("");
    setError(null);
    setDriveAccessToken(null);
  }

  function handleOpenChange(next: boolean) {
    // Never close mid-import (no request is aborted; a reopen could submit twice).
    if (!next && busy) return;
    if (!next) reset();
    onOpenChange(next);
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const incoming = Array.from(list).slice(0, allowsBatch ? MAX_BATCH_FILES : 1);
    const oversized = incoming.filter((f) => f.size > MAX_UPLOAD_FILE_BYTES);
    if (oversized.length > 0) setError(`${oversized.map((f) => f.name).join(", ")} : trop volumineux (max 100 Mo).`);
    const accepted = incoming
      .filter((f) => f.size <= MAX_UPLOAD_FILE_BYTES)
      .map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`, file, status: "pending" as const }));
    setQueue((prev) => (allowsBatch ? [...prev.filter((q) => q.status !== "done"), ...accepted].slice(0, MAX_BATCH_FILES) : accepted.slice(0, 1)));
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
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

  function patchItem(id: string, patch: Partial<QueueItem>) {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  /** Imports the queued files one by one, each with its own real status. */
  async function handleSubmitFiles() {
    const pending = queue.filter((item) => item.status === "pending" || item.status === "error");
    if (pending.length === 0) return;
    setIsSubmitting(true);
    setError(null);
    let succeeded = 0;
    for (const item of pending) {
      patchItem(item.id, { status: "uploading", message: undefined, ocr: undefined });
      try {
        const result = await (onSubmitFile ?? defaultSubmitFile)(item.file);
        patchItem(item.id, { status: "done" });
        succeeded++;
        onUploaded(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Le téléversement a échoué.";
        patchItem(item.id, {
          status: "error",
          message,
          ocr: err instanceof OcrSuggestedError && onRetryWithOcr ? { path: err.path, fileName: err.fileName } : undefined,
        });
      }
    }
    setIsSubmitting(false);
    const failed = pending.length - succeeded;
    if (failed === 0) {
      toast({ variant: "success", title: succeeded > 1 ? `${succeeded} sources importées` : "Source importée" });
      handleOpenChange(false);
    } else if (succeeded > 0) {
      toast({ variant: "info", title: `${succeeded} importée(s), ${failed} en échec`, description: "Les fichiers en échec restent dans la liste." });
    } else {
      toast({ variant: "error", title: "Le téléversement a échoué", description: "Vérifie les fichiers en rouge." });
    }
  }

  /** Student-initiated OCR retry for one scanned PDF (a real, billed call — never automatic). */
  async function handleOcrRetry(item: QueueItem) {
    if (!item.ocr || !onRetryWithOcr) return;
    setIsSubmitting(true);
    patchItem(item.id, { status: "uploading", message: "Extraction OCR en cours (1-2 min)…" });
    try {
      const result = await onRetryWithOcr(item.ocr.path, item.ocr.fileName);
      patchItem(item.id, { status: "done", message: undefined, ocr: undefined });
      onUploaded(result);
      if (queue.every((q) => q.id === item.id || q.status === "done")) handleOpenChange(false);
    } catch (err) {
      patchItem(item.id, { status: "error", message: err instanceof Error ? err.message : "L'extraction OCR a échoué.", ocr: undefined });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitText(content: string, courseTitle: string, failureTitle: string) {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await (onSubmitText ?? defaultSubmitText)(content, courseTitle);
      onUploaded(result);
      toast({ variant: "success", title: "Source importée" });
      handleOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "L'import a échoué.";
      setError(message);
      toast({ variant: "error", title: failureTitle, description: message });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmitText() {
    if (text.trim().length < 50) {
      setError("Le texte est trop court (50 caractères minimum).");
      return;
    }
    await submitText(text, title, "L'import a échoué");
  }

  async function handleImportLink() {
    const url = link.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError("Colle un lien complet qui commence par http:// ou https://");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/import/url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(typeof data?.error === "string" ? data.error : "Impossible de récupérer cette page.");
      setIsSubmitting(false);
      await submitText(String(data.text), title.trim() || String(data.title ?? ""), "L'import du lien a échoué");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible de récupérer cette page.";
      setError(message);
      toast({ variant: "error", title: "L'import du lien a échoué", description: message });
      setIsSubmitting(false);
    }
  }

  /** A Drive file is downloaded + extracted server-side, then goes through the same text path. */
  async function handleDriveFileSelected(picked: DriveListItem, accessToken: string) {
    if (isDriveImporting) return;
    setError(null);
    setIsDriveImporting(true);
    try {
      const res = await fetch("/api/drive/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: picked.id, mimeType: picked.mimeType, accessToken, fileName: picked.name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        if (data.authExpired) {
          setDriveAccessToken(null);
          throw new Error(data.error ?? "Ta session Google Drive a expiré. Reconnecte-toi pour réessayer.");
        }
        throw new Error(data.error ?? "L'import depuis Google Drive a échoué.");
      }
      const result = await (onSubmitText ?? defaultSubmitText)(data.text, picked.name);
      onUploaded(result);
      toast({ variant: "success", title: "Source importée depuis Drive" });
      handleOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "L'import depuis Google Drive a échoué.";
      setError(message);
      toast({ variant: "error", title: "L'import Google Drive a échoué", description: message });
    } finally {
      setIsDriveImporting(false);
    }
  }

  const pendingCount = queue.filter((q) => q.status === "pending" || q.status === "error").length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.18),transparent_70%)]" />
        <DialogHeader className="relative">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 via-sky-500 to-violet-600 text-white shadow-[0_0_28px_rgba(34,211,238,0.45)]">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="min-w-0 text-left">
              <DialogTitle>{modalTitle ?? "Ajouter un cours"}</DialogTitle>
              <DialogDescription>{description ?? "Importe un document, connecte Google Drive, colle du texte ou un lien pour créer un espace de travail."}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="relative mt-2 grid grid-cols-4 gap-2 sm:gap-3">
          {METHODS.map((m) => (
            <MethodCard key={m.id} method={m} active={method === m.id} disabled={busy} onSelect={() => setMethod(m.id)} />
          ))}
        </div>

        <motion.div key={method} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="relative mt-4 flex max-h-[55vh] flex-col gap-4 overflow-y-auto overflow-x-hidden pr-0.5">
          {method === "upload" && (
            <>
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
                aria-label="Glisser-déposer des fichiers, ou appuyer pour parcourir"
                className={cn(
                  "relative flex min-h-[11rem] w-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-[border-color,background-color,transform]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isDragging ? "scale-[1.01] border-cyan-400 bg-cyan-400/10" : "border-border hover:border-cyan-400/50"
                )}
              >
                <input
                  ref={inputRef}
                  type="file"
                  multiple={allowsBatch}
                  accept={ACCEPTED_FILE_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <motion.span animate={isDragging ? { y: -4, scale: 1.08 } : { y: 0, scale: 1 }} className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 to-sky-500 text-white shadow-[0_0_30px_rgba(34,211,238,0.45)]">
                  <UploadCloud className="h-7 w-7" />
                </motion.span>
                <p className="text-base font-bold text-foreground">{isDragging ? "Dépose ici" : allowsBatch ? "Glisse-dépose tes fichiers ici" : "Glisse-dépose ton fichier ici"}</p>
                <p className="text-xs text-muted-foreground">
                  PDF, DOCX, PPTX, TXT — 100 Mo max{allowsBatch ? ` par fichier · jusqu'à ${MAX_BATCH_FILES} à la fois` : ""}
                </p>
              </div>

              {queue.length > 0 && (
                <ul className="space-y-2">
                  {queue.map((item) => {
                    const visual = fileVisual(item.file.name);
                    const Icon = visual.icon;
                    return (
                      <li key={item.id} className={cn("rounded-2xl border p-3", item.status === "error" ? "border-rose-400/40 bg-rose-500/5" : item.status === "done" ? "border-emerald-400/40 bg-emerald-500/5" : "border-border")}>
                        <div className="flex items-center gap-3">
                          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white", visual.tint)}>
                            <Icon className="h-5 w-5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-foreground">{item.file.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {visual.label} · {formatSize(item.file.size)}
                              {item.status === "uploading" && " · Import et extraction…"}
                              {item.status === "done" && " · Importé"}
                            </p>
                          </div>
                          {item.status === "uploading" ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-500" />
                          ) : item.status === "done" ? (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                              disabled={isSubmitting}
                              aria-label={`Retirer ${item.file.name}`}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        {item.status === "uploading" && (
                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                            <motion.div className="h-full w-1/3 rounded-full bg-gradient-to-r from-cyan-400 to-violet-500" animate={{ x: ["-100%", "300%"] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />
                          </div>
                        )}
                        {item.status === "error" && item.message && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <p className="flex min-w-0 items-start gap-1.5 text-xs text-rose-600 dark:text-rose-300">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span className="break-words">{item.message}</span>
                            </p>
                            {item.ocr && (
                              <Button type="button" size="sm" variant="outline" disabled={isSubmitting} onClick={() => void handleOcrRetry(item)}>
                                Essayer l&apos;OCR (1-2 min)
                              </Button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <Button className="w-full sm:w-auto sm:self-center sm:px-10" disabled={pendingCount === 0 || isSubmitting} isLoading={isSubmitting} onClick={() => void handleSubmitFiles()}>
                {!isSubmitting && <Upload className="h-4 w-4" />}
                {pendingCount > 1 ? `Importer ${pendingCount} fichiers` : "Importer"}
              </Button>
            </>
          )}

          {method === "drive" && (
            <DriveBrowser accessToken={driveAccessToken} onAccessTokenChange={setDriveAccessToken} onFileSelected={handleDriveFileSelected} disabled={isDriveImporting} />
          )}

          {method === "text" && (
            <>
              <Input label="Titre (optionnel)" placeholder="Ex : Physiologie rénale" value={title} onChange={(e) => setTitle(e.target.value)} />
              <div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={8}
                  placeholder="Colle ici le texte de ton cours, tes notes cliniques ou un extrait de polycopié…"
                  aria-label="Contenu du cours"
                  className="w-full resize-y rounded-xl border border-input bg-card px-3.5 py-2.5 text-base leading-relaxed text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-1 text-right text-[11px] text-muted-foreground">{text.trim().length.toLocaleString("fr-FR")} caractères · 50 minimum</p>
              </div>
              <Button className="w-full sm:w-auto sm:self-center sm:px-10" disabled={isSubmitting} isLoading={isSubmitting} onClick={() => void handleSubmitText()}>
                {!isSubmitting && <FileText className="h-4 w-4" />}
                Importer le texte
              </Button>
            </>
          )}

          {method === "link" && (
            <>
              <div className="rounded-2xl border border-border p-4">
                <label className="text-sm font-bold text-foreground" htmlFor="import-link">
                  Lien de la page
                </label>
                <div className="relative mt-2">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="import-link"
                    type="url"
                    inputMode="url"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://…"
                    className="h-12 w-full rounded-xl border border-input bg-card pl-10 pr-10 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                  />
                  {link && (
                    <button type="button" onClick={() => setLink("")} aria-label="Effacer" className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">Le texte lisible de la page est extrait puis importé comme une source. Pour un PDF en ligne, télécharge-le et utilise l&apos;onglet Fichiers.</p>
              </div>
              <Input label="Titre (optionnel)" placeholder="Par défaut : le titre de la page" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Button className="w-full sm:w-auto sm:self-center sm:px-10" disabled={isSubmitting || !link.trim()} isLoading={isSubmitting} onClick={() => void handleImportLink()}>
                {!isSubmitting && <Globe className="h-4 w-4" />}
                Importer la page
              </Button>
            </>
          )}
        </motion.div>

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{error}</span>
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
