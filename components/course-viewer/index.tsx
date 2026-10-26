"use client";

/**
 * Course viewer module — "Afficher le cours" (original PDF / PPTX / DOCX).
 *
 * This file is the module's ONLY public entry point: import from
 * "@/components/course-viewer", never from its internal files. Everything
 * the viewer needs lives in this folder (shell, renderers, styles, error
 * handling) and it imports nothing from components/ui or hooks/, so changes
 * elsewhere in the app can't break it. See CourseViewer.tsx for the design.
 *
 * Usage — mount while open, unmount to close (the viewer plays its exit
 * before it calls onClose):
 *   {course && <CourseViewer title={…} fileUrl={…} rawText={…} onClose={() => setCourse(null)} />}
 *
 * The heavy parts (pdf.js, the PPTX engine) are code-split and only download
 * when a file of that type is opened; this entry point itself is tiny.
 */

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { loadWithRetry } from "./load-with-retry";
import type { CourseViewerProps } from "./types";

export type { CourseViewerProps } from "./types";

function loadCourseViewer() {
  return loadWithRetry(() => import("./CourseViewer")).then((m) => m.CourseViewer);
}

/** Starts downloading the viewer shell ahead of time (e.g. when a menu that can open it is shown). Safe to call repeatedly. */
export function preloadCourseViewer(): void {
  void loadCourseViewer().catch(() => {});
}

/**
 * Last resort when even the shell's chunk can't load (typically: the app was
 * redeployed while this tab stayed open, so the old chunk no longer exists).
 * Lives in this always-loaded file and uses no other module code.
 */
function CourseViewerUnavailable({ title, fileUrl, onClose }: CourseViewerProps) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 flex items-center justify-center bg-black/70 p-6" style={{ zIndex: 9995 }}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center text-neutral-900 shadow-2xl dark:bg-neutral-900 dark:text-neutral-100">
        <p className="text-sm">Le lecteur n&apos;a pas pu se charger. L&apos;application a peut-être été mise à jour.</p>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-neutral-900">
            Recharger la page
          </button>
          {fileUrl && (
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium dark:border-neutral-700">
              Ouvrir le fichier
            </a>
          )}
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-neutral-500">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

// Transparent: the backdrop below already darkens the screen.
function CourseViewerLoading() {
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 9995 }} role="status" aria-label="Ouverture du cours">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
    </div>
  );
}

const LazyCourseViewer = dynamic<CourseViewerProps>(() => loadCourseViewer().catch(() => CourseViewerUnavailable), {
  ssr: false,
  loading: CourseViewerLoading,
});

// The viewer's exit (cv-fade-out, course-viewer.css) and the backdrop's.
const EXIT_MS = 220;

/**
 * A dark backdrop fades in at once and stays under the loader and then the
 * viewer, so neither the first frame nor the loader → viewer switch can
 * flash the page behind. Closing plays the exit first; the caller's
 * `onClose` (which unmounts all of this) runs when it has finished.
 */
export function CourseViewer({ onClose, ...props }: CourseViewerProps) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => onCloseRef.current(), EXIT_MS);
  }, []);

  return (
    <>
      <div
        aria-hidden
        data-closing={closing}
        className="fixed inset-0 bg-neutral-900 animate-in fade-in-0 duration-300 data-[closing=true]:pointer-events-none data-[closing=true]:animate-out data-[closing=true]:fade-out-0 data-[closing=true]:duration-200 data-[closing=true]:fill-mode-forwards"
        style={{ zIndex: 9994 }}
      />
      <LazyCourseViewer {...props} onClose={requestClose} closing={closing} />
    </>
  );
}
