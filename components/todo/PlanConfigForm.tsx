"use client";

import { DragEvent, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CalendarDays, FileText, ImageIcon, Loader2, Sparkles, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import { tTodo } from "@/lib/translations/todo";
import type { Language } from "@/providers/LanguageProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type { GeneratedPlanDay } from "@/types/study-planner";

function buildRestDaysOptions(language: Language) {
  return Array.from({ length: 7 }, (_, i) => ({
    value: String(i),
    label: i === 0 ? tTodo("restDaysNone", language) : `${i} ${tTodo("dayWord", language)}${i > 1 ? "s" : ""}`,
  }));
}

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
  const { language } = useLanguage();
  const restDaysOptions = useMemo(() => buildRestDaysOptions(language), [language]);
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

  // A live preview of what "Générer avec l'IA" is about to produce — the
  // brief calls for the student always knowing what the next step holds, and
  // right now the only way to find out was to submit and wait. Purely
  // informational (rough week-based rest estimate), never blocks generation.
  const previewStats = useMemo(() => {
    const hours = Number(hoursPerDay);
    const rest = Number(restDays);
    if (!examDate || !Number.isFinite(hours) || hours <= 0) return null;

    const examDateMs = new Date(`${examDate}T12:00:00`).getTime();
    const diffMs = examDateMs - Date.now();
    if (!Number.isFinite(examDateMs) || diffMs <= 0) return null;

    const totalDays = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
    const restDaysTotal = Math.round((totalDays / 7) * rest);
    const studyDays = Math.max(0, totalDays - restDaysTotal);
    const totalHours = Math.round(studyDays * hours);

    return { totalDays, studyDays, totalHours };
  }, [hoursPerDay, restDays, examDate]);

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
        <h2 className="text-lg font-bold tracking-tight text-foreground">{tTodo("configTitle", language)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{tTodo("configSubtitle", language)}</p>
      </div>

      {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={tTodo("hoursPerDayLabel", language)}
          name="hoursPerDay"
          type="number"
          min={0.5}
          max={16}
          step={0.5}
          value={hoursPerDay}
          onChange={(e) => setHoursPerDay(e.target.value)}
        />
        <Select label={tTodo("restDaysLabel", language)} name="restDays" options={restDaysOptions} value={restDays} onValueChange={setRestDays} />
      </div>

      <Input
        label={tTodo("examDateLabel", language)}
        name="examDate"
        type="date"
        min={minExamDate}
        value={examDate}
        onChange={(e) => setExamDate(e.target.value)}
      />

      {previewStats && (
        <div className="flex animate-in fade-in slide-in-from-top-1 items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground duration-200">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            {tTodo("previewIntro", language)}{" "}
            <span className="font-semibold text-primary">
              {previewStats.totalDays} {tTodo("dayWord", language)}{previewStats.totalDays > 1 ? "s" : ""}
            </span>{" "}
            {tTodo("previewBeforeExam", language)}{" "}
            <span className="font-semibold text-primary">
              {previewStats.studyDays} {tTodo("dayWord", language)}{previewStats.studyDays > 1 ? "s" : ""} {tTodo("previewOfRevision", language)}
            </span>{" "}
            (~{previewStats.totalHours} h {tTodo("previewInTotal", language)}) {tTodo("previewOnceRestSubtracted", language)}
          </p>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-sm font-medium text-foreground">{tTodo("programOptionalLabel", language)}</p>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-all duration-300 sm:py-8",
            isDragging
              ? "scale-[1.01] border-primary bg-primary/5 shadow-glow"
              : "border-input hover:border-primary/40 hover:bg-primary/5 hover:shadow-soft"
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
            <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
              <UploadCloud className="h-6 w-6 text-muted-foreground" />
            </motion.div>
          )}
          <p className="text-sm text-muted-foreground">{tTodo("dropzoneText", language)}</p>
        </div>

        {source && (
          <div className="mt-2 flex animate-in fade-in zoom-in-95 items-center gap-2 rounded-xl border border-input bg-card px-3 py-2 text-sm duration-200">
            {source.imageOnly ? <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" /> : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className="flex-1 truncate">{source.fileName}</span>
            <button type="button" onClick={() => setSource(null)} className="shrink-0 rounded-md p-2.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-foreground">{tTodo("manualCoursesLabel", language)}</p>
        <textarea
          value={manualCourses}
          onChange={(e) => setManualCourses(e.target.value)}
          placeholder={tTodo("manualCoursesPlaceholder", language)}
          rows={4}
          className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground shadow-soft transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary sm:text-sm"
        />
      </div>

      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="outline" size="lg" onClick={onBack} disabled={isGenerating} className="w-full sm:w-auto">
          {tTodo("back", language)}
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={handleGenerate}
          isLoading={isGenerating}
          className="w-full bg-gradient-to-r from-primary to-violet-500 shadow-[0_0_30px_rgba(20,184,166,0.35)] sm:w-auto"
        >
          {!isGenerating && <Sparkles className="h-4 w-4" />}
          {tTodo("generateWithAI", language)}
        </Button>
      </div>
    </div>
  );
}
