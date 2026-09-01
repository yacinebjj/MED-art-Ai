"use client";

import { FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";

/** Formats Google Docs Viewer can render that a bare iframe can't (no native browser PDF-style rendering). */
const OFFICE_VIEWER_EXTENSIONS = ["doc", "docx", "ppt", "pptx", "xls", "xlsx"];

function getExtension(value: string): string {
  return value.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
}

interface FileViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  fileUrl: string | null;
  rawText: string;
}

/**
 * "Afficher le cours" — renders the REAL uploaded file (see
 * app/api/upload/route.ts's Supabase Storage upload) instead of just the
 * raw extracted text. PDFs render directly in the iframe (browsers render
 * PDF natively); DOCX/PPTX/XLS(X) route through Google Docs Viewer, which
 * knows how to render Office formats a bare iframe can't. Falls back to the
 * raw extracted text whenever there's no original file to show — pasted-text
 * courses have no `fileUrl` at all, and courses uploaded before this feature
 * existed have `sourceFileUrl: null`.
 */
export function FileViewerModal({ open, onOpenChange, title, fileUrl, rawText }: FileViewerModalProps) {
  // Prefer the extension baked into the Storage path itself — it's derived
  // straight from the original file.name at upload time (see
  // app/api/upload/route.ts's uploadSourceFile), so it's always correct even
  // if `title` was ever edited down the line to no longer end in the real
  // extension. `title` is only a fallback for the (currently impossible, but
  // defensive) case where `fileUrl` itself has none.
  const extension = fileUrl ? getExtension(fileUrl) || getExtension(title) : "";
  const iframeSrc = fileUrl
    ? OFFICE_VIEWER_EXTENSIONS.includes(extension)
      ? `https://docs.google.com/gview?url=${encodeURIComponent(fileUrl)}&embedded=true`
      : fileUrl
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl" onOverlayClick={() => onOpenChange(false)} onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 truncate">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="truncate">{title || "Document source"}</span>
          </DialogTitle>
        </DialogHeader>

        {iframeSrc ? (
          <iframe src={iframeSrc} title={title} className="h-[80vh] w-full rounded-xl border border-border shadow-soft" />
        ) : rawText.trim() ? (
          <div className="h-[80vh] w-full overflow-y-auto rounded-xl border border-border bg-muted/30 p-6 shadow-soft">
            {/* text-select-stable — see its own comment in app/globals.css: fixes a sub-pixel blur on text selection under a Framer Motion ancestor's transform. */}
            <pre className="text-reading text-select-stable whitespace-pre-wrap break-words font-sans text-foreground">{rawText}</pre>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">Aucun contenu disponible pour ce cours.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
