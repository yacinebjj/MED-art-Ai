"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Search, Loader2, FileText, BookOpen, Sparkles, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import { tDiscovery } from "@/lib/translations/discovery";

/**
 * Full-page results view for the semantic search (see app/api/search/route.ts).
 * Lives as a sibling of app/dashboard/(shell) — a full-screen surface outside
 * the dashboard shell, with its own header, same pattern established across
 * this app for dedicated workspace pages.
 */

interface SearchResult {
  courseSlug: string;
  courseTitle: string;
  moduleName: string | null;
  sectionLabel: string;
  excerpt: string;
  similarity: number;
}

const RESULTS_GROUP_VARIANTS = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const RESULT_ITEM_VARIANTS = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

export default function SearchPage() {
  const { language } = useLanguage();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "La recherche a échoué.");
      setResults(body.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "La recherche a échoué.");
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  // Auto-run once if the page was opened with a prefilled ?q= (from the
  // Dashboard's compact search bar) — subsequent searches are user-triggered.
  useEffect(() => {
    const initialQuery = searchParams.get("q");
    if (initialQuery?.trim()) runSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = results?.reduce<Record<string, SearchResult[]>>((acc, r) => {
    const key = r.moduleName ?? tDiscovery("noModuleGroup", language);
    (acc[key] ??= []).push(r);
    return acc;
  }, {});

  // Never searched yet (fresh page load, no ?q=) — show a friendly guide
  // instead of a blank canvas under the search bar.
  const showGuide = !error && !loading && results === null;

  return (
    <div className="aurora-canvas-bg relative min-h-screen">
      <div aria-hidden className="aurora-mesh-bg animate-mesh-pulse pointer-events-none fixed inset-0 -z-10" />

      <div className="relative mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-gray-600 transition-all duration-300 hover:-translate-x-0.5 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 sm:mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour au Dashboard
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-gray-100 sm:text-3xl">
            Recherche dans mes cours
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-gray-400">
            Recherche sémantique — trouve un concept même s'il n'est pas formulé avec les mêmes mots dans le cours.
          </p>
        </motion.div>

        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(query);
          }}
          className="relative mt-6 sm:mt-8"
        >
          <div aria-hidden className="pointer-events-none absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-primary-500/40 via-violet-500/30 to-primary-500/40 blur-md" />
          <div className="glass-panel relative flex w-full max-w-full items-center gap-2 overflow-hidden rounded-2xl p-2 pl-4 shadow-glass transition-all duration-300 focus-within:-translate-y-0.5 dark:shadow-glass-dark sm:gap-3 sm:pl-5">
            <Search className="h-5 w-5 shrink-0 text-primary-500 dark:text-primary-300" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tDiscovery("searchPlaceholder", language)}
              className="min-w-0 flex-1 bg-transparent py-3 text-base text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-500 sm:text-sm"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              aria-label={tDiscovery("searchAriaLabel", language)}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-primary-500 to-violet-500 px-4 py-3 text-sm font-bold text-white shadow-glow transition-all duration-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Search className="h-4 w-4 sm:hidden" />
                  <span className="hidden sm:inline">{tDiscovery("searchButton", language)}</span>
                </>
              )}
            </button>
          </div>
        </motion.form>

        <div className="mt-8 sm:mt-10">
          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="glass-card flex items-start gap-2.5 rounded-2xl border border-rose-200/60 p-4 text-sm text-rose-700 shadow-glass dark:border-rose-900/40 dark:text-rose-300 dark:shadow-glass-dark"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}

            {loading && (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="glass-card h-20 animate-pulse rounded-2xl shadow-glass dark:shadow-glass-dark" />
                ))}
              </motion.div>
            )}

            {!loading && !error && results !== null && results.length === 0 && (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="glass-card flex flex-col items-center gap-3 rounded-2xl border-dashed p-8 text-center shadow-glass dark:shadow-glass-dark sm:p-10"
              >
                <Search className="h-7 w-7 text-slate-300 dark:text-neutral-700" />
                <p className="max-w-sm text-sm text-slate-500 dark:text-gray-400">
                  Aucun résultat pour « {query} ». Essaie une autre formulation, ou vérifie que tu as bien des cours avec du contenu généré.
                </p>
              </motion.div>
            )}

            {showGuide && (
              <motion.div
                key="guide"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="glass-card flex flex-col items-center gap-3 rounded-2xl border-dashed p-8 text-center shadow-glass dark:shadow-glass-dark sm:p-10"
              >
                <span className="flex h-12 w-12 animate-float items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-violet-500 text-white shadow-glow">
                  <Sparkles className="h-5 w-5" />
                </span>
                <p className="max-w-sm text-sm text-slate-500 dark:text-gray-400">
                  Lance une recherche pour explorer instantanément tous tes cours générés, même avec des mots différents de ceux du texte original.
                </p>
              </motion.div>
            )}

            {!loading && grouped && Object.keys(grouped).length > 0 && (
              <motion.div key="results" initial="hidden" animate="show" variants={RESULTS_GROUP_VARIANTS} className="space-y-8">
                {Object.entries(grouped).map(([moduleName, moduleResults]) => (
                  <div key={moduleName}>
                    <div className="mb-3 flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-primary-500 dark:text-primary-400" />
                      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                        {moduleName}
                      </h2>
                    </div>
                    <div className="space-y-3">
                      {moduleResults.map((r, i) => (
                        <motion.div key={`${r.courseSlug}-${r.sectionLabel}-${i}`} variants={RESULT_ITEM_VARIANTS}>
                          {/* Was a Link to /dashboard/demo/${slug} — that page (the
                              retired "cours indépendant" pipeline) no longer exists.
                              Rendered inert rather than left pointing at a 404;
                              the underlying `courses`-table search index itself is
                              untouched here — a real follow-up, not done in this
                              pass. */}
                          <div
                            className={cn(
                              "glass-card block rounded-2xl p-4 shadow-glass",
                              "opacity-70"
                            )}
                          >
                            <div className="mb-1 flex items-center gap-2">
                              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900 dark:text-gray-100">{r.courseTitle}</p>
                              <span className="ml-auto shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
                                {r.sectionLabel}
                              </span>
                            </div>
                            <p dir="auto" className="line-clamp-2 text-sm text-slate-600 dark:text-gray-400">
                              {r.excerpt}
                            </p>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
