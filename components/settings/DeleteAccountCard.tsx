"use client";

/**
 * Paramètres › Appareils — « Supprimer mon compte ». Deletes the account and
 * its data for good (POST /api/account/delete, lib/account-deletion.ts),
 * after a typed confirmation. On success this device is signed out, its
 * local data is cleared and the student lands on the home page.
 */

import { useState } from "react";
import { Loader2, Trash2, UserX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { SettingsCard, SettingsRow, SettingsRows } from "@/components/settings/SettingsUI";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/providers/LanguageProvider";

export function DeleteAccountCard() {
  const { language } = useLanguage();
  const fr = language === "fr";
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const word = fr ? "SUPPRIMER" : "DELETE";
  const confirmed = typed.trim().toUpperCase() === word;

  function close(next: boolean) {
    if (deleting) return;
    setOpen(next);
    if (!next) setTyped("");
  }

  async function deleteAccount() {
    if (!confirmed || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: word }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        toast({
          variant: res.status === 409 ? "warning" : "error",
          title: fr ? "Suppression impossible pour le moment" : "Can't delete your account right now",
          description: data.error ?? (fr ? "Réessaie dans un instant." : "Try again in a moment."),
        });
        setDeleting(false);
        return;
      }
      // The account is gone: drop this device's session and everything it kept locally.
      await createClient()
        .auth.signOut({ scope: "local" })
        .catch(() => undefined);
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        // Storage blocked: nothing kept there anyway.
      }
      window.location.replace("/");
    } catch {
      toast({ variant: "error", title: fr ? "Connexion perdue" : "Connection lost", description: fr ? "Réessaie dans un instant." : "Try again in a moment." });
      setDeleting(false);
    }
  }

  return (
    <>
      <SettingsCard tone="danger" icon={UserX} title={fr ? "Supprimer mon compte" : "Delete my account"}>
        <SettingsRows>
          <SettingsRow
            label={fr ? "Suppression définitive" : "Permanent deletion"}
            description={
              fr
                ? "Supprime ton compte et toutes tes données : cours, notes, flashcards, examens, historique et fichiers envoyés."
                : "Deletes your account and all your data: courses, notes, flashcards, exams, history and uploaded files."
            }
          >
            <Button variant="danger" onClick={() => setOpen(true)} className="w-full sm:w-auto">
              <Trash2 className="h-4 w-4" />
              {fr ? "Supprimer mon compte" : "Delete my account"}
            </Button>
          </SettingsRow>
        </SettingsRows>
      </SettingsCard>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{fr ? "Supprimer définitivement ton compte ?" : "Delete your account for good?"}</DialogTitle>
            <DialogDescription>
              {fr
                ? "Tes cours, notes, flashcards, examens, historique, fichiers envoyés et ton profil seront supprimés. C'est irréversible. Un abonnement en cours est perdu, sans remboursement. Les justificatifs de paiement sont conservés pour la comptabilité."
                : "Your courses, notes, flashcards, exams, history, uploaded files and profile will be deleted. This can't be undone. A current subscription is lost, without refund. Payment records are kept for accounting."}
            </DialogDescription>
          </DialogHeader>
          <label className="mt-4 block text-[0.8125rem] font-medium text-slate-700 dark:text-white/80" htmlFor="delete-account-confirmation">
            {fr ? (
              <>
                Tape <span className="font-mono font-semibold">{word}</span> pour confirmer
              </>
            ) : (
              <>
                Type <span className="font-mono font-semibold">{word}</span> to confirm
              </>
            )}
          </label>
          <Input
            id="delete-account-confirmation"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={deleting}
            className="mt-2"
          />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => close(false)} disabled={deleting}>
              {fr ? "Annuler" : "Cancel"}
            </Button>
            <Button variant="danger" onClick={() => void deleteAccount()} disabled={!confirmed || deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {fr ? "Supprimer définitivement" : "Delete for good"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
