"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Bookmark, FolderOpen, Hash, Maximize2, MessageSquare, Minimize2, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMember, MyChatGroup } from "@/types/group-chat";
import type { LocalChatMessage } from "./MessageBubble";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  currentGroupId: string;
  messages: LocalChatMessage[];
  members: ChatMember[] | null;
  isFullscreen: boolean;
  onJumpToMessage: (messageId: string) => void;
  onOpenVault: () => void;
  onOpenSaved: () => void;
  onOpenMembers: () => void;
  onToggleFullscreen: () => void;
}

interface CourseHit {
  courseId: number;
  courseTitle: string;
  moduleId: number;
  moduleName: string | null;
  sectionLabel: string;
  excerpt: string;
}

/** One flattened, keyboard-navigable row — whichever section it came from. */
interface Row {
  key: string;
  icon: typeof Hash;
  title: string;
  subtitle: string;
  onSelect: () => void;
}

const MIN_REMOTE_QUERY_LENGTH = 2;
const REMOTE_DEBOUNCE_MS = 250;

/**
 * Ctrl/Cmd+K command palette — every result is REAL data already reachable
 * elsewhere in the app, just federated into one fast list: this component
 * invents no new search index. "Cette discussion" and "Membres" filter data
 * ChatRoom already holds in state; "Groupes" hits the existing
 * GET /api/groups; "Vos cours" proxies the existing POST /api/search
 * (Studio courses, user-scoped — see that route's own isolation comment).
 * Deliberately grouped under labeled sections rather than one flat list, so
 * the palette never oversells itself as searching more than it actually
 * does.
 */
export function CommandPalette({
  isOpen,
  onClose,
  currentGroupId,
  messages,
  members,
  isFullscreen,
  onJumpToMessage,
  onOpenVault,
  onOpenSaved,
  onOpenMembers,
  onToggleFullscreen,
}: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [groups, setGroups] = useState<MyChatGroup[] | null>(null);
  const [courseHits, setCourseHits] = useState<CourseHit[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setActiveIndex(0);
    // Small delay — the palette is still animating in on the same frame this
    // effect runs, and focusing before the mount transition starts can lose
    // the focus ring/caret in some browsers.
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    if (groups === null) {
      fetch("/api/groups")
        .then((r) => r.json())
        .then((data) => {
          if (data.success) setGroups(data.groups as MyChatGroup[]);
        })
        .catch(() => {});
    }
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Studio course search is the one remote, query-dependent section —
  // debounced and gated on a minimum length so opening the palette or typing
  // one character doesn't fire a network request per keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_REMOTE_QUERY_LENGTH) {
      setCourseHits([]);
      return;
    }
    const handle = setTimeout(() => {
      fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) })
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data.results)) setCourseHits((data.results as CourseHit[]).slice(0, 5));
        })
        .catch(() => {});
    }, REMOTE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: { label: string; rows: Row[] }[] = [];

    const quickActions: Row[] = [
      { key: "action-vault", icon: FolderOpen, title: "Ouvrir le Vault Médical", subtitle: "Photos, vidéos, vocaux partagés", onSelect: onOpenVault },
      { key: "action-saved", icon: Bookmark, title: "Messages enregistrés", subtitle: "Tes faits à haut rendement", onSelect: onOpenSaved },
      { key: "action-members", icon: Users, title: "Voir les membres", subtitle: "Qui est dans ce groupe", onSelect: onOpenMembers },
      {
        key: "action-fullscreen",
        icon: isFullscreen ? Minimize2 : Maximize2,
        title: isFullscreen ? "Quitter le plein écran" : "Passer en plein écran",
        subtitle: "Mode Command Center",
        onSelect: onToggleFullscreen,
      },
    ].filter((row) => !q || row.title.toLowerCase().includes(q));
    if (quickActions.length > 0) out.push({ label: "Actions rapides", rows: quickActions });

    if (q.length >= 1) {
      const messageRows: Row[] = messages
        .filter((m) => m.type === "text" && m.contentText?.toLowerCase().includes(q))
        .slice(-8)
        .reverse()
        .map((m) => ({
          key: `msg-${m.id}`,
          icon: MessageSquare,
          title: m.contentText ?? "",
          subtitle: m.senderName ?? "Étudiant(e)",
          onSelect: () => onJumpToMessage(m.id),
        }));
      if (messageRows.length > 0) out.push({ label: "Cette discussion", rows: messageRows });

      const memberRows: Row[] = (members ?? [])
        .filter((m) => (m.displayName ?? "").toLowerCase().includes(q))
        .slice(0, 6)
        .map((m) => ({
          key: `member-${m.id}`,
          icon: Users,
          title: m.displayName ?? "Étudiant(e)",
          subtitle: m.academicYearName ?? "Membre du groupe",
          onSelect: onOpenMembers,
        }));
      if (memberRows.length > 0) out.push({ label: "Membres", rows: memberRows });
    }

    const groupRows: Row[] = (groups ?? [])
      .filter((g) => g.id !== currentGroupId && (!q || g.name.toLowerCase().includes(q)))
      .slice(0, 6)
      .map((g) => ({
        key: `group-${g.id}`,
        icon: Hash,
        title: g.name,
        subtitle: g.lastMessage?.preview ?? "Aucun message",
        onSelect: () => router.push(`/dashboard/groups/${g.id}`),
      }));
    if (groupRows.length > 0) out.push({ label: "Groupes", rows: groupRows });

    const courseRows: Row[] = courseHits.map((h) => ({
      key: `course-${h.courseId}-${h.sectionLabel}`,
      icon: BookOpen,
      title: h.courseTitle,
      subtitle: `${h.sectionLabel} · ${h.moduleName ?? "Module"}`,
      onSelect: () => router.push(`/dashboard/module/${h.moduleId}`),
    }));
    if (courseRows.length > 0) out.push({ label: "Vos cours", rows: courseRows });

    return out;
  }, [query, messages, members, groups, courseHits, currentGroupId, isFullscreen, onOpenVault, onOpenSaved, onOpenMembers, onToggleFullscreen, onJumpToMessage, router]);

  const flatRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  function select(row: Row) {
    row.onSelect();
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatRows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = flatRows[activeIndex];
      if (row) select(row);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  let rowCursor = 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="fixed left-1/2 top-[12vh] z-[101] w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-black/20 dark:border-white/5 dark:bg-zinc-950 dark:shadow-black/60"
            onKeyDown={handleKeyDown}
          >
            <div className="flex items-center gap-2.5 border-b border-zinc-200 px-4 py-3 dark:border-white/5">
              <Search className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                placeholder="Rechercher un message, un membre, un groupe, un cours…"
                className="h-6 flex-1 border-none bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-white dark:placeholder:text-zinc-500"
              />
              <kbd className="hidden shrink-0 rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400 dark:border-white/10 dark:text-zinc-500 sm:block">
                Esc
              </kbd>
            </div>

            <div className="chat-scrollbar max-h-[50vh] overflow-y-auto p-2">
              {flatRows.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">Aucun résultat.</p>
              ) : (
                sections.map((section) => (
                  <div key={section.label} className="mb-2 last:mb-0">
                    <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{section.label}</p>
                    {section.rows.map((row) => {
                      const index = rowCursor++;
                      const Icon = row.icon;
                      const isActive = index === activeIndex;
                      return (
                        <button
                          key={row.key}
                          type="button"
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => select(row)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                            isActive ? "bg-zinc-100 dark:bg-white/10" : "hover:bg-zinc-50 dark:hover:bg-white/5"
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-zinc-900 dark:text-white">{row.title}</span>
                            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{row.subtitle}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
