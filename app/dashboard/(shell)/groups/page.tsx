"use client";

import { FormEvent, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, MessagesSquare, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { GroupCard } from "@/components/groups/GroupCard";
import type { MyChatGroup } from "@/types/group-chat";
import { useLanguage } from "@/providers/LanguageProvider";
import { tGroups } from "@/lib/translations/groups";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const LIST_VARIANTS = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const ITEM_VARIANTS = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

/** "Groupes de Révision" lobby — create a group, join one by code, and manage/enter the ones you already belong to. */
export default function GroupsPage() {
  const { language } = useLanguage();
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
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
        className="flex items-center gap-3 sm:gap-4"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500 text-white shadow-[0_0_20px_rgba(20,184,166,0.4)] sm:h-14 sm:w-14 sm:rounded-3xl">
          <Users className="h-5 w-5 sm:h-6 sm:w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">Groupes de Révision</h1>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
            Discute et échange des ressources avec ta promo, en groupe privé sur invitation.
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08, ease: EASE_OUT }}
        className="mt-5 grid gap-3 sm:mt-6 sm:grid-cols-2 sm:gap-4"
      >
        <form
          onSubmit={handleCreate}
          className="glass-card group rounded-2xl p-4 shadow-glass transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-emerald-500/20 dark:shadow-glass-dark sm:rounded-3xl sm:p-5"
        >
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 text-white shadow-[0_0_16px_rgba(16,185,129,0.4)] transition-transform duration-300 group-hover:scale-110">
              <Plus className="h-4 w-4" />
            </span>
            <p className="text-sm font-bold text-foreground">{tGroups("createGroupTitle", language)}</p>
          </div>
          <Input
            name="groupName"
            label={tGroups("groupNameLabel", language)}
            placeholder={tGroups("groupNamePlaceholder", language)}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
          <Button type="submit" className="mt-3 w-full" isLoading={isCreating} disabled={!groupName.trim()}>
            Créer
          </Button>
        </form>

        <form
          onSubmit={handleJoin}
          className="glass-card group rounded-2xl p-4 shadow-glass transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-violet-500/20 dark:shadow-glass-dark sm:rounded-3xl sm:p-5"
        >
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-[0_0_16px_rgba(168,85,247,0.4)] transition-transform duration-300 group-hover:scale-110">
              <KeyRound className="h-4 w-4" />
            </span>
            <p className="text-sm font-bold text-foreground">{tGroups("joinGroupTitle", language)}</p>
          </div>
          <Input
            name="joinCode"
            label={tGroups("joinCodeLabel", language)}
            placeholder="Ex : ABC123"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            className="font-mono tracking-wider"
          />
          <Button type="submit" variant="outline" className="mt-3 w-full" isLoading={isJoining} disabled={!joinCode.trim()}>
            Envoyer la demande
          </Button>
        </form>
      </motion.div>

      <div className="mt-7 sm:mt-9">
        {groups === null && (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="glass-card h-20 animate-pulse rounded-2xl shadow-glass dark:shadow-glass-dark sm:h-24 sm:rounded-3xl" />
            ))}
          </div>
        )}

        {groups?.length === 0 && (
          <div className="glass-card flex flex-col items-center gap-3 rounded-3xl border-dashed p-8 text-center sm:p-10">
            <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
              <MessagesSquare className="h-8 w-8 text-muted-foreground/50" />
            </motion.div>
            <p className="text-sm font-medium text-foreground">Tu ne fais partie d'aucun groupe pour l'instant.</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Crée un groupe pour ta promo ou rejoins-en un avec un code d'invitation ci-dessus.
            </p>
          </div>
        )}

        {groups && groups.length > 0 && (
          <motion.div className="space-y-3" variants={LIST_VARIANTS} initial="hidden" animate="show">
            {groups.map((group) => (
              <motion.div key={group.id} variants={ITEM_VARIANTS}>
                <GroupCard group={group} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
