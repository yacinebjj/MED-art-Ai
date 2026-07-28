"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { PublicCourseSummary } from "@/lib/dashboard-modules";

export function DeleteCourseDialog({
  open,
  onOpenChange,
  course,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: PublicCourseSummary;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/courses/slug/${course.slug}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "La suppression a échoué.");
      onDeleted();
      toast({ variant: "success", title: "Cours supprimé" });
      onOpenChange(false);
    } catch (err) {
      toast({ variant: "error", title: "Échec de la suppression", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-500" />
            Supprimer ce cours ?
          </DialogTitle>
          <DialogDescription>
            « {course.title} » sera définitivement supprimé. Cette action est irréversible.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            Annuler
          </Button>
          <Button type="button" variant="danger" onClick={handleDelete} isLoading={isDeleting}>
            Supprimer définitivement
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
