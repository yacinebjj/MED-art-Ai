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

type UploadTab = "file" | "text" | "drive";

export function UploadModal({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new course's slug once the instant-insert upload succeeds. */
  onUploaded: (slug: string) => void;
}) {
  const [tab, setTab] = useState<UploadTab>("file");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  async function handleSubmitFile() {
    if (!file) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/generate-course", { method: "POST", body });
      const data = await res.json();

      if (!res.ok || !data.success) throw new Error(data.error ?? "Le téléversement a échoué.");

      onUploaded(data.slug);
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
      const body = new FormData();
      body.append("text", text);
      body.append("title", title);
      const res = await fetch("/api/generate-course", { method: "POST", body });
      const data = await res.json();

      if (!res.ok || !data.success) throw new Error(data.error ?? "L'import a échoué.");

      onUploaded(data.slug);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'import a échoué.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Ajouter un cours</DialogTitle>
          <DialogDescription>
            Importe un document ou colle du texte pour créer un nouvel espace de travail.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as UploadTab)}>
          <TabsList className="mb-4">
            <TabsTrigger value="file">Fichier (PDF/DOCX)</TabsTrigger>
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
                  isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-gray-50 hover:bg-gray-100"
                )}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED_FILE_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <UploadCloud className="mb-3 h-8 w-8 text-gray-400" />
                <p className="text-sm font-medium text-gray-700">
                  {file ? file.name : "Glisse-dépose ton fichier ici, ou clique pour parcourir"}
                </p>
                <p className="mt-1 text-xs text-gray-500">PDF, PPTX, DOCX</p>
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
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
              <HardDrive className="mb-3 h-8 w-8 text-gray-400" />
              <p className="text-sm font-medium text-gray-700">Google Drive</p>
              <p className="mt-1 text-xs text-gray-500">Bientôt disponible.</p>
              <Button className="mt-4" disabled variant="outline">
                Connecter Google Drive
              </Button>
            </div>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
