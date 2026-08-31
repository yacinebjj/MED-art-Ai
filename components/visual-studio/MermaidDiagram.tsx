"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

let mermaidInitialized = false;
let lastTheme: boolean | null = null;

/**
 * Renders a Mermaid graph definition to SVG and injects it into the DOM.
 * Mermaid is dynamically imported inside the effect (never at module scope)
 * so none of its browser-only (document/window) code ever runs during SSR.
 */
export function MermaidDiagram({ id, chart, dark = true }: { id: string; chart: string; dark?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      setError(null);
      setIsLoading(true);

      try {
        const { default: mermaid } = await import("mermaid");

        // Re-initialize whenever the requested theme differs from the last
        // render — mermaidInitialized used to be a one-time latch (fine when
        // this component had exactly zero callers), but a real caller can now
        // render both a light- and a dark-mode instance across the app's
        // lifetime, and mermaid.initialize() is what actually applies the
        // theme for every subsequent .render() call.
        if (!mermaidInitialized || lastTheme !== dark) {
          mermaid.initialize({
            startOnLoad: false,
            theme: dark ? "dark" : "default",
            // Let the diagram sit on whatever surface it's dropped onto
            // (a dark stage panel or an always-light slide card) instead of
            // painting its own opaque page-background rectangle — a mismatched
            // background is the classic "illegible in dark mode" failure mode.
            themeVariables: { background: "transparent" },
            securityLevel: "loose",
            fontFamily: "inherit",
          });
          mermaidInitialized = true;
          lastTheme = dark;
        }

        const { svg } = await mermaid.render(`mermaid-${id}`, chart);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setIsLoading(false);
        }
      } catch (err) {
        // Covers failures anywhere in the pipeline (dynamic import, init, or
        // render) — previously only mermaid.render() itself was guarded, so
        // an import/init failure surfaced as an unhandled rejection with no
        // feedback for the viewer at all.
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erreur de rendu du diagramme.");
          setIsLoading(false);
        }
      }
    }

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [id, chart, dark]);

  if (error) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl p-6 text-center text-sm",
          dark ? "bg-rose-500/10 text-rose-300" : "bg-rose-50 text-rose-600"
        )}
      >
        <AlertTriangle className="h-5 w-5" />
        <p>Impossible d&apos;afficher le diagramme : {error}</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {isLoading && (
        <Loader2
          className={cn(
            "absolute h-6 w-6 animate-spin",
            dark ? "text-slate-400" : "text-slate-300"
          )}
        />
      )}
      <div
        ref={containerRef}
        className={cn(
          "mermaid-diagram-wrapper flex h-full w-full items-center justify-center transition-opacity duration-300 [&_svg]:max-h-full [&_svg]:max-w-full",
          isLoading ? "opacity-0" : "animate-fade-in opacity-100"
        )}
      />
    </div>
  );
}
