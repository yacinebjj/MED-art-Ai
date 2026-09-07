"use client";

import { Caveat, Kalam } from "next/font/google";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MindMapCartoonIcon } from "./MindMapCartoonIcon";

const kalam = Kalam({ subsets: ["latin"], weight: ["400", "700"] });
const caveat = Caveat({ subsets: ["latin"], weight: ["400", "700"] });

export interface MindMapNode {
  id: string;
  label: string;
  type: "symptome" | "mecanisme" | "diagnostic" | "examen" | "traitement";
  icon: string;
  detail?: string;
}
interface MindMapLink {
  source: string;
  target: string;
  label?: string;
}

export interface DynamicMindMapData {
  nodes: MindMapNode[];
  links: MindMapLink[];
  /** Present only if the real Ideogram call (app/api/studio/generate/route.ts) succeeded — fails open, so this is null on any Ideogram error, never a reason to hide the rest of the board. */
  ideogramImageUrl: string | null;
}

/**
 * Golden Standard Mind Map — v17, "Texte intégral, grand format" (same
 * exceptional partial unlock as v9-v16 — see ARCHITECTURE_LOCKED.md).
 *
 * v16's leaf boxes were a FIXED height with a 2-line clamp — real detail
 * sentences (10-16 words) routinely need more than 2 lines at readable font
 * sizes, so they were getting cut off with "...". Fixed at the root: every
 * leaf's box HEIGHT is now computed from its OWN actual text (see
 * estimateLineCount/sideLeafHeight/stackedLeafHeight below) instead of a
 * shared constant, and no clamp/ellipsis is applied anywhere — the full
 * label and detail always render.
 *
 * Because SVG <foreignObject> needs an explicit height (unlike a normal
 * HTML element, it does not auto-grow to fit its content), "let the box
 * adapt to content" has to mean computing that height ourselves, then
 * laying leaves out from those real per-leaf sizes instead of a fixed
 * spacing constant:
 *  - Side (VSTACK) branches stack their leaves in a CUMULATIVE vertical
 *    column (each leaf's real height, plus a gap, centered on the branch
 *    anchor) — since several leaves share one x-column, their heights
 *    directly affect each other's position.
 *  - Stacked (HSTACK) branches keep a fixed horizontal spacing between
 *    leaves (their box width never changes) and let each leaf grow
 *    independently AWAY from the branch anchor — the edge nearest the
 *    anchor/pill is always fixed, so one long leaf never pushes its
 *    neighbors around.
 * The whole canvas also grew (2100x1400, was 1600x900) and the container
 * dropped its strict 16:9 lock for a plain generous fixed height — the
 * client explicitly authorized this ("passe en plein écran si la
 * résolution fixe bride l'affichage") once legibility became priority 1.
 */

const VB_W = 2100;
const VB_H = 1400;
const CENTER = { x: VB_W / 2, y: VB_H / 2 };
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const BRANCH_RX = 520;
// 340, not 280: with full unclamped text, a single tall leaf on one VSTACK
// branch can reach far enough that it collides with an ANGULARLY ADJACENT
// (not just mirror-paired) VSTACK branch's own stack — confirmed for real
// between mecanisme-late and examen (51.43° apart, both side-stacking).
const BRANCH_RY = 340;
const HUB_RX = 200;
const HUB_RY = 105;
const PILL_W = 270;
const PILL_H = 68;
const LEAF_BOX_W = 300;
// Capped at 2 per branch: with FULL, unclamped text, an unbounded leaf count
// would make branches arbitrarily tall/wide. The "+N" badge + modal is the
// safety valve — nothing is ever lost, just folded away past 2 visible leaves.
const VSTACK_CAP = 2;
const HSTACK_CAP = 2;

interface BranchConfig {
  key: string;
  types: MindMapNode["type"][];
  title: string;
  color: string;
  tint: string;
  icon: string;
  angle: number; // degrees, 0 = east, 90 = south (SVG y grows downward)
  select?: (nodes: MindMapNode[]) => MindMapNode[];
  /** Overrides HSTACK_CAP/VSTACK_CAP for this branch specifically. */
  leafCap?: number;
}

// 7 branches, evenly spaced 360/7 ≈ 51.43° apart, starting at the top.
// diagnostic-alert (64.29°) and symptome (115.71°) are the one HSTACK-adjacent-to-HSTACK
// pair (both spread leaves horizontally, only 51.43° apart, mirrored toward each other) —
// with full, unclamped, wide (300px) text this pair genuinely collides at cap 2 (confirmed
// for real), so both are pinned to leafCap: 1. mecanisme-early keeps the default HSTACK_CAP
// (2, needed to show its causal-chain arrow) since its own neighbors are VSTACK, not HSTACK.
const BRANCHES: BranchConfig[] = [
  { key: "mecanisme-early", types: ["mecanisme"], title: "Mécanismes", color: "#6D28D9", tint: "#F1E9FB", icon: "activity", angle: -90, select: (n) => n.slice(0, Math.ceil(n.length / 2)) },
  { key: "mecanisme-late", types: ["mecanisme"], title: "Dynamique & Complications", color: "#B91C1C", tint: "#FCE8E8", icon: "zap", angle: -38.57, select: (n) => n.slice(Math.ceil(n.length / 2)) },
  { key: "examen", types: ["examen"], title: "Examens & Imagerie", color: "#1D4ED8", tint: "#E7EEFC", icon: "microscope", angle: 12.86 },
  { key: "diagnostic-alert", types: ["diagnostic"], title: "Signes de Gravité", color: "#9333EA", tint: "#F3E8FD", icon: "siren", angle: 64.29, select: (n) => n.slice(1), leafCap: 1 },
  { key: "symptome", types: ["symptome"], title: "Signes & Symptômes", color: "#92400E", tint: "#F8ECDD", icon: "thermometer", angle: 115.71, leafCap: 1 },
  { key: "diagnostic-primary", types: ["diagnostic"], title: "Diagnostic", color: "#15803D", tint: "#E4F3E9", icon: "check-circle-2", angle: 167.14, select: (n) => n.slice(0, 1) },
  { key: "traitement", types: ["traitement"], title: "Prise en Charge", color: "#CA8A04", tint: "#FBF3D8", icon: "pill", angle: -141.43 },
];

function ellipsePoint(cx: number, cy: number, rx: number, ry: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) };
}

/** Rough (deliberately generous) estimate of how many lines `text` will wrap to at `fontSizePx` inside a `boxWidthPx`-wide box — used only to size a <foreignObject>, which (unlike a plain HTML element) needs an explicit height up front. Errs toward OVERestimating (a bit of extra blank space) rather than under (real clipping), since Caveat/Kalam are script fonts without exact metrics available here. */
function estimateLineCount(text: string, boxWidthPx: number, fontSizePx: number): number {
  if (!text) return 0;
  const avgCharWidth = fontSizePx * 0.62;
  const charsPerLine = Math.max(8, Math.floor(boxWidthPx / avgCharWidth));
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

/** Full box height for a SideLeaf (icon column + text column side by side) given its own real label/detail text — never a fixed constant, so nothing is ever clamped. */
function sideLeafHeight(node: MindMapNode, boxW: number): number {
  const iconColW = 64;
  const textColW = boxW - iconColW;
  const labelLines = estimateLineCount(node.label, textColW, 18);
  const detailLines = node.detail ? estimateLineCount(node.detail, textColW, 14) : 0;
  const labelH = labelLines * 18 * 1.25;
  const detailH = detailLines > 0 ? 6 + detailLines * 14 * 1.35 : 0;
  return Math.max(52, labelH + detailH) + 14;
}

/** Full box height for a StackedLeaf (icon on top, text below) given its own real label/detail text. */
function stackedLeafHeight(node: MindMapNode, boxW: number): number {
  const textW = boxW - 16;
  const labelLines = estimateLineCount(node.label, textW, 18);
  const detailLines = node.detail ? estimateLineCount(node.detail, textW, 14) : 0;
  const labelH = labelLines * 18 * 1.25;
  const detailH = detailLines > 0 ? 6 + detailLines * 14 * 1.35 : 0;
  return 52 + 8 + labelH + detailH + 14;
}

/** A gently bowed quadratic bezier between two points — used for the (thin, directional) mécanisme cascade arrows, where a constant-width stroke plus an arrowhead marker is the right tool. */
function bowedPath(x1: number, y1: number, x2: number, y2: number, bow: number) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return `M ${x1} ${y1} Q ${mx + nx * bow} ${my + ny * bow} ${x2} ${y2}`;
}

/** A filled, organically tapered ribbon along the same bowed quadratic curve as bowedPath — wide near w1, narrowing to w2 — used for the structural hub->branch and branch->leaf connectors so their thickness flows the way a hand-drawn branch would, instead of a constant-width stroke. */
function taperedRibbonPath(x1: number, y1: number, x2: number, y2: number, bow: number, w1: number, w2: number, steps = 14): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = mx + nx * bow;
  const cy = my + ny * bow;

  const top: { x: number; y: number }[] = [];
  const bottom: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const px = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
    const py = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
    const tdx = 2 * mt * (cx - x1) + 2 * t * (x2 - cx);
    const tdy = 2 * mt * (cy - y1) + 2 * t * (y2 - cy);
    const tlen = Math.hypot(tdx, tdy) || 1;
    const pnx = -tdy / tlen;
    const pny = tdx / tlen;
    const halfW = (w1 + (w2 - w1) * t) / 2;
    top.push({ x: px + pnx * halfW, y: py + pny * halfW });
    bottom.push({ x: px - pnx * halfW, y: py - pny * halfW });
  }
  const topD = top.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ");
  const bottomD = bottom
    .slice()
    .reverse()
    .map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" L ");
  return `M ${topD} L ${bottomD} Z`;
}

/** Embeds ordinary React/DOM content (real, readable text — never rasterized) inside the SVG coordinate space. */
function Html({ x, y, width, height, className, children }: { x: number; y: number; width: number; height: number; className?: string; children: React.ReactNode }) {
  return (
    <foreignObject x={x} y={y} width={width} height={height}>
      <div className={cn("h-full w-full", className)}>{children}</div>
    </foreignObject>
  );
}

/** A leaf on a diagonal ("vertical-stack") branch: a cartoon icon + bold label + FULL detail text (never truncated), floating with no box, sized exactly to its own content by the caller. */
function SideLeaf({ x, y, width, height, side, color, node }: { x: number; y: number; width: number; height: number; side: "left" | "right"; color: string; node: MindMapNode }) {
  return (
    <Html x={x} y={y} width={width} height={height}>
      <div className={cn("flex h-full items-start gap-2 py-1", side === "left" ? "flex-row-reverse justify-start text-right" : "flex-row justify-start text-left")}>
        <span
          className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full"
          style={{ background: `radial-gradient(circle, ${color}22 0%, transparent 70%)` }}
        >
          <MindMapCartoonIcon name={node.icon} color={color} size={34} />
        </span>
        <div className="min-w-0 flex-1">
          <p dir="auto" className={cn("text-[18px] font-bold leading-[1.2]", caveat.className)} style={{ color }}>
            {node.label}
          </p>
          {node.detail && <p dir="auto" className="mt-0.5 text-[14px] font-medium leading-snug text-[#5B5346]">{node.detail}</p>}
        </div>
      </div>
    </Html>
  );
}

/** A leaf on a top/bottom ("horizontal-stack") branch: a tilted cartoon-icon sticker with a bold centered label and FULL detail text below, sized exactly to its own content by the caller. */
function StackedLeaf({ x, y, width, height, color, tint, node, tilt }: { x: number; y: number; width: number; height: number; color: string; tint: string; node: MindMapNode; tilt: number }) {
  return (
    <Html x={x} y={y} width={width} height={height}>
      <div className="flex h-full w-full flex-col items-center justify-start gap-1 text-center">
        <div
          className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full"
          style={{
            background: `linear-gradient(135deg, #FFFFFF 0%, ${tint} 100%)`,
            boxShadow: `0 5px 12px ${color}30, 0 1px 0 #FFFFFF inset`,
            transform: `rotate(${tilt}deg)`,
          }}
        >
          <span style={{ transform: `rotate(${-tilt}deg)` }}>
            <MindMapCartoonIcon name={node.icon} color={color} size={34} />
          </span>
        </div>
        <p dir="auto" className={cn("px-1 text-[18px] font-bold leading-[1.2]", caveat.className)} style={{ color }}>
          {node.label}
        </p>
        {node.detail && <p dir="auto" className="px-1 text-[14px] font-medium leading-snug text-[#5B5346]">{node.detail}</p>}
      </div>
    </Html>
  );
}

/** Deterministic tiny tilt per node id — never Math.random() (would mismatch between server/client render and re-roll on every zoom/pan re-render). */
function stickerTilt(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(hash) % 13) - 6; // -6..+6 degrees
}

export function DynamicMindMapStudio({ data, title }: { data: DynamicMindMapData; dark?: boolean; title?: string }) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(new Set());
  const [modalBranchKey, setModalBranchKey] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);

  function toggleCollapse(key: string) {
    setCollapsedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const grouped = useMemo(() => {
    const map = new Map<MindMapNode["type"], MindMapNode[]>();
    for (const node of data.nodes) {
      if (!map.has(node.type)) map.set(node.type, []);
      map.get(node.type)!.push(node);
    }
    return map;
  }, [data.nodes]);

  function clampScale(value: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
  }
  function zoomBy(delta: number) {
    setScale((s) => clampScale(Number((s + delta).toFixed(2))));
  }
  function resetView() {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    zoomBy(e.deltaY > 0 ? -0.1 : 0.1);
  }
  function onMouseDown(e: React.MouseEvent) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const { startX, startY, startPanX, startPanY } = dragRef.current;
    setPan({ x: startPanX + (e.clientX - startX), y: startPanY + (e.clientY - startY) });
  }
  function endDrag() {
    dragRef.current = null;
  }

  const branches = useMemo(() => {
    return BRANCHES.map((cfg) => {
      const allOfType = cfg.types.flatMap((t) => grouped.get(t) ?? []);
      const pool = cfg.select ? cfg.select(allOfType) : allOfType;
      const isVertical = Math.abs(Math.cos((cfg.angle * Math.PI) / 180)) <= Math.abs(Math.sin((cfg.angle * Math.PI) / 180));
      const cap = cfg.leafCap ?? (isVertical ? HSTACK_CAP : VSTACK_CAP);
      const leaves = pool.slice(0, cap);
      const hidden = Math.max(0, pool.length - leaves.length);
      const anchor = ellipsePoint(CENTER.x, CENTER.y, BRANCH_RX, BRANCH_RY, cfg.angle);
      const side: "left" | "right" = anchor.x < CENTER.x ? "left" : "right";

      let leafPositions: { node: MindMapNode; x: number; y: number; width: number; height: number }[];
      if (isVertical) {
        // HSTACK (top/bottom branches): fixed box width means fixed horizontal spacing never self-overlaps.
        // Each leaf grows independently AWAY from the anchor — the edge NEAREST the anchor/pill stays fixed
        // regardless of how tall any one leaf's text makes it, so one long leaf never pushes its neighbors.
        const sign = cfg.angle === -90 ? -1 : 1;
        leafPositions = leaves.map((node, i) => {
          const h = stackedLeafHeight(node, LEAF_BOX_W);
          const cx = anchor.x + (i - (leaves.length - 1) / 2) * 360;
          const topY = sign === -1 ? anchor.y - 110 - h : anchor.y + 110;
          return { node, x: cx - LEAF_BOX_W / 2, y: topY, width: LEAF_BOX_W, height: h };
        });
      } else {
        // VSTACK (side branches): several leaves share one x-column, so they're stacked CUMULATIVELY —
        // each leaf's real height (from its own text) directly determines where the next one starts.
        const heights = leaves.map((node) => sideLeafHeight(node, LEAF_BOX_W));
        const gap = 20;
        const totalH = heights.reduce((a, b) => a + b, 0) + gap * Math.max(0, leaves.length - 1);
        let cursorY = anchor.y - totalH / 2;
        const boxX = side === "right" ? anchor.x + 200 : anchor.x - 200 - LEAF_BOX_W;
        leafPositions = leaves.map((node, i) => {
          const h = heights[i];
          const topY = cursorY;
          cursorY += h + gap;
          return { node, x: boxX, y: topY, width: LEAF_BOX_W, height: h };
        });
      }

      return { ...cfg, pool, leaves, hidden, isVertical, anchor, side, leafPositions };
    }).filter((b) => b.leaves.length > 0);
  }, [grouped]);

  /** Where a branch->leaf ribbon should terminate: the edge of the leaf's box nearest the branch anchor/pill — stable regardless of the leaf's actual (variable) height. */
  function ribbonTarget(branch: (typeof branches)[number], leaf: (typeof branches)[number]["leafPositions"][number]) {
    if (branch.isVertical) {
      const sign = branch.angle === -90 ? -1 : 1;
      const edgeY = sign === -1 ? leaf.y + leaf.height : leaf.y;
      return { x: leaf.x + leaf.width / 2, y: edgeY };
    }
    const edgeX = branch.side === "left" ? leaf.x + leaf.width : leaf.x;
    return { x: edgeX, y: leaf.y + leaf.height / 2 };
  }

  // Cascade causale du premier tiers des mécanismes — seule chaîne dirigée du poster (les autres connecteurs radiaux relient sans sens de lecture précis). Utilise les vraies étiquettes de "links" quand elles existent. Connecte le HAUT de chaque sticker (où se trouve son icône) — cette branche pousse toujours vers le haut, donc "haut de la boîte" = le point le plus loin du hub, jamais recouvert par le ruban ni par la pastille.
  const mecanismeChain = useMemo(() => {
    const branch = branches.find((b) => b.key === "mecanisme-early");
    if (!branch) return [];
    const linkLabel = new Map<string, string>();
    for (const link of data.links) linkLabel.set(`${link.source}->${link.target}`, link.label ?? "");
    const points = branch.leafPositions.map((leaf) => ({ leaf, x: leaf.x + leaf.width / 2, y: leaf.y }));
    return points.slice(0, -1).map((cur, i) => {
      const next = points[i + 1];
      return { x1: cur.x, y1: cur.y, x2: next.x, y2: next.y, label: linkLabel.get(`${cur.leaf.node.id}->${next.leaf.node.id}`) ?? "" };
    });
  }, [branches, data.links]);

  const tagline = `${data.nodes.length} notions clés · ${branches.length} axes thématiques`;

  return (
    <div className="w-full space-y-3 font-sans animate-fade-in">
      <div className="relative">
        <div className="absolute right-3 top-3 z-10 flex flex-col gap-1 rounded-xl border border-slate-200 bg-white/90 p-1 shadow-md backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
          <button type="button" onClick={() => zoomBy(0.15)} aria-label="Zoomer" className="rounded-lg p-2 text-lg font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            +
          </button>
          <button type="button" onClick={() => zoomBy(-0.15)} aria-label="Dézoomer" className="rounded-lg p-2 text-lg font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            −
          </button>
          <button type="button" onClick={resetView} aria-label="Réinitialiser la vue" className="rounded-lg p-2 text-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            ⟲
          </button>
        </div>

        {/* Grande toile — plus de ratio fixe imposé : la lisibilité prime, la toile prend toute la largeur disponible sur une hauteur généreuse. */}
        <div
          className="h-[900px] w-full cursor-grab select-none overflow-hidden rounded-3xl border border-[#E8E1D3] bg-[#FDFBF7] active:cursor-grabbing"
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          <div
            className="h-full w-full origin-center"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transition: dragRef.current ? "none" : "transform 100ms ease-out" }}
          >
            <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
              <defs>
                <clipPath id="mm-hub-clip">
                  <ellipse cx={CENTER.x} cy={CENTER.y} rx={HUB_RX - 8} ry={HUB_RY - 8} />
                </clipPath>
                <marker id="mm-chain-arrow" markerWidth={8} markerHeight={8} refX={6} refY={4} orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="#6D28D9" />
                </marker>
                <filter id="mm-shadow-soft" x="-60%" y="-60%" width="220%" height="220%">
                  <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#3A2E1F" floodOpacity="0.16" />
                </filter>
                <filter id="mm-shadow-ribbon" x="-60%" y="-60%" width="220%" height="220%">
                  <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#3A2E1F" floodOpacity="0.14" />
                </filter>
                <radialGradient id="mm-hub-gradient" cx="42%" cy="38%" r="75%">
                  <stop offset="0%" stopColor="#FFFFFF" />
                  <stop offset="100%" stopColor="#FBF3E1" />
                </radialGradient>
                {branches.map((branch) => (
                  <linearGradient key={branch.key} id={`mm-grad-${branch.key}`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={branch.color} stopOpacity={0.7} />
                    <stop offset="100%" stopColor={branch.color} stopOpacity={1} />
                  </linearGradient>
                ))}
              </defs>

              {/* Fond blanc cassé/crème, propre, sans grain ni grille. */}
              <rect x={0} y={0} width={VB_W} height={VB_H} fill="#FDFBF7" />

              {/* Halo décoratif Ideogram (sans texte), en douce toile de fond derrière le hub — jamais un bloqueur si absent. */}
              {data.ideogramImageUrl && (
                <g clipPath="url(#mm-hub-clip)" opacity={0.3}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- SVG <image>, not a Next.js <img>; external unpredictable Ideogram CDN host. */}
                  <image href={data.ideogramImageUrl} x={CENTER.x - HUB_RX} y={CENTER.y - HUB_RY} width={HUB_RX * 2} height={HUB_RY * 2} preserveAspectRatio="xMidYMid slice" />
                </g>
              )}

              {/* Branches — ruban épais hub -> pastille de branche, puis rubans plus fins pastille -> chaque feuille. */}
              {branches.map((branch) => {
                const hubEdge = ellipsePoint(CENTER.x, CENTER.y, HUB_RX, HUB_RY, branch.angle);
                const isCollapsed = collapsedBranches.has(branch.key);
                return (
                  <g key={branch.key}>
                    <path
                      d={taperedRibbonPath(hubEdge.x, hubEdge.y, branch.anchor.x, branch.anchor.y, 22, 11, 4.5)}
                      fill={`url(#mm-grad-${branch.key})`}
                      opacity={0.9}
                      filter="url(#mm-shadow-ribbon)"
                    />

                    {!isCollapsed &&
                      branch.leafPositions.map((leaf) => {
                        const target = ribbonTarget(branch, leaf);
                        return (
                          <g key={leaf.node.id}>
                            <path
                              d={taperedRibbonPath(branch.anchor.x, branch.anchor.y, target.x, target.y, branch.isVertical ? 8 : 6, 4.5, 2)}
                              fill={`url(#mm-grad-${branch.key})`}
                              opacity={0.65}
                            />
                            {branch.isVertical ? (
                              <StackedLeaf x={leaf.x} y={leaf.y} width={leaf.width} height={leaf.height} color={branch.color} tint={branch.tint} node={leaf.node} tilt={stickerTilt(leaf.node.id)} />
                            ) : (
                              <SideLeaf x={leaf.x} y={leaf.y} width={leaf.width} height={leaf.height} side={branch.side} color={branch.color} node={leaf.node} />
                            )}
                          </g>
                        );
                      })}

                    {/* Pastille de branche — grande illustration cartoon + titre, cliquable (replie/déplie), badge "+N" séparé (ouvre la liste complète). */}
                    <Html x={branch.anchor.x - PILL_W / 2} y={branch.anchor.y - PILL_H / 2} width={PILL_W} height={PILL_H}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleCollapse(branch.key)}
                        onKeyDown={(e) => e.key === "Enter" && toggleCollapse(branch.key)}
                        className="flex h-full w-full cursor-pointer items-center justify-center gap-2 rounded-full px-3 transition-transform active:scale-[0.97]"
                        style={{
                          background: `linear-gradient(135deg, #FFFFFF 0%, ${branch.tint} 100%)`,
                          border: `2.5px solid ${branch.color}`,
                          boxShadow: `0 5px 14px ${branch.color}2E, 0 1px 0 #FFFFFF inset`,
                          opacity: isCollapsed ? 0.75 : 1,
                        }}
                      >
                        <span
                          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full"
                          style={{ background: `radial-gradient(circle, ${branch.tint} 0%, transparent 72%)` }}
                        >
                          <MindMapCartoonIcon name={branch.icon} color={branch.color} size={30} />
                        </span>
                        <span className={cn("min-w-0 flex-1 text-center text-[15px] font-bold uppercase leading-[1.15] tracking-wide", kalam.className)} style={{ color: branch.color }}>
                          {branch.title}
                        </span>
                        <span className="shrink-0 text-base leading-none" style={{ color: branch.color }}>
                          {isCollapsed ? "▸" : "▾"}
                        </span>
                        {branch.hidden > 0 && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setModalBranchKey(branch.key);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.stopPropagation();
                                setModalBranchKey(branch.key);
                              }
                            }}
                            className="shrink-0 cursor-pointer rounded-full px-2 py-0.5 text-[12px] font-bold underline decoration-dotted"
                            style={{ backgroundColor: branch.color, color: "#FFFFFF" }}
                            aria-label={`Voir les ${branch.hidden} notions supplémentaires de ${branch.title}`}
                          >
                            +{branch.hidden}
                          </span>
                        )}
                      </div>
                    </Html>
                  </g>
                );
              })}

              {/* Cascade causale du premier tiers des mécanismes — seule chaîne dirigée du poster. Connecte le HAUT de chaque sticker (loin du hub, jamais recouvert). */}
              {!collapsedBranches.has("mecanisme-early") && mecanismeChain.map(({ x1, y1, x2, y2, label }, i) => {
                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2 - 40;
                return (
                  <g key={`chain-${i}`}>
                    <path d={bowedPath(x1, y1 - 24, x2, y2 - 24, -10)} fill="none" stroke="#6D28D9" strokeWidth={2.5} strokeLinecap="round" markerEnd="url(#mm-chain-arrow)" opacity={0.75} />
                    {label && (
                      <Html x={midX - 60} y={midY - 12} width={120} height={24}>
                        <p className={cn("text-center text-[12px] italic text-[#6D28D9]", caveat.className)}>{label}</p>
                      </Html>
                    )}
                  </g>
                );
              })}

              {/* Hub central — titre du cours + statistique dérivée des données réelles (zéro texte inventé). Positionné exactement au centre du canevas. */}
              <rect x={CENTER.x - HUB_RX} y={CENTER.y - HUB_RY} width={HUB_RX * 2} height={HUB_RY * 2} rx={30} fill="url(#mm-hub-gradient)" stroke="#241F1A" strokeWidth={3} filter="url(#mm-shadow-soft)" />
              <Html x={CENTER.x - 170} y={CENTER.y - 85} width={340} height={170}>
                <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-3 text-center">
                  <p className={cn("text-[36px] font-bold leading-[1.05] text-[#241F1A]", kalam.className)}>{title ?? "Vue d'ensemble"}</p>
                  <p className={cn("text-[18px] leading-tight text-[#7A6F5C]", caveat.className)}>{tagline}</p>
                </div>
              </Html>
            </svg>
          </div>
        </div>

        {/* Panneau "voir tout" — la liste complète (non plafonnée) des notions d'une branche, y compris celles repliées dans son badge "+N". Recouvre uniquement le canevas (positionné dans le même conteneur "relative"), jamais la structure SVG elle-même. */}
        {modalBranchKey &&
          (() => {
            const branch = branches.find((b) => b.key === modalBranchKey);
            if (!branch) return null;
            return (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-black/40 p-6"
                onClick={() => setModalBranchKey(null)}
              >
                <div
                  className="max-h-[85%] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className={cn("text-[24px] font-bold", kalam.className)} style={{ color: branch.color }}>
                      {branch.title} — {branch.pool.length} notions
                    </h3>
                    <button
                      type="button"
                      onClick={() => setModalBranchKey(null)}
                      aria-label="Fermer"
                      className="rounded-full px-3 py-1 text-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                    >
                      ✕
                    </button>
                  </div>
                  <ul className="space-y-3">
                    {branch.pool.map((node) => (
                      <li key={node.id} className="flex gap-3 border-b border-slate-100 pb-3 last:border-0 dark:border-slate-800">
                        <span className="shrink-0">
                          <MindMapCartoonIcon name={node.icon} color={branch.color} size={32} />
                        </span>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 dark:text-slate-100">{node.label}</p>
                          {node.detail && <p className="text-sm text-slate-600 dark:text-slate-400">{node.detail}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })()}
      </div>

      <p className="text-center text-xs text-slate-400 dark:text-slate-600">
        {data.nodes.length} notions clés — molette pour zoomer, glisser pour naviguer, clique une branche pour la replier.
      </p>
    </div>
  );
}
