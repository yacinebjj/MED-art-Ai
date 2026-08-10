"use client";

import { useEffect, useRef, useState } from "react";

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

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      setError(null);
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
          securityLevel: "loose",
          fontFamily: "inherit",
        });
        mermaidInitialized = true;
        lastTheme = dark;
      }

      try {
        const { svg } = await mermaid.render(`mermaid-${id}`, chart);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erreur de rendu du diagramme.");
        }
      }
    }

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [id, chart]);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-rose-400">
        Impossible d&apos;afficher le diagramme : {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-diagram-wrapper flex h-full w-full items-center justify-center [&_svg]:max-h-full [&_svg]:max-w-full"
    />
  );
}
