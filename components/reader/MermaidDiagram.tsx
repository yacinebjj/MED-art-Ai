"use client";

import { useEffect, useId, useRef, useState } from "react";
import { repairMermaid } from "@/lib/studio-visuals";

/**
 * A ```mermaid block of a Studio Explication (lib/studio-visuals.ts), drawn in
 * the browser — no server, no service, $0. Mermaid itself is a separate chunk,
 * downloaded the first time a lesson actually contains a diagram.
 *
 * Safety: `securityLevel: "strict"` (labels sanitised, no click handlers, no
 * HTML), and a diagram that still fails to parse after repairMermaid simply
 * isn't shown — the lesson's text already explains the mechanism, so the
 * page never shows an error or raw code.
 *
 * Follows the app's theme (the `dark` class on <html>), and is skipped by the
 * reading surface's text index (data-reading-skip): its labels are drawn
 * asynchronously and must never shift the student's highlights.
 */

type MermaidApi = (typeof import("mermaid"))["default"];

let mermaidModule: Promise<MermaidApi> | null = null;
function loadMermaid(): Promise<MermaidApi> {
  mermaidModule ??= import("mermaid").then((module) => module.default);
  return mermaidModule;
}

/** The logo's blues on the reader's own surfaces (hex: Mermaid derives its other shades from them). */
const LIGHT_THEME = {
  primaryColor: "#e0f2fe",
  primaryBorderColor: "#38bdf8",
  primaryTextColor: "#0f172a",
  secondaryColor: "#f0f9ff",
  tertiaryColor: "#ffffff",
  lineColor: "#0284c7",
  edgeLabelBackground: "#ffffff",
  clusterBkg: "#f8fafc",
};

const DARK_THEME = {
  primaryColor: "#0c2d48",
  primaryBorderColor: "#38bdf8",
  primaryTextColor: "#e2e8f0",
  secondaryColor: "#0b1a2e",
  tertiaryColor: "#020617",
  lineColor: "#7dd3fc",
  edgeLabelBackground: "#0b1220",
  clusterBkg: "#0b1220",
};

function pageIsDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

/** The source to draw: the block as written, else its repaired version, else null. */
async function renderableSource(mermaid: MermaidApi, code: string): Promise<string | null> {
  const original = code.trim();
  if (original && (await mermaid.parse(original, { suppressErrors: true }))) return original;
  const repaired = repairMermaid(code);
  if (repaired && repaired !== original && (await mermaid.parse(repaired, { suppressErrors: true }))) return repaired;
  return null;
}

let renderCount = 0;

export function MermaidDiagram({ code }: { code: string }) {
  const reactId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const [dark, setDark] = useState<boolean | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDark(pageIsDark());
    const observer = new MutationObserver(() => setDark(pageIsDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (dark === null) return;
    let cancelled = false;
    const id = `medart-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${++renderCount}`;
    (async () => {
      try {
        const mermaid = await loadMermaid();
        const fontFamily = hostRef.current ? getComputedStyle(hostRef.current).fontFamily : undefined;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily,
          themeVariables: { ...(dark ? DARK_THEME : LIGHT_THEME), ...(fontFamily ? { fontFamily } : {}), fontSize: "15px" },
          flowchart: { curve: "basis", useMaxWidth: true, htmlLabels: true, wrappingWidth: 180 },
        });
        const source = await renderableSource(mermaid, code);
        if (!source) {
          if (process.env.NODE_ENV !== "production") console.warn("[MermaidDiagram] Schéma illisible, non affiché :", code);
          if (!cancelled) setFailed(true);
          return;
        }
        const result = await mermaid.render(id, source);
        if (!cancelled) setSvg(result.svg);
      } catch (error) {
        // Mermaid can leave its scratch element behind when a render throws.
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
        if (process.env.NODE_ENV !== "production") console.warn("[MermaidDiagram] Échec du rendu :", error);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, dark, reactId]);

  if (failed) return null;

  return (
    <div ref={hostRef} data-reading-skip="" className="studio-mermaid not-prose my-[1.5em]">
      {svg ? (
        <div role="img" aria-label="Schéma" className="studio-mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div aria-hidden className="studio-visual-skeleton relative h-[11em]">
          <span className="studio-visual-shimmer" />
        </div>
      )}
    </div>
  );
}
