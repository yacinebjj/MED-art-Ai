"use client";

import { DragEvent, useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, Sparkles, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type { GeneratedPlanDay } from "@/types/study-planner";

const REST_DAYS_OPTIONS = Array.from({ length: 7 }, (_, i) => ({ value: String(i), label: i === 0 ? "0 (aucun)" : `${i} jour${i > 1 ? "s" : ""}` }));

interface UploadedSource {
  fileName: string;
  fileUrl: string | null;
  text: string;
  imageOnly: boolean;
}

interface PlanConfigFormProps {
  selectedModuleIds: Set<number>;
  onBack: () => void;
  onGenerated: (result: { planId: number; coachMessage: string; days: GeneratedPlanDay[] }) => void;
}

/** Étape 2 — durée/jour, repos, date d'examen, upload du programme (optionnel), liste manuelle. */
export function PlanConfigForm({ selectedModuleIds, onBack, onGenerated }: PlanConfigFormProps) {
  const { toast } = useToast();
  const [hoursPerDay, setHoursPerDay] = useState("3");
  const [restDays, setRestDays] = useState("1");
  const [examDate, setExamDate] = useState("");
  const [manualCourses, setManualCourses] = useState("");
  const [source, setSource] = useState<UploadedSource | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const minExamDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  async function uploadFile(file: File) {
    setIsUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/study-planner/upload", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Le téléversement a échoué.");
      setSource({ fileName: data.fileName, fileUrl: data.fileUrl, text: data.text ?? "", imageOnly: Boolean(data.imageOnly) });
      if (data.imageOnly) {
        toast({ variant: "info", title: "Image enregistrée — l'extraction automatique du texte n'est pas encore disponible pour les images. Utilise la liste manuelle ci-dessous si besoin." });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Le téléversement a échoué.");
    } finally {
      setIsUploading(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  async function handleGenerate() {
    setError(null);

    const hours = Number(hoursPerDay);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 16) {
      setError("Renseigne un nombre d'heures par jour valide (entre 0 et 16).");
      return;
    }
    if (!examDate) {
      setError("Choisis une date d'examen.");
      return;
    }

    setIsGenerating(true);
    try {
      const createRes = await fetch("/api/study-planner/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleIds: Array.from(selectedModuleIds),
          hoursPerDay: hours,
          restDays: Number(restDays),
          examDate,
          sourceFileUrl: source?.fileUrl ?? null,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.success) throw new Error(createData.error ?? "La création du plan a échoué.");

      const manualCourseTitles = manualCourses
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);

      const generateRes = await fetch("/api/study-planner/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: createData.plan.id,
          manualCourseTitles,
          programText: source?.imageOnly ? undefined : source?.text || undefined,
        }),
      });
      const generateData = await generateRes.json();
      if (!generateRes.ok || !generateData.success) throw new Error(generateData.error ?? "La génération a échoué.");

      onGenerated({ planId: createData.plan.id, coachMessage: generateData.coachMessage, days: generateData.days });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-foreground">Configure ton planning</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ces informations permettent à l'IA de construire un planning réaliste et tenable.</p>
      </div>

      {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Heures d'étude par jour"
          name="hoursPerDay"
          type="number"
          min={0.5}
          max={16}
          step={0.5}
          value={hoursPerDay}
          onChange={(e) => setHoursPerDay(e.target.value)}
        />
        <Select label="Jours de repos par semaine" name="restDays" options={REST_DAYS_OPTIONS} value={restDays} onValueChange={setRestDays} />
      </div>

      <Input
        label="Date de l'examen"
        name="examDate"
        type="date"
        min={minExamDate}
        value={examDate}
        onChange={(e) => setExamDate(e.target.value)}
      />

      <div>
        <p className="mb-1.5 text-sm font-medium text-foreground">Programme officiel (Optionnel)</p>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors",
            isDragging ? "border-primary bg-primary/5" : "border-input hover:border-primary/40 hover:bg-primary/5"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.txt,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = "";
            }}
          />
          {isUploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          ) : (
            <UploadCloud className="h-6 w-6 text-muted-foreground" />
          )}
          <p className="text-sm text-muted-foreground">Glisse une image ou un PDF du programme, ou clique pour choisir</p>
        </div>

        {source && (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-input bg-card px-3 py-2 text-sm">
            {source.imageOnly ? <ImageIcon className="h-4 w-4 text-muted-foreground" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
            <span className="flex-1 truncate">{source.fileName}</span>
            <button type="button" onClick={() => setSource(null)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-foreground">Liste manuelle de cours (si pas de fichier)</p>
        <textarea
          value={manualCourses}
          onChange={(e) => setManualCourses(e.target.value)}
          placeholder={"Un cours par ligne, ex :\nCardiologie — Insuffisance cardiaque\nPneumologie — Tuberculose"}
          rows={4}
          className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground shadow-soft transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary"
        />
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack} disabled={isGenerating}>
          Retour
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={handleGenerate}
          isLoading={isGenerating}
          className="bg-gradient-to-r from-primary to-violet-500 shadow-[0_0_30px_rgba(20,184,166,0.35)]"
        >
          {!isGenerating && <Sparkles className="h-4 w-4" />}
          Générer avec l'IA
        </Button>
      </div>
    </div>
  );
}
