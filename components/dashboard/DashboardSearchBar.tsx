"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, FileText, Loader2, Search } from "lucide-react";
import { useLanguage } from "@/providers/LanguageProvider";
import { tDashboard } from "@/lib/translations/dashboard";

interface SuggestionResult {
  courseId: number;
  courseTitle: string;
  moduleId: number;
  moduleName: string | null;
  sectionLabel: string;
  excerpt: string;
}

const MAX_SUGGESTIONS = 5;
const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

/**
 * The Dashboard's compact search entry point — "God-Tier" pass: a magnetic,
 * focus-reactive bar that live-previews REAL top hits from the same
 * /api/search this app already uses (see app/dashboard/search/page.tsx) as
 * the student types — never a fabricated/static suggestion list — with a
 * fast path straight into a course, and a full submit that still lands on
 * /dashboard/search exactly like before this pass. Self-contained: owns its
 * own query/suggestion state so the Dashboard page itself doesn't need to
 * know any of this exists (was previously inlined there as a plain form).
 */
export function DashboardSearchBar() {
  const router = useRouter();
  const { language } = useLanguage();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestionResult[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every new keystroke's request — a slow early response landing
  // AFTER a newer one would otherwise flash stale suggestions for a query
  // the student has already changed.
  const requestTokenRef = useRef(0);

  // "/" focuses the search bar from anywhere on the page — a common,
  // discoverable shortcut (GitHub, Linear, Slack...). Never hijacks "/"
  // while the student is already typing in ANY input/textarea/contenteditable,
  // so it can never interrupt a real course title, a note, or a chat message.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Debounced live preview — real /api/search hits only, capped to a
  // handful, never a canned/static suggestion list.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setSuggestions(null);
      setSuggestLoading(false);
      return;
    }
    const token = ++requestTokenRef.current;
    setSuggestLoading(true);
    debounceRef.current = setTimeout(() => {
      fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      })
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((body: { results?: SuggestionResult[] }) => {
          if (token !== requestTokenRef.current) return;
          setSuggestions((body.results ?? []).slice(0, MAX_SUGGESTIONS));
        })
        .catch(() => {
          if (token !== requestTokenRef.current) return;
          setSuggestions(null);
        })
        .finally(() => {
          if (token === requestTokenRef.current) setSuggestLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Dismiss the dropdown on an outside click/tap — same convention as every
  // other dropdown in this app.
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setIsFocused(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function goToFullResults() {
    if (!query.trim()) return;
    setIsFocused(false);
    router.push(`/dashboard/search?q=${encodeURIComponent(query.trim())}`);
  }

  const showDropdown = isFocused && query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div ref={containerRef} className="relative lg:col-span-1">
      {/* Magnetic focus glow — an animated gradient ring that only appears
          while focused, echoing the full search page's own treatment so the
          bar and its destination page read as one continuous feature. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-primary-500/50 via-violet-500/40 to-emerald-500/50 blur-md sm:rounded-3xl"
        initial={false}
        animate={{ opacity: isFocused ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          goToFullResults();
        }}
        className="glass-card relative flex items-center gap-2 rounded-2xl p-3 shadow-glass transition-all duration-300 dark:shadow-glass-dark sm:gap-3 sm:rounded-3xl sm:p-6"
      >
        <motion.span animate={{ rotate: isFocused ? -12 : 0, scale: isFocused ? 1.1 : 1 }} transition={{ duration: 0.25 }}>
          <Search className="h-4 w-4 shrink-0 text-primary-500 dark:text-primary-300" />
        </motion.span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          placeholder={tDashboard("searchPlaceholder", language)}
          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-sm"
        />
        {!isFocused && query.length === 0 && (
          <kbd className="hidden shrink-0 rounded-md border border-border bg-accent/50 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground sm:block">
            /
          </kbd>
        )}
        <button
          type="submit"
          disabled={!query.trim()}
          className="hidden shrink-0 rounded-xl bg-primary-600 px-3 py-2 text-xs font-bold text-white transition-all duration-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:block"
        >
          OK
        </button>
      </form>

      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="glass-card absolute inset-x-0 top-full z-20 mt-2 max-h-80 overflow-y-auto rounded-2xl p-2 shadow-glass dark:shadow-glass-dark"
          >
            {suggestLoading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Recherche...
              </div>
            ) : !suggestions || suggestions.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                Aucun résultat pour l&apos;instant — Entrée pour une recherche complète.
              </p>
            ) : (
              <>
                {suggestions.map((r, i) => (
                  <Link
                    key={`${r.courseId}-${r.sectionLabel}-${i}`}
                    href={`/dashboard/module/${r.moduleId}`}
                    onClick={() => setIsFocused(false)}
                    className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-accent"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{r.courseTitle}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.moduleName ? `${r.moduleName} · ` : ""}
                        {r.sectionLabel}
                      </p>
                    </div>
                  </Link>
                ))}
                <button
                  type="button"
                  onClick={goToFullResults}
                  className="mt-1 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-t border-border px-3 py-2 text-xs font-bold text-primary-600 transition-colors hover:bg-accent dark:text-primary-400"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Voir tous les résultats
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
