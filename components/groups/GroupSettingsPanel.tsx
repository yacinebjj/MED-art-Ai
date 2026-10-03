"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Crown, DoorOpen, Link2, Loader2, Pencil, RefreshCw, Share2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { gradientFor } from "@/lib/group-avatar-gradient";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { BottomSheetHandle, useBottomSheetMotion } from "@/components/ui/BottomSheet";
import type { ChatGroup, ChatMember } from "@/types/group-chat";

interface GroupSettingsPanelProps {
  group: ChatGroup | null;
  members: ChatMember[] | null;
  currentUserId: string | null;
  onlineUserIds: Set<string>;
  isOpen: boolean;
  onClose: () => void;
  onGroupUpdated: (group: ChatGroup) => void;
}

/** Invite link: opens the lobby with the code pre-filled (joining still needs the admin's approval). */
export function inviteLinkFor(joinCode: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/dashboard/groups?join=${encodeURIComponent(joinCode)}`;
}

/**
 * Group settings drawer: identity, invite link + code (copy / native share),
 * and the admin's controls — rename, new invite code (old one stops
 * working), hand the group over to a member, delete it. Members can leave.
 */
export function GroupSettingsPanel({ group, members, currentUserId, onlineUserIds, isOpen, onClose, onGroupUpdated }: GroupSettingsPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { sheetProps, startDrag } = useBottomSheetMotion(onClose);
  const [nameDraft, setNameDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "delete" | "leave" | "transfer"; targetId?: string; targetName?: string }>(null);

  const isAdmin = !!group && group.adminId === currentUserId;

  useEffect(() => {
    if (isOpen && group) {
      setNameDraft(group.name);
      setEditingName(false);
    }
  }, [isOpen, group]);

  async function patch(body: Record<string, unknown>, key: string, success: string) {
    if (!group) return;
    setBusy(key);
    try {
      const res = await fetch(`/api/groups/${group.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "La modification a échoué.");
      onGroupUpdated(data.group as ChatGroup);
      toast({ variant: "success", title: success });
      return true;
    } catch (error) {
      toast({ variant: "error", title: error instanceof Error ? error.message : "La modification a échoué." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function copy(value: string, which: "link" | "code") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast({ variant: "error", title: "Copie impossible sur cet appareil." });
    }
  }

  async function share() {
    if (!group) return;
    const url = inviteLinkFor(group.joinCode);
    const text = `Rejoins « ${group.name} » sur MedArt AI — code ${group.joinCode}`;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: group.name, text, url });
        return;
      } catch {
        // Share sheet dismissed: fall back to copying.
      }
    }
    void copy(`${text}\n${url}`, "link");
  }

  async function runConfirmed() {
    if (!group || !confirm) return;
    if (confirm.kind === "transfer" && confirm.targetId) {
      const ok = await patch({ transferAdminTo: confirm.targetId }, "transfer", `${confirm.targetName ?? "Ce membre"} est maintenant administrateur.`);
      if (ok) setConfirm(null);
      return;
    }
    setBusy(confirm.kind);
    try {
      const res =
        confirm.kind === "delete"
          ? await fetch(`/api/groups/${group.id}`, { method: "DELETE" })
          : await fetch(`/api/groups/${group.id}/leave`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "L'action a échoué.");
      toast({ variant: "success", title: confirm.kind === "delete" ? "Groupe supprimé." : "Tu as quitté le groupe." });
      setConfirm(null);
      onClose();
      router.push("/dashboard/groups");
    } catch (error) {
      toast({ variant: "error", title: error instanceof Error ? error.message : "L'action a échoué." });
    } finally {
      setBusy(null);
    }
  }

  const otherMembers = (members ?? []).filter((m) => m.userId !== currentUserId);

  return (
    <>
      <AnimatePresence>
        {isOpen && group && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
              onClick={onClose}
            />
            <motion.div
              {...sheetProps}
              className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[85dvh] flex-col rounded-t-3xl border-t border-zinc-200 bg-white/95 shadow-xl backdrop-blur-xl dark:border-white/5 dark:bg-zinc-950/95 sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:bottom-auto sm:h-full sm:max-h-none sm:w-[26rem] sm:rounded-l-2xl sm:rounded-t-none sm:border-l sm:border-t-0"
            >
              <BottomSheetHandle onPointerDown={startDrag} />
              <div className="flex shrink-0 items-center justify-between p-4 pb-2 max-sm:pt-1">
                <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-white">Paramètres du groupe</h2>
                <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="chat-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
                {/* Identity */}
                <div className="flex flex-col items-center gap-3 pt-2 text-center">
                  <div className={cn("flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br text-3xl font-black text-white shadow-xl", gradientFor(group.id))}>
                    {group.name.trim().charAt(0).toUpperCase() || "?"}
                  </div>
                  {editingName ? (
                    <form
                      className="flex w-full items-center gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (nameDraft.trim() && nameDraft.trim() !== group.name) {
                          const ok = await patch({ name: nameDraft.trim() }, "name", "Groupe renommé.");
                          if (ok) setEditingName(false);
                        } else setEditingName(false);
                      }}
                    >
                      <input
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        maxLength={80}
                        className="h-10 min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-cyan-400 dark:border-white/10 dark:bg-zinc-900 dark:text-white"
                      />
                      <Button type="submit" size="sm" isLoading={busy === "name"}>
                        OK
                      </Button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-extrabold text-zinc-900 dark:text-white">{group.name}</p>
                      {isAdmin && (
                        <button type="button" onClick={() => setEditingName(true)} aria-label="Renommer" className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white">
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {(members ?? []).length} membre{(members ?? []).length > 1 ? "s" : ""} · {Math.max(0, onlineUserIds.size)} en ligne · créé le{" "}
                    {new Date(group.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                </div>

                {/* Invite */}
                <section className="space-y-2 rounded-2xl border border-cyan-200/60 bg-gradient-to-br from-cyan-50 to-blue-50 p-4 dark:border-cyan-900/40 dark:from-cyan-950/30 dark:to-blue-950/20">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                    <Link2 className="h-3.5 w-3.5" />
                    Inviter des collègues
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-xl bg-white/80 px-3 py-2 text-center font-mono text-xl font-black tracking-[0.3em] text-zinc-900 dark:bg-black/30 dark:text-white">{group.joinCode}</code>
                    <button
                      type="button"
                      onClick={() => copy(group.joinCode, "code")}
                      aria-label="Copier le code"
                      className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-zinc-600 shadow-sm hover:text-cyan-600 dark:bg-zinc-900 dark:text-zinc-300"
                    >
                      {copied === "code" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => copy(inviteLinkFor(group.joinCode), "link")}>
                      {copied === "link" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      Copier le lien
                    </Button>
                    <Button type="button" className="flex-1" onClick={share}>
                      <Share2 className="h-4 w-4" />
                      Partager
                    </Button>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Chaque demande arrive chez l&apos;admin, qui l&apos;accepte ou la refuse.</p>
                  {isAdmin && (
                    <button
                      type="button"
                      disabled={busy === "code"}
                      onClick={() => patch({ regenerateJoinCode: true }, "code", "Nouveau code généré — l'ancien ne fonctionne plus.")}
                      className="flex items-center gap-1.5 text-xs font-semibold text-cyan-700 hover:underline disabled:opacity-60 dark:text-cyan-300"
                    >
                      {busy === "code" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Générer un nouveau code
                    </button>
                  )}
                </section>

                {/* Admin hand-over */}
                {isAdmin && otherMembers.length > 0 && (
                  <section className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Transmettre l&apos;administration</p>
                    <div className="space-y-1">
                      {otherMembers.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => setConfirm({ kind: "transfer", targetId: member.userId, targetName: member.displayName ?? "Ce membre" })}
                          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/5"
                        >
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold dark:bg-zinc-800">
                            {(member.displayName ?? "?").trim().charAt(0).toUpperCase() || "?"}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{member.displayName ?? "Étudiant(e)"}</span>
                          <Crown className="h-4 w-4 text-amber-500" />
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* Danger zone */}
                <section className="space-y-2 border-t border-zinc-200 pt-4 dark:border-white/5">
                  {!isAdmin && (
                    <Button type="button" variant="outline" className="w-full text-rose-600 dark:text-rose-400" onClick={() => setConfirm({ kind: "leave" })}>
                      <DoorOpen className="h-4 w-4" />
                      Quitter le groupe
                    </Button>
                  )}
                  {isAdmin && (
                    <Button type="button" variant="danger" className="w-full" onClick={() => setConfirm({ kind: "delete" })}>
                      <Trash2 className="h-4 w-4" />
                      Supprimer le groupe
                    </Button>
                  )}
                </section>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "delete" ? "Supprimer le groupe ?" : confirm?.kind === "leave" ? "Quitter le groupe ?" : "Transmettre l'administration ?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === "delete"
                ? "Tous les messages, médias partagés et membres seront supprimés définitivement."
                : confirm?.kind === "leave"
                  ? "Tu ne verras plus les messages. Pour revenir, il faudra une nouvelle invitation."
                  : `${confirm?.targetName ?? "Ce membre"} deviendra l'administrateur. Tu resteras membre du groupe.`}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirm(null)} disabled={busy !== null}>
              Annuler
            </Button>
            <Button type="button" variant={confirm?.kind === "transfer" ? "primary" : "danger"} onClick={runConfirmed} isLoading={busy !== null}>
              Confirmer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
