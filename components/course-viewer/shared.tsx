"use client";

import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";

/**
 * Building blocks shared by the course viewer's renderers. Deliberately
 * self-contained (no imports from components/ui or hooks/) so restyling or
 * refactoring the rest of the app can't change the viewer's behavior.
 */

/** Same contract as hooks/useMediaQuery, kept local so the viewer has no app-level dependencies. `false` until mounted. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** Centered status line on the dark stage, with an optional download percentage. */
export function ViewerStatus({ label, progress }: { label: string; progress?: number | null }) {
  return (
    <div className="flex h-full min-h-[50vh] w-full flex-col items-center justify-center gap-3 px-6 text-center" role="status">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/70" aria-hidden />
      <p className="text-sm text-neutral-300">{label}</p>
      {typeof progress === "number" && (
        <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div className="h-full rounded-full bg-white/60 transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/** The server-extracted plain text of a course: the pasted-text view, and the fallback whenever the real file can't be rendered. */
export function ExtractedTextView({ rawText, notice, fileUrl }: { rawText: string; notice?: string; fileUrl?: string | null }) {
  return (
    <div className="h-full w-full overflow-y-auto overscroll-contain bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-3xl px-5 py-6 sm:px-10 sm:py-10">
        {notice && (
          <div className="mb-6 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200">
            <p>{notice}</p>
            {fileUrl && (
              <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-semibold underline underline-offset-2">
                Ouvrir le fichier original
              </a>
            )}
          </div>
        )}
        {rawText.trim() ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-7">{rawText}</pre>
        ) : (
          <p className="py-16 text-center text-sm text-neutral-500">Aucun contenu disponible pour ce cours.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Contains any render-time crash of a renderer (react-pdf, pptx-renderer)
 * inside the viewer: the student gets the extracted text instead of the whole
 * course page being replaced by Next's "Application error" screen.
 */
export class ViewerErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[course-viewer] Le lecteur a planté, affichage du texte extrait:", error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
