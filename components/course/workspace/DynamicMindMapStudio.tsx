"use client";

import { Kalam } from "next/font/google";
import { useMemo, useRef, useState } from "react";
import { ImageOff, Minus, Plus, RotateCcw, Siren, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveLucideIcon } from "@/lib/lucide-icon-lookup";

const kalam = Kalam({ subsets: ["latin"], weight: ["400", "700"] });

interface MindMapNode {
  id: string;
  label: string;
  type: "symptome" | "mecanisme" | "diagnostic" | "examen" | "traitement";
  icon: string;
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
 * Golden Standard Mind Map — v8, "Poster Infographique Vectoriel". v5-v7
 * were plain HTML/CSS divs (rounded pill badges) — judged "still looks like
 * a web dashboard, not a poster". v6 (a single AI-generated image with all
 * text baked in) was tried for real and produced garbled, unreadable
 * output (see git history / lib/ai/studio-prompts.ts's header comment) —
 * that failure mode is specific to asking an IMAGE MODEL to render text.
 * This version fixes the "looks like a dashboard" complaint differently:
 * it's a real, hand-built SVG poster — paper-colored background, a dark
 * title banner in a handwritten display font, zones framed like a printed
 * scientific poster, real <line>/<path> connectors with arrowheads between
 * cascade steps — but the TEXT itself is still ordinary DOM content
 * (rendered via SVG <foreignObject>, a standard technique for mixing real
 * readable text with vector graphics), so nothing here can garble a label.
 * The already-reliable {nodes, links} extraction and per-node icon tagging
 * (lib/ai/studio-prompts.ts) is unchanged; only the renderer is new.
 */

const VB_W = 1440;
const VB_H = 960;
const MIN_SCALE = 0.6;
const MAX_SCALE = 2.5;
const FLOW_CAP = 6;
const PROTOCOL_CAP = 6;
// 3 cols x 2 rows only — a 3rd row would push past fundamentalsZone's bottom edge (measured empirically).
const FUNDAMENTALS_CAP = 6;
const ALERT_CAP = 5;

const ZONE_TONE: Record<"symptome" | "examen" | "diagnostic", { badge: string; icon: string; ring: string }> = {
  symptome: { badge: "#FCE4E4", icon: "#B3261E", ring: "#E8B4B4" },
  examen: { badge: "#DFF3E6", icon: "#1E7A46", ring: "#B7DFC7" },
  diagnostic: { badge: "#DDEBFA", icon: "#1D4ED8", ring: "#AFCBEF" },
};

/** Simple row/col grid layout for a fixed number of items inside a zone rectangle — used for the "fundamentals" icon+label cluster and the treatment protocol grid. Returns null (never crashes) for an out-of-range index; callers just don't render that item. */
function gridPosition(index: number, cols: number, itemW: number, itemH: number, gapX: number, gapY: number, originX: number, originY: number) {
  const row = Math.floor(index / cols);
  const col = index % cols;
  return { x: originX + col * (itemW + gapX), y: originY + row * (itemH + gapY) };
}

/** Embeds ordinary React/DOM content (real, readable text — never rasterized) inside the SVG coordinate space, the standard technique for mixing vector graphics with wrapping text and icons. */
function Html({ x, y, width, height, className, children }: { x: number; y: number; width: number; height: number; className?: string; children: React.ReactNode }) {
  return (
    <foreignObject x={x} y={y} width={width} height={height}>
      <div className={cn("h-full w-full", className)}>{children}</div>
    </foreignObject>
  );
}

function ZoneFrame({ x, y, width, height, label, tone = "#D9C9A3", fill = "#FFFEFB" }: { x: number; y: number; width: number; height: number; label: string; tone?: string; fill?: string }) {
  const bannerW = Math.min(width - 24, label.length * 13 + 60);
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={18} fill={fill} fillOpacity={0.72} stroke={tone} strokeWidth={2} />
      <rect x={x + 16} y={y - 18} width={bannerW} height={36} rx={10} fill="#241F1A" />
      <Html x={x + 16} y={y - 18} width={bannerW} height={36}>
        <div className={cn("flex h-full w-full items-center justify-center px-2 text-[13px] font-bold uppercase tracking-wide text-[#F6EFE2]", kalam.className)}>
          {label}
        </div>
      </Html>
    </g>
  );
}

function IconLabelItem({ x, y, w, h, node, tone }: { x: number; y: number; w: number; h: number; node: MindMapNode; tone: { badge: string; icon: string; ring: string } }) {
  const Icon = resolveLucideIcon(node.icon);
  return (
    <Html x={x} y={y} width={w} height={h}>
      <div className="flex h-full w-full flex-col items-center justify-start gap-1 text-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2" style={{ backgroundColor: tone.badge, borderColor: tone.ring }}>
          <Icon className="h-5 w-5" style={{ color: tone.icon }} />
        </div>
        <p dir="auto" className="px-0.5 text-[10.5px] font-bold leading-tight text-[#3B342A]">
          {node.label}
        </p>
      </div>
    </Html>
  );
}

export function DynamicMindMapStudio({ data, title }: { data: DynamicMindMapData; dark?: boolean; title?: string }) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [imageFailed, setImageFailed] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<MindMapNode["type"], MindMapNode[]>();
    for (const node of data.nodes) {
      if (!map.has(node.type)) map.set(node.type, []);
      map.get(node.type)!.push(node);
    }
    return map;
  }, [data.nodes]);
  function nodesOf(type: MindMapNode["type"]): MindMapNode[] {
    return grouped.get(type) ?? [];
  }

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

  // Same content split as before: primary diagnosis joins the fundamentals cluster, the rest are "complications" for the red alert box.
  const diagnosticNodes = nodesOf("diagnostic");
  const primaryDiagnosis = diagnosticNodes.slice(0, 1);
  const complications = diagnosticNodes.slice(1, 1 + ALERT_CAP);
  const complicationsHidden = Math.max(0, diagnosticNodes.length - 1 - complications.length);

  const fundamentalsAll = [...nodesOf("symptome"), ...nodesOf("examen"), ...primaryDiagnosis];
  const fundamentals = fundamentalsAll.slice(0, FUNDAMENTALS_CAP);
  const fundamentalsHidden = Math.max(0, fundamentalsAll.length - fundamentals.length);

  const mecanismes = nodesOf("mecanisme").slice(0, FLOW_CAP);
  const mecanismesHidden = Math.max(0, nodesOf("mecanisme").length - mecanismes.length);
  const traitements = nodesOf("traitement").slice(0, PROTOCOL_CAP);
  const traitementsHidden = Math.max(0, nodesOf("traitement").length - traitements.length);

  function toneFor(node: MindMapNode) {
    return ZONE_TONE[node.type as "symptome" | "examen" | "diagnostic"] ?? ZONE_TONE.diagnostic;
  }

  // Zone rectangles — fixed layout, computed once, independent of content volume (caps above guarantee no overflow regardless of how much the AI returns).
  const fundamentalsZone = { x: 40, y: 160, w: 470, h: 300 };
  const illustrationZone = { x: 540, y: 160, w: 300, h: 300 };
  const cascadeZone = { x: 40, y: 500, w: 1360, h: 190 };
  const protocolZone = { x: 40, y: 730, w: 660, h: 190 };
  const alertZone = { x: 740, y: 730, w: 660, h: 190 };

  const alertBannerLabel = `Signes de Gravité${complicationsHidden > 0 ? ` (+${complicationsHidden})` : ""}`;
  const alertBannerW = Math.min(alertZone.w - 24, alertBannerLabel.length * 11 + 60);

  const cascadeStepW = 150;
  const cascadeStepGap = mecanismes.length > 1 ? (cascadeZone.w - 60 - cascadeStepW * mecanismes.length) / (mecanismes.length - 1) : 0;

  return (
    <div className="w-full space-y-3 font-sans animate-fade-in">
      <div className="relative">
        <div className="absolute right-3 top-3 z-10 flex flex-col gap-1 rounded-xl border border-slate-200 bg-white/90 p-1 shadow-md backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
          <button type="button" onClick={() => zoomBy(0.15)} aria-label="Zoomer" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => zoomBy(-0.15)} aria-label="Dézoomer" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            <Minus className="h-4 w-4" />
          </button>
          <button type="button" onClick={resetView} aria-label="Réinitialiser la vue" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>

        <div
          className="h-[720px] w-full cursor-grab select-none overflow-hidden rounded-3xl border border-[#D9C9A3] active:cursor-grabbing"
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
                <filter id="mm-grain">
                  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} result="noise" />
                  <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.48  0 0 0 0 0.35  0 0 0 0.035 0" />
                </filter>
                <marker id="mm-arrow" markerWidth={8} markerHeight={8} refX={6} refY={4} orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="#9C7B4E" />
                </marker>
              </defs>

              {/* Paper background — warm parchment, not interface white, with a subtle printed-poster frame and grain texture. */}
              <rect x={0} y={0} width={VB_W} height={VB_H} fill="#FBF3E1" />
              <rect x={0} y={0} width={VB_W} height={VB_H} filter="url(#mm-grain)" />
              <rect x={14} y={14} width={VB_W - 28} height={VB_H - 28} rx={16} fill="none" stroke="#D9C9A3" strokeWidth={3} />

              {/* Title banner, flanked by decorative dashed flourishes — same visual family as the "La Rage" reference. */}
              <line x1={90} y1={62} x2={280} y2={62} stroke="#9C7B4E" strokeWidth={2} strokeDasharray="10 8" markerEnd="url(#mm-arrow)" />
              <line x1={VB_W - 90} y1={62} x2={VB_W - 280} y2={62} stroke="#9C7B4E" strokeWidth={2} strokeDasharray="10 8" markerEnd="url(#mm-arrow)" />
              <rect x={320} y={26} width={VB_W - 640} height={72} rx={14} fill="#241F1A" />
              <Html x={320} y={26} width={VB_W - 640} height={72}>
                <div className={cn("flex h-full w-full items-center justify-center px-4 text-center text-2xl font-bold uppercase tracking-wide text-[#F6EFE2] md:text-3xl", kalam.className)}>
                  {title ?? "Vue d'ensemble"}
                </div>
              </Html>

              {/* Flow connectors between the major zones, reinforcing reading order top -> bottom. */}
              <path d={`M ${fundamentalsZone.x + fundamentalsZone.w / 2} ${fundamentalsZone.y + fundamentalsZone.h} C ${fundamentalsZone.x + fundamentalsZone.w / 2} ${cascadeZone.y - 20}, ${cascadeZone.x + 200} ${cascadeZone.y - 20}, ${cascadeZone.x + 200} ${cascadeZone.y}`} fill="none" stroke="#C7B27E" strokeWidth={2.5} markerEnd="url(#mm-arrow)" />
              <path d={`M ${cascadeZone.x + cascadeZone.w / 2} ${cascadeZone.y + cascadeZone.h} L ${cascadeZone.x + cascadeZone.w / 2} ${protocolZone.y - 4}`} fill="none" stroke="#C7B27E" strokeWidth={2.5} markerEnd="url(#mm-arrow)" />

              {/* Zone 1 — Notions Fondamentales */}
              <ZoneFrame
                x={fundamentalsZone.x}
                y={fundamentalsZone.y}
                width={fundamentalsZone.w}
                height={fundamentalsZone.h}
                label={fundamentalsHidden > 0 ? `Notions Fondamentales (+${fundamentalsHidden})` : "Notions Fondamentales"}
              />
              {fundamentals.map((node, i) => {
                const pos = gridPosition(i, 3, 140, 92, 10, 8, fundamentalsZone.x + 24, fundamentalsZone.y + 24);
                return <IconLabelItem key={node.id} x={pos.x} y={pos.y} w={140} h={88} node={node} tone={toneFor(node)} />;
              })}

              {/* Zone 2 — Illustration Ideogram (accent, texte interdit dans le prompt) */}
              <ZoneFrame x={illustrationZone.x} y={illustrationZone.y} width={illustrationZone.w} height={illustrationZone.h} label="Illustration" tone="#C9AEDD" fill="#FBF7FD" />
              <Html x={illustrationZone.x + 16} y={illustrationZone.y + 16} width={illustrationZone.w - 32} height={illustrationZone.h - 32}>
                <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl">
                  {data.ideogramImageUrl && !imageFailed ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external, unpredictable Ideogram CDN host; next/image's fixed-domain config isn't worth it for a best-effort bonus visual.
                    <img
                      src={data.ideogramImageUrl}
                      alt="Illustration conceptuelle générée par Ideogram, sans texte"
                      className="h-full w-full object-cover"
                      onError={() => setImageFailed(true)}
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-[#C9AEDD]">
                      <ImageOff className="h-8 w-8" />
                      <Sparkles className="h-4 w-4" />
                    </div>
                  )}
                </div>
              </Html>

              {/* Zone 3 — La Cascade (mécanismes), numbered circles connected by arrows */}
              <ZoneFrame
                x={cascadeZone.x}
                y={cascadeZone.y}
                width={cascadeZone.w}
                height={cascadeZone.h}
                label={mecanismesHidden > 0 ? `La Cascade — Mécanismes (+${mecanismesHidden})` : "La Cascade — Mécanismes"}
                tone="#C9B3E0"
                fill="#FBF8FD"
              />
              {mecanismes.map((node, i) => {
                const cx = cascadeZone.x + 40 + i * (cascadeStepW + cascadeStepGap) + cascadeStepW / 2;
                const cy = cascadeZone.y + 95;
                const next = mecanismes[i + 1];
                const Icon = resolveLucideIcon(node.icon);
                return (
                  <g key={node.id}>
                    {next && (
                      <line
                        x1={cx + 34}
                        y1={cy}
                        x2={cx + (cascadeStepW + cascadeStepGap) - 34}
                        y2={cy}
                        stroke="#7C3AED"
                        strokeWidth={2.5}
                        markerEnd="url(#mm-arrow)"
                      />
                    )}
                    <circle cx={cx} cy={cy} r={30} fill="#7C3AED" />
                    <circle cx={cx + 20} cy={cy - 20} r={11} fill="#FBF8FD" stroke="#7C3AED" strokeWidth={2} />
                    <Html x={cx - 8} y={cy - 27} width={16} height={16}>
                      <div className="flex h-full w-full items-center justify-center text-[10px] font-black text-[#7C3AED]">{i + 1}</div>
                    </Html>
                    <Html x={cx - 15} y={cy - 15} width={30} height={30}>
                      <div className="flex h-full w-full items-center justify-center">
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                    </Html>
                    <Html x={cx - cascadeStepW / 2} y={cy + 38} width={cascadeStepW} height={40}>
                      <p dir="auto" className="px-1 text-center text-[10.5px] font-bold leading-tight text-[#4C1D95]">
                        {node.label}
                      </p>
                    </Html>
                  </g>
                );
              })}

              {/* Zone 4 — Le Protocole (traitement), grille numérotée */}
              <ZoneFrame
                x={protocolZone.x}
                y={protocolZone.y}
                width={protocolZone.w}
                height={protocolZone.h}
                label={traitementsHidden > 0 ? `Le Protocole — Traitement (+${traitementsHidden})` : "Le Protocole — Traitement"}
                tone="#E8C77A"
                fill="#FEFBF3"
              />
              {traitements.map((node, i) => {
                const pos = gridPosition(i, 3, 190, 76, 12, 10, protocolZone.x + 24, protocolZone.y + 24);
                const Icon = resolveLucideIcon(node.icon);
                return (
                  <g key={node.id}>
                    <Html x={pos.x} y={pos.y} width={190} height={72}>
                      <div className="flex h-full items-center gap-2 rounded-xl bg-white/70 p-2">
                        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#D97706]">
                          <Icon className="h-4 w-4 text-white" />
                          <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-black text-[#B45309] shadow">
                            {i + 1}
                          </span>
                        </div>
                        <span dir="auto" className="text-[10.5px] font-bold leading-tight text-[#7C2D12]">
                          {node.label}
                        </span>
                      </div>
                    </Html>
                  </g>
                );
              })}

              {/* Zone 5 — Signes de Gravité, encadré rouge d'alerte */}
              <g>
                <rect x={alertZone.x} y={alertZone.y} width={alertZone.w} height={alertZone.h} rx={18} fill="#FDECEC" stroke="#DC2626" strokeWidth={2.5} />
                <rect x={alertZone.x + 16} y={alertZone.y - 18} width={alertBannerW} height={36} rx={10} fill="#7F1D1D" />
                <Html x={alertZone.x + 16} y={alertZone.y - 18} width={alertBannerW} height={36}>
                  <div className={cn("flex h-full w-full items-center justify-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-[#FEE2E2]", kalam.className)}>
                    <Siren className="h-3.5 w-3.5" /> Signes de Gravité{complicationsHidden > 0 ? ` (+${complicationsHidden})` : ""}
                  </div>
                </Html>
                {complications.length > 0 ? (
                  complications.map((node, i) => {
                    const pos = gridPosition(i, 3, 190, 76, 12, 10, alertZone.x + 24, alertZone.y + 24);
                    const Icon = resolveLucideIcon(node.icon);
                    return (
                      <Html key={node.id} x={pos.x} y={pos.y} width={190} height={72}>
                        <div className="flex h-full items-center gap-2 rounded-xl bg-white/70 p-2">
                          <Icon className="h-5 w-5 shrink-0 text-[#B3261E]" />
                          <span dir="auto" className="text-[10.5px] font-bold leading-tight text-[#7F1D1D]">
                            {node.label}
                          </span>
                        </div>
                      </Html>
                    );
                  })
                ) : (
                  <Html x={alertZone.x + 24} y={alertZone.y + 24} width={alertZone.w - 48} height={30}>
                    <p className="text-[11px] font-semibold text-[#B3261E]">Aucune complication distincte générée.</p>
                  </Html>
                )}
              </g>
            </svg>
          </div>
        </div>
      </div>
      <p className="text-center text-xs text-slate-400 dark:text-slate-600">
        {data.nodes.length} notions clés — molette pour zoomer, glisser pour naviguer sur l&apos;affiche.
      </p>
    </div>
  );
}
