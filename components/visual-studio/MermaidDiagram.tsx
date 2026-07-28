"use client";

import { useEffect, useRef, useState } from "react";

let mermaidInitialized = false;

/**
 * Renders a Mermaid graph definition to SVG and injects it into the DOM.
 * Mermaid is dynamically imported inside the effect (never at module scope)
 * so none of its browser-only (document/window) code ever runs during SSR.
 */
export function MermaidDiagram({ id, chart }: { id: string; chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      setError(null);
      const { default: mermaid } = await import("mermaid");

      if (!mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
          fontFamily: "inherit",
        });
        mermaidInitialized = true;
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
