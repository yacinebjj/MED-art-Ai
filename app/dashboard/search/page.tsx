"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Search, Loader2, FileText, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Full-page results view for the semantic search (see app/api/search/route.ts).
 * Lives as a sibling of app/dashboard/(shell) and app/dashboard/modules/anatomie
 * — a full-screen surface outside the dashboard shell, with its own header,
 * same pattern established across this app for dedicated workspace pages.
 */

interface SearchResult {
  courseSlug: string;
  courseTitle: string;
  moduleName: string | null;
  sectionLabel: string;
  excerpt: string;
  similarity: number;
}

export default function SearchPage() {
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
    const key = r.moduleName ?? "Sans module";
    (acc[key] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link
          href="/dashboard"
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour au Dashboard
        </Link>

        <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-gray-100">
          Recherche dans mes cours
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-gray-400">
          Recherche sémantique — trouve un concept même s'il n'est pas formulé avec les mêmes mots dans le cours.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(query);
          }}
          className="relative mt-8"
        >
          <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-blue-600/40 via-cyan-500/30 to-blue-600/40 blur-md" />
          <div className="relative flex items-center gap-3 rounded-2xl border border-blue-500/40 bg-slate-900/80 p-2 pl-5 shadow-[0_0_25px_rgba(37,99,235,0.2)] backdrop-blur-2xl transition-all duration-300 focus-within:border-blue-400/70 focus-within:shadow-[0_0_35px_rgba(37,99,235,0.35)]">
            <Search className="h-5 w-5 shrink-0 text-blue-300" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ex : structure mitochondriale, signes de l'appendicite..."
              className="flex-1 bg-transparent py-3 text-sm text-white outline-none placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 px-5 py-3 text-sm font-bold text-white shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rechercher"}
            </button>
          </div>
        </form>

        <div className="mt-10">
          {error && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
              {error}
            </p>
          )}

          {!error && results !== null && results.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-gray-400">
              Aucun résultat pour « {query} ». Essaie une autre formulation, ou vérifie que tu as bien des cours avec du contenu généré.
            </p>
          )}

          {grouped && Object.keys(grouped).length > 0 && (
            <div className="space-y-8">
              {Object.entries(grouped).map(([moduleName, moduleResults]) => (
                <div key={moduleName}>
                  <div className="mb-3 flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-blue-500" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                      {moduleName}
                    </h2>
                  </div>
                  <div className="space-y-3">
                    {moduleResults.map((r, i) => (
                      <Link
                        key={`${r.courseSlug}-${r.sectionLabel}-${i}`}
                        href={`/dashboard/demo/${r.courseSlug}`}
                        className={cn(
                          "block rounded-2xl border border-blue-300/60 bg-white p-4 shadow-sm transition-all duration-300",
                          "hover:border-blue-500 hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]",
                          "dark:border-blue-500/30 dark:bg-slate-950 dark:hover:border-blue-400 dark:hover:shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                        )}
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <p className="truncate text-sm font-bold text-slate-900 dark:text-gray-100">{r.courseTitle}</p>
                          <span className="ml-auto shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            {r.sectionLabel}
                          </span>
                        </div>
                        <p dir="auto" className="line-clamp-2 text-sm text-slate-600 dark:text-gray-400">
                          {r.excerpt}
                        </p>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
