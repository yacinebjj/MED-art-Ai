"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { GroupCard } from "@/components/groups/GroupCard";
import type { MyChatGroup } from "@/types/group-chat";

/** "Groupes de Révision" lobby — create a group, join one by code, and manage/enter the ones you already belong to. */
export default function GroupsPage() {
  const { toast } = useToast();
  const [groups, setGroups] = useState<MyChatGroup[] | null>(null);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  async function loadGroups() {
    const res = await fetch("/api/groups");
    const data = await res.json();
    if (res.ok && data.success) setGroups(data.groups);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/groups")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.success) setGroups(data.groups);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!groupName.trim() || isCreating) return;

    setIsCreating(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: groupName.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "La création a échoué.");

      setGroups((prev) => [data.group, ...(prev ?? [])]);
      setGroupName("");
      toast({ variant: "success", title: `Groupe "${data.group.name}" créé — partage le code ${data.group.joinCode} avec ta promo.` });
    } catch (err) {
      toast({ variant: "error", title: err instanceof Error ? err.message : "La création a échoué." });
    } finally {
      setIsCreating(false);
    }
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!joinCode.trim() || isJoining) return;

    setIsJoining(true);
    try {
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode: joinCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "La demande a échoué.");

      setJoinCode("");
      toast({ variant: "success", title: `Demande envoyée pour "${data.groupName}" — en attente de l'approbation de l'admin.` });
      loadGroups();
    } catch (err) {
      toast({ variant: "error", title: err instanceof Error ? err.message : "La demande a échoué." });
    } finally {
      setIsJoining(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Groupes de Révision</h1>
      <p className="mt-1 text-sm text-muted-foreground">Discute et échange des ressources avec ta promo, en groupe privé sur invitation.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <form onSubmit={handleCreate} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Plus className="h-4 w-4 text-primary" />
            Créer un groupe
          </p>
          <Input
            name="groupName"
            placeholder="Ex : Promo 16 Cardio"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
          <Button type="submit" className="mt-3 w-full" isLoading={isCreating} disabled={!groupName.trim()}>
            Créer
          </Button>
        </form>

        <form onSubmit={handleJoin} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Users className="h-4 w-4 text-primary" />
            Rejoindre un groupe
          </p>
          <Input
            name="joinCode"
            placeholder="Code d'invitation"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            className="font-mono tracking-wider"
          />
          <Button type="submit" variant="outline" className="mt-3 w-full" isLoading={isJoining} disabled={!joinCode.trim()}>
            Envoyer la demande
          </Button>
        </form>
      </div>

      <div className="mt-8 space-y-3">
        {groups === null && (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement de tes groupes...
          </div>
        )}
        {groups?.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Tu ne fais partie d'aucun groupe pour l'instant.</p>}
        {groups?.map((group) => <GroupCard key={group.id} group={group} />)}
      </div>
    </div>
  );
}
