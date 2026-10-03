"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/course/workspace/os/Kbd";

export interface CommandItem {
  id: string;
  group: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  keywords?: string[];
  /** Displayed as key badges, e.g. ["Ctrl", "K"]. */
  shortcut?: string[];
  disabled?: boolean;
  run: () => void;
}

const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase();
}

/**
 * Small fuzzy scorer: a contiguous substring hit ranks highest (earlier is
 * better), otherwise every query character must appear in order, with
 * bonuses for consecutive runs and word starts. -1 = no match.
 */
function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const at = text.indexOf(query);
  if (at !== -1) return 1000 - at * 2 + (at === 0 || text[at - 1] === " " ? 200 : 0);

  let score = 0;
  let textIndex = 0;
  let previousMatch = -2;
  for (const ch of query) {
    if (ch === " ") continue;
    const found = text.indexOf(ch, textIndex);
    if (found === -1) return -1;
    score += found === previousMatch + 1 ? 15 : 1;
    if (found === 0 || text[found - 1] === " ") score += 10;
    previousMatch = found;
    textIndex = found + 1;
  }
  return score;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  /** Order in which groups are listed when the query is empty. */
  groupOrder: string[];
  /** Input placeholder; defaults to the module-workspace wording. */
  placeholder?: string;
  /** Called on every keystroke — lets a caller add query-dependent items (e.g. "Ask the assistant: <query>"). */
  onQueryChange?: (query: string) => void;
}

/**
 * ⌘K / Ctrl+K command palette for the module workspace — every Studio tool,
 * source, navigation target and workspace action, fuzzy-searchable and fully
 * keyboard-driven (↑/↓, Enter, Esc). Rendered in a portal so no transformed
 * ancestor can trap its fixed positioning.
 */
export function CommandPalette({ open, onOpenChange, items, groupOrder, placeholder, onQueryChange }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const listboxId = useId();
  // Ref, not an effect dependency: an inline callback from the caller must not re-run the open/reset effect on every render.
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    onQueryChangeRef.current?.("");
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  const results = useMemo(() => {
    const q = normalize(query.trim());
    const available = items.filter((item) => !item.disabled);
    if (!q) {
      return [...available].sort((a, b) => {
        const ga = groupOrder.indexOf(a.group);
        const gb = groupOrder.indexOf(b.group);
        return (ga === -1 ? 99 : ga) - (gb === -1 ? 99 : gb);
      });
    }
    return available
      .map((item) => {
        const haystack = normalize([item.label, item.description ?? "", item.group, ...(item.keywords ?? [])].join(" "));
        const labelScore = fuzzyScore(q, normalize(item.label));
        const anyScore = fuzzyScore(q, haystack);
        return { item, score: Math.max(labelScore >= 0 ? labelScore + 50 : -1, anyScore) };
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }, [items, query, groupOrder]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function runItem(item: CommandItem | undefined) {
    if (!item) return;
    onOpenChange(false);
    // After the close animation starts, so focus/route changes made by the
    // command aren't immediately undone by the palette's focus restore.
    requestAnimationFrame(() => item.run());
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runItem(results[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    } else if (e.key === "Tab") {
      // Keep focus inside the dialog — the input is its only tab stop.
      e.preventDefault();
    }
  }

  if (!mounted) return null;

  let lastGroup: string | null = null;
  const showGroups = query.trim().length === 0;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1000] flex items-start justify-center px-3 pt-[10vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onKeyDown={handleKeyDown}
        >
          <button
            type="button"
            aria-label="Fermer la palette de commandes"
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-slate-950/40 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Palette de commandes"
            data-command-palette
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 520, damping: 34 }}
            className="relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-[color-mix(in_oklab,var(--card)_95%,transparent)] shadow-[0_24px_80px_-12px_rgb(2_6_23/0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95"
          >
            <div className="flex items-center gap-3 border-b border-[color-mix(in_oklab,var(--border)_70%,transparent)] px-4">
              <Search className="h-4 w-4 shrink-0 text-primary-500" />
              <input
                ref={inputRef}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- a command palette's whole purpose is typing immediately; focus is restored to the opener on close.
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  onQueryChange?.(e.target.value);
                }}
                placeholder={placeholder ?? "Rechercher un outil, une source, une action…"}
                role="combobox"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={results[activeIndex] ? `${listboxId}-${results[activeIndex].id}` : undefined}
                aria-autocomplete="list"
                className="h-14 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              <Kbd>Esc</Kbd>
            </div>

            <div ref={listRef} id={listboxId} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="px-3 py-10 text-center text-sm text-muted-foreground">Aucun résultat pour « {query} ».</p>
              ) : (
                results.map((item, index) => {
                  const Icon = item.icon;
                  const header = showGroups && item.group !== lastGroup ? item.group : null;
                  lastGroup = item.group;
                  const isActive = index === activeIndex;
                  return (
                    <div key={item.id}>
                      {header && <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground first:pt-1">{header}</p>}
                      <div
                        id={`${listboxId}-${item.id}`}
                        role="option"
                        aria-selected={isActive}
                        data-index={index}
                        onMouseMove={() => setActiveIndex(index)}
                        onClick={() => runItem(item)}
                        className={cn(
                          "relative flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                          isActive ? "bg-primary-50 text-foreground dark:bg-primary-950/50" : "text-[color-mix(in_oklab,var(--foreground)_85%,transparent)]"
                        )}
                      >
                        {isActive && (
                          <motion.span
                            layoutId="command-palette-active"
                            className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-primary-500"
                            transition={{ type: "spring", stiffness: 600, damping: 40 }}
                          />
                        )}
                        <span
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
                            isActive ? "border-primary-200 bg-white text-primary-600 shadow-glow dark:border-primary-800 dark:bg-primary-900/60 dark:text-primary-300" : "border-border bg-[color-mix(in_oklab,var(--muted)_60%,transparent)] text-muted-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.label}</span>
                          {item.description && <span className="block truncate text-xs text-muted-foreground">{item.description}</span>}
                        </span>
                        {!showGroups && <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:block">{item.group}</span>}
                        {item.shortcut && (
                          <span className="hidden shrink-0 items-center gap-1 sm:flex">
                            {item.shortcut.map((key) => (
                              <Kbd key={key}>{key}</Kbd>
                            ))}
                          </span>
                        )}
                        {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-primary-500" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-[color-mix(in_oklab,var(--border)_70%,transparent)] px-4 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> naviguer
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> exécuter
              </span>
              <span className="ml-auto">{results.length} résultat{results.length > 1 ? "s" : ""}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
