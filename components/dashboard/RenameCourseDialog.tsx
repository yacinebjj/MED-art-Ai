"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { PublicCourseSummary } from "@/lib/dashboard-modules";

export function RenameCourseDialog({
  open,
  onOpenChange,
  course,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: PublicCourseSummary;
  onRenamed: (title: string) => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(course.title);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) setTitle(course.title);
  }, [open, course.title]);

  async function handleSave() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/courses/slug/${course.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Le renommage a échoué.");
      onRenamed(trimmed);
      toast({ variant: "success", title: "Cours renommé" });
      onOpenChange(false);
    } catch (err) {
      toast({ variant: "error", title: "Échec du renommage", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Renommer le cours</DialogTitle>
          <DialogDescription>Choisis un nouveau titre pour ce cours.</DialogDescription>
        </DialogHeader>

        <Input
          label="Titre"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          autoFocus
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Annuler
          </Button>
          <Button type="button" onClick={handleSave} isLoading={isSaving} disabled={!title.trim()}>
            Enregistrer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
