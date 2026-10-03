"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BellRing, Clock, KeyRound, Mail, MessagesSquare, Plus, RotateCcw, Search, Sparkles, Stethoscope, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { GroupCard } from "@/components/groups/GroupCard";
import type { MyChatGroup } from "@/types/group-chat";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { tGroups } from "@/lib/translations/groups";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const LIST_VARIANTS = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const ITEM_VARIANTS = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };
const TEMP_PREFIX = "creating-";

/** Last good list, per user, on this device: the lobby paints instantly, then revalidates. */
const cacheKey = (userId: string) => `medart:groups-lobby:${userId}`;

function readCache(userId: string): MyChatGroup[] | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(cacheKey(userId)) ?? "null");
    return Array.isArray(parsed) ? (parsed as MyChatGroup[]) : null;
  } catch {
    return null;
  }
}

function writeCache(userId: string, groups: MyChatGroup[]) {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(groups.filter((g) => !g.id.startsWith(TEMP_PREFIX))));
  } catch {
    // Storage full or blocked: the list still works, just without instant paint next time.
  }
}

/**
 * "Groupes d'étude" lobby — create a group, join one by code or invite link,
 * and open the ones you belong to.
 *
 * Reliability rules (the "my group disappeared" bug): the list paints from
 * the last cached copy and revalidates in the background; a failed fetch
 * shows an explicit error with Retry (it used to be swallowed silently, which
 * looked exactly like "all my groups were deleted"); creation is optimistic —
 * the card appears on click and is replaced by the server's row, or rolled
 * back with an explanation.
 */
function GroupsLobby() {
  const { language } = useLanguage();
  const { toast } = useToast();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const searchParams = useSearchParams();

  const [groups, setGroups] = useState<MyChatGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [query, setQuery] = useState("");
  const [invitedCode, setInvitedCode] = useState<string | null>(null);
  const joinInputRef = useRef<HTMLDivElement>(null);

  const loadGroups = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15_000);
      const res = await fetch("/api/groups", { cache: "no-store", signal: controller.signal }).finally(() => window.clearTimeout(timer));
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? `Erreur ${res.status}`);
      const fresh = data.groups as MyChatGroup[];
      setGroups((prev) => [...(prev ?? []).filter((g) => g.id.startsWith(TEMP_PREFIX)), ...fresh]);
      setLoadError(null);
      if (userId) writeCache(userId, fresh);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      setLoadError(aborted ? "Le serveur met trop de temps à répondre." : error instanceof Error ? error.message : "Erreur inconnue.");
    } finally {
      setIsRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const cached = readCache(userId);
    if (cached) setGroups(cached);
    void loadGroups();
  }, [userId, loadGroups]);

  // Back to the tab: revalidate (another member may have accepted me, a new message arrived…).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadGroups();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadGroups]);

  // Invite link: /dashboard/groups?join=CODE pre-fills the join form (the request itself stays the student's click).
  useEffect(() => {
    const code = searchParams.get("join");
    if (!code) return;
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    if (!clean) return;
    setJoinCode(clean);
    setInvitedCode(clean);
    requestAnimationFrame(() => joinInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [searchParams]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = groupName.trim();
    if (!name) return;

    const tempId = `${TEMP_PREFIX}${Date.now()}`;
    const optimistic: MyChatGroup = {
      id: tempId,
      name,
      adminId: userId ?? "",
      joinCode: "······",
      createdAt: new Date().toISOString(),
      pinnedMessageId: null,
      myStatus: "accepted",
      isAdmin: true,
      pendingCount: 0,
      lastMessage: null,
      unreadCount: 0,
    };
    setGroups((prev) => [optimistic, ...(prev ?? [])]);
    setGroupName("");

    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "La création a échoué.");
      const created = data.group as MyChatGroup;
      setGroups((prev) => {
        const next = (prev ?? []).map((g) => (g.id === tempId ? created : g));
        if (userId) writeCache(userId, next);
        return next;
      });
      toast({ variant: "success", title: `« ${created.name} » est prêt — partage le code ${created.joinCode} avec ta promo.` });
    } catch (err) {
      setGroups((prev) => (prev ?? []).filter((g) => g.id !== tempId));
      setGroupName(name);
      toast({ variant: "error", title: err instanceof Error ? err.message : "La création a échoué." });
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "La demande a échoué.");

      setJoinCode("");
      setInvitedCode(null);
      toast({ variant: "success", title: `Demande envoyée pour « ${data.groupName} » — en attente de l'approbation de l'admin.` });
      void loadGroups();
    } catch (err) {
      toast({ variant: "error", title: err instanceof Error ? err.message : "La demande a échoué." });
    } finally {
      setIsJoining(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (groups ?? []).filter((g) => !q || g.name.toLowerCase().includes(q));
  }, [groups, query]);
  const active = filtered.filter((g) => g.myStatus === "accepted");
  const pending = filtered.filter((g) => g.myStatus === "pending");
  const totalUnread = (groups ?? []).reduce((sum, g) => sum + g.unreadCount, 0);
  const totalRequests = (groups ?? []).reduce((sum, g) => sum + (g.isAdmin ? g.pendingCount : 0), 0);

  return (
    <div className="mx-auto max-w-4xl">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-cyan-600 via-blue-700 to-violet-800 p-5 text-white shadow-xl shadow-cyan-900/20 sm:p-7"
      >
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 left-1/4 h-48 w-48 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 shadow-inner backdrop-blur sm:h-14 sm:w-14">
              <Users className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Groupes d&apos;étude</h1>
              <p className="mt-0.5 text-xs text-white/80 sm:text-sm">Révise, partage tes cours et prépare les examens avec ta promo — en temps réel.</p>
            </div>
          </div>
          <div className="flex gap-2">
            {[
              { label: "groupes", value: (groups ?? []).filter((g) => !g.id.startsWith(TEMP_PREFIX)).length, icon: MessagesSquare },
              { label: "non lus", value: totalUnread, icon: BellRing },
              { label: "demandes", value: totalRequests, icon: Mail },
            ].map((stat) => (
              <div key={stat.label} className="min-w-[4.5rem] rounded-2xl bg-white/10 px-3 py-2 text-center backdrop-blur">
                <p className="text-lg font-black tabular-nums">{groups === null ? "–" : stat.value}</p>
                <p className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white/75">
                  <stat.icon className="h-3 w-3" />
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Invite banner */}
      <AnimatePresence>
        {invitedCode && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 flex items-center gap-3 rounded-2xl border border-violet-300/60 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-800/50 dark:bg-violet-950/30 dark:text-violet-200"
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              Invitation détectée — code <span className="font-mono font-bold">{invitedCode}</span>. Envoie ta demande ci-dessous.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create / join */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.06, ease: EASE_OUT }}
        className="mt-4 grid gap-3 sm:mt-5 sm:grid-cols-2 sm:gap-4"
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
            maxLength={80}
            onChange={(e) => setGroupName(e.target.value)}
          />
          <Button type="submit" className="mt-3 w-full" disabled={!groupName.trim()}>
            Créer le groupe
          </Button>
        </form>

        <div ref={joinInputRef}>
          <form
            onSubmit={handleJoin}
            className={cn(
              "glass-card group h-full rounded-2xl p-4 shadow-glass transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-violet-500/20 dark:shadow-glass-dark sm:rounded-3xl sm:p-5",
              invitedCode && "ring-2 ring-violet-400/70"
            )}
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
        </div>
      </motion.div>

      {/* List */}
      <div className="mt-7 sm:mt-9">
        {loadError && (
          <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              {groups && groups.length > 0 ? "Liste affichée depuis ta dernière visite — " : "Impossible de charger tes groupes — "}
              {loadError}
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadGroups()} isLoading={isRefreshing}>
              <RotateCcw className="h-3.5 w-3.5" />
              Réessayer
            </Button>
          </div>
        )}

        {groups !== null && groups.length > 3 && (
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un groupe…"
              className="h-11 w-full rounded-2xl border border-border/60 bg-background/60 pl-9 pr-3 text-sm outline-none backdrop-blur transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
            />
          </div>
        )}

        {groups === null && !loadError && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card h-20 animate-pulse rounded-2xl shadow-glass dark:shadow-glass-dark sm:h-24 sm:rounded-3xl" />
            ))}
          </div>
        )}

        {groups?.length === 0 && !loadError && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card flex flex-col items-center gap-3 rounded-3xl border-dashed p-8 text-center sm:p-12"
          >
            <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-[0_0_30px_rgba(34,211,238,0.45)]">
                <Stethoscope className="h-8 w-8" />
              </span>
            </motion.div>
            <p className="text-base font-extrabold text-foreground">Le bloc opératoire est prêt.</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Crée le groupe de ta promo — ou entre le code qu&apos;un collègue t&apos;a envoyé — et commencez la garde ensemble : cours, sondages, vocaux et QCM partagés.
            </p>
          </motion.div>
        )}

        {groups !== null && groups.length > 0 && filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucun groupe ne correspond à « {query} ».</p>
        )}

        {active.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Mes groupes</h2>
            <motion.div className="space-y-3" variants={LIST_VARIANTS} initial="hidden" animate="show">
              <AnimatePresence initial={false}>
                {active.map((group) => (
                  <motion.div key={group.id} variants={ITEM_VARIANTS} layout exit={{ opacity: 0, scale: 0.97 }}>
                    <GroupCard group={group} creating={group.id.startsWith(TEMP_PREFIX)} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          </section>
        )}

        {pending.length > 0 && (
          <section className="mt-7">
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              En attente d&apos;approbation
            </h2>
            <div className="space-y-3">
              {pending.map((group) => (
                <GroupCard key={group.id} group={group} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default function GroupsPage() {
  // useSearchParams (invite links) must sit under Suspense in the App Router.
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl space-y-3">
          <div className="h-32 animate-pulse rounded-3xl bg-muted" />
          <div className="h-20 animate-pulse rounded-2xl bg-muted" />
        </div>
      }
    >
      <GroupsLobby />
    </Suspense>
  );
}
