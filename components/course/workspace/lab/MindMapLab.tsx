"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition, type Variants } from "framer-motion";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  FileCode2,
  FileImage,
  Loader2,
  MessageSquareText,
  Minus,
  Network,
  Plus,
  Scan,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { useAuth } from "@/providers/AuthProvider";
import { buildRateLimitMessage } from "@/lib/rate-limit-message";
import { slugify } from "@/lib/course-generation-shared";
import { cn } from "@/lib/utils";

export type MindMapNodeKind = "etiologie" | "physiopathologie" | "clinique" | "diagnostic" | "traitement" | "complication" | "autre";

/** Exact node shape returned by POST /api/studio/mindmap. */
export interface MindMapNode {
  label: string;
  kind: MindMapNodeKind;
  detail?: string;
  children?: MindMapNode[];
}

export interface MindMapData {
  title: string;
  root: { label: string; children: MindMapNode[] };
}

export interface MindMapLabProps {
  courseId: number;
  courseTitle: string;
  onAskInChat?: (prompt: string) => void;
}

interface CachedMindMap {
  generatedAt: string;
  mindmap: MindMapData;
}

// ---------------------------------------------------------------------------
// Visual language — one colour family per clinical axis. Live rendering uses
// Tailwind classes (so light/dark follows the app theme); the SVG/PNG export
// is a standalone file with no stylesheet, so it inlines the same palette as
// concrete hex values.
// ---------------------------------------------------------------------------

const NODE_KINDS: readonly MindMapNodeKind[] = ["etiologie", "physiopathologie", "clinique", "diagnostic", "traitement", "complication", "autre"];

interface ExportColors {
  fill: string;
  stroke: string;
  text: string;
  stripe: string;
  link: string;
}

interface KindStyle {
  label: string;
  card: string;
  text: string;
  stripe: string;
  /** Stroke class — links of the branch and the +/− knob ring. */
  link: string;
  dot: string;
  badge: string;
  hex: { light: ExportColors; dark: ExportColors };
}

const KIND_STYLES: Record<MindMapNodeKind, KindStyle> = {
  etiologie: {
    label: "Étiologie",
    card: "fill-amber-50 stroke-amber-300 dark:fill-amber-950 dark:stroke-amber-700",
    text: "fill-amber-950 dark:fill-amber-50",
    stripe: "fill-amber-500 dark:fill-amber-400",
    link: "stroke-amber-400 dark:stroke-amber-500",
    dot: "bg-amber-500 dark:bg-amber-400",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    hex: {
      light: { fill: "#fffbeb", stroke: "#fcd34d", text: "#451a03", stripe: "#f59e0b", link: "#fbbf24" },
      dark: { fill: "#451a03", stroke: "#b45309", text: "#fffbeb", stripe: "#fbbf24", link: "#f59e0b" },
    },
  },
  physiopathologie: {
    label: "Physiopathologie",
    card: "fill-violet-50 stroke-violet-300 dark:fill-violet-950 dark:stroke-violet-700",
    text: "fill-violet-950 dark:fill-violet-50",
    stripe: "fill-violet-500 dark:fill-violet-400",
    link: "stroke-violet-400 dark:stroke-violet-500",
    dot: "bg-violet-500 dark:bg-violet-400",
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
    hex: {
      light: { fill: "#f5f3ff", stroke: "#c4b5fd", text: "#2e1065", stripe: "#8b5cf6", link: "#a78bfa" },
      dark: { fill: "#2e1065", stroke: "#6d28d9", text: "#f5f3ff", stripe: "#a78bfa", link: "#8b5cf6" },
    },
  },
  clinique: {
    label: "Clinique",
    card: "fill-sky-50 stroke-sky-300 dark:fill-sky-950 dark:stroke-sky-700",
    text: "fill-sky-950 dark:fill-sky-50",
    stripe: "fill-sky-500 dark:fill-sky-400",
    link: "stroke-sky-400 dark:stroke-sky-500",
    dot: "bg-sky-500 dark:bg-sky-400",
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
    hex: {
      light: { fill: "#f0f9ff", stroke: "#7dd3fc", text: "#082f49", stripe: "#0ea5e9", link: "#38bdf8" },
      dark: { fill: "#082f49", stroke: "#0369a1", text: "#f0f9ff", stripe: "#38bdf8", link: "#0ea5e9" },
    },
  },
  diagnostic: {
    label: "Diagnostic",
    card: "fill-indigo-50 stroke-indigo-300 dark:fill-indigo-950 dark:stroke-indigo-700",
    text: "fill-indigo-950 dark:fill-indigo-50",
    stripe: "fill-indigo-500 dark:fill-indigo-400",
    link: "stroke-indigo-400 dark:stroke-indigo-500",
    dot: "bg-indigo-500 dark:bg-indigo-400",
    badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
    hex: {
      light: { fill: "#eef2ff", stroke: "#a5b4fc", text: "#1e1b4b", stripe: "#6366f1", link: "#818cf8" },
      dark: { fill: "#1e1b4b", stroke: "#4338ca", text: "#eef2ff", stripe: "#818cf8", link: "#6366f1" },
    },
  },
  traitement: {
    label: "Traitement",
    card: "fill-emerald-50 stroke-emerald-300 dark:fill-emerald-950 dark:stroke-emerald-700",
    text: "fill-emerald-950 dark:fill-emerald-50",
    stripe: "fill-emerald-500 dark:fill-emerald-400",
    link: "stroke-emerald-400 dark:stroke-emerald-500",
    dot: "bg-emerald-500 dark:bg-emerald-400",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    hex: {
      light: { fill: "#ecfdf5", stroke: "#6ee7b7", text: "#022c22", stripe: "#10b981", link: "#34d399" },
      dark: { fill: "#022c22", stroke: "#047857", text: "#ecfdf5", stripe: "#34d399", link: "#10b981" },
    },
  },
  complication: {
    label: "Complications",
    card: "fill-rose-50 stroke-rose-300 dark:fill-rose-950 dark:stroke-rose-700",
    text: "fill-rose-950 dark:fill-rose-50",
    stripe: "fill-rose-500 dark:fill-rose-400",
    link: "stroke-rose-400 dark:stroke-rose-500",
    dot: "bg-rose-500 dark:bg-rose-400",
    badge: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
    hex: {
      light: { fill: "#fff1f2", stroke: "#fda4af", text: "#4c0519", stripe: "#f43f5e", link: "#fb7185" },
      dark: { fill: "#4c0519", stroke: "#be123c", text: "#fff1f2", stripe: "#fb7185", link: "#f43f5e" },
    },
  },
  autre: {
    label: "Autre",
    card: "fill-slate-50 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600",
    text: "fill-slate-900 dark:fill-slate-100",
    stripe: "fill-slate-500 dark:fill-slate-400",
    link: "stroke-slate-400 dark:stroke-slate-500",
    dot: "bg-slate-500 dark:bg-slate-400",
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    hex: {
      light: { fill: "#f8fafc", stroke: "#cbd5e1", text: "#0f172a", stripe: "#64748b", link: "#94a3b8" },
      dark: { fill: "#1e293b", stroke: "#475569", text: "#f1f5f9", stripe: "#94a3b8", link: "#64748b" },
    },
  },
};

const ROOT_STYLE = {
  card: "fill-primary-600 stroke-primary-700 dark:fill-primary-600 dark:stroke-primary-400",
  text: "fill-white",
  link: "stroke-primary-500 dark:stroke-primary-400",
  hex: {
    light: { fill: "#0d9488", stroke: "#0f766e", text: "#ffffff" },
    dark: { fill: "#0d9488", stroke: "#2dd4bf", text: "#ffffff" },
  },
};

const EXPORT_THEME = {
  light: { background: "#f8fafc", title: "#0f172a", subtitle: "#64748b", knobFill: "#ffffff", glyph: "#475569", count: "#64748b" },
  dark: { background: "#020617", title: "#f1f5f9", subtitle: "#94a3b8", knobFill: "#0f172a", glyph: "#cbd5e1", count: "#94a3b8" },
};

// ---------------------------------------------------------------------------
// Geometry constants
// ---------------------------------------------------------------------------

const ROOT_ID = "r";
const NODE_FONT = 13;
const NODE_LINE = 17;
const ROOT_FONT = 15;
const ROOT_LINE = 20;
const NODE_MAX_TEXT = 172;
const ROOT_MAX_TEXT = 200;
const NODE_PAD_LEFT = 18;
const NODE_PAD_RIGHT = 14;
const ROOT_PAD_X = 18;
const NODE_PAD_Y = 9;
const ROOT_PAD_Y = 12;
const MIN_NODE_WIDTH = 72;
const COLUMN_GAP = 76;
const BRANCH_GAP = 20;
const SIBLING_GAP = 10;
const KNOB_R = 8.5;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
/** Below this, 13px labels stop being readable — the first view never starts smaller (the fit button still can). */
const READABLE_ZOOM = 0.6;
const FIT_PADDING = 28;
const DRAG_THRESHOLD = 4;
const BUTTON_ZOOM_STEP = 1.25;
/** iOS Safari's canvas area ceiling — anything above silently renders blank. */
const MAX_CANVAS_PIXELS = 16_000_000;
/** The export can fall back to a system font slightly wider/narrower than the measured one — a little slack avoids clipped text. */
const TEXT_WIDTH_SLACK = 1.05;
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEW_TRANSITION = "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)";
const GRID_TRANSITION = "background-position 320ms cubic-bezier(0.22, 1, 0.36, 1), background-size 320ms cubic-bezier(0.22, 1, 0.36, 1)";
const FALLBACK_FONT = "Inter, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const PLUS_GLYPH = "M -3.5 0 H 3.5 M 0 -3.5 V 3.5";
const MINUS_GLYPH = "M -3.5 0 H 3.5";
const CACHE_VERSION = 1;

const TEAL_BUTTON =
  "bg-primary-600 text-white hover:bg-primary-700 hover:shadow-glow dark:bg-primary-500 dark:text-primary-950 dark:hover:bg-primary-400";

const ICON_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors " +
  "hover:border-primary-300 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 disabled:pointer-events-none disabled:opacity-50 " +
  "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-700 dark:hover:text-primary-300";

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// ---------------------------------------------------------------------------
// Tree model
// ---------------------------------------------------------------------------

interface FlatNode {
  id: string;
  label: string;
  /** null only for the root. */
  kind: MindMapNodeKind | null;
  /** Kind of the first-level branch this node belongs to — drives link colours. */
  branchKind: MindMapNodeKind | null;
  detail: string | null;
  depth: number;
  parentId: string | null;
  childIds: string[];
  descendantCount: number;
}

type FlatTree = Map<string, FlatNode>;

interface NodeBox {
  w: number;
  h: number;
  lines: string[];
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  padLeft: number;
  padY: number;
  align: "start" | "middle";
}

interface LayoutNode {
  id: string;
  /** Left edge. */
  x: number;
  /** Vertical centre. */
  y: number;
  box: NodeBox;
  hasChildren: boolean;
  collapsed: boolean;
}

interface LayoutLink {
  id: string;
  kind: MindMapNodeKind | null;
  depth: number;
  path: string;
  startX: number;
  startY: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface MapLayout {
  nodes: Map<string, LayoutNode>;
  /** Visible node ids, depth-first. */
  order: string[];
  links: LayoutLink[];
  bounds: Bounds;
}

interface ViewState {
  x: number;
  y: number;
  k: number;
}

interface CanvasSize {
  w: number;
  h: number;
}

type Measure = (text: string, fontSize: number, fontWeight: number) => number;

type Gesture =
  | { mode: "pan"; startX: number; startY: number; view: ViewState; moved: boolean }
  | { mode: "pinch"; startDistance: number; startMid: { x: number; y: number }; view: ViewState };

function flattenMindMap(map: MindMapData): FlatTree {
  const tree: FlatTree = new Map();
  const root: FlatNode = {
    id: ROOT_ID,
    label: map.root.label,
    kind: null,
    branchKind: null,
    detail: null,
    depth: 0,
    parentId: null,
    childIds: [],
    descendantCount: 0,
  };
  tree.set(ROOT_ID, root);

  const visit = (node: MindMapNode, id: string, parent: FlatNode, branchKind: MindMapNodeKind): number => {
    const flat: FlatNode = {
      id,
      label: node.label,
      kind: node.kind,
      branchKind,
      detail: node.detail?.trim() || null,
      depth: parent.depth + 1,
      parentId: parent.id,
      childIds: [],
      descendantCount: 0,
    };
    tree.set(id, flat);
    parent.childIds.push(id);
    let count = 0;
    (node.children ?? []).forEach((child, index) => {
      count += 1 + visit(child, `${id}.${index}`, flat, branchKind);
    });
    flat.descendantCount = count;
    return count;
  };

  let total = 0;
  map.root.children.forEach((child, index) => {
    total += 1 + visit(child, `${ROOT_ID}.${index}`, root, child.kind);
  });
  root.descendantCount = total;
  return tree;
}

function pathLabels(tree: FlatTree, id: string): string[] {
  const labels: string[] = [];
  let current = tree.get(id);
  while (current) {
    labels.unshift(current.label);
    current = current.parentId ? tree.get(current.parentId) : undefined;
  }
  return labels;
}

function isDescendantId(id: string, ancestorId: string): boolean {
  return id.startsWith(`${ancestorId}.`);
}

/** First view: everything down to depth 2, or only the branches when depth 2 alone is already crowded. */
function defaultCollapsed(tree: FlatTree): Set<string> {
  let depthTwo = 0;
  tree.forEach((node) => {
    if (node.depth === 2) depthTwo++;
  });
  const collapseFrom = depthTwo > 30 ? 1 : 2;
  const collapsed = new Set<string>();
  tree.forEach((node) => {
    if (node.depth >= collapseFrom && node.childIds.length > 0) collapsed.add(node.id);
  });
  return collapsed;
}

// ---------------------------------------------------------------------------
// Text measurement + tidy tree layout
// ---------------------------------------------------------------------------

function createMeasure(fontFamily: string): Measure {
  const context = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  const cache = new Map<string, number>();
  return (text, fontSize, fontWeight) => {
    const key = `${fontSize}|${fontWeight}|${text}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    let width: number;
    if (context) {
      context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      width = context.measureText(text).width;
    } else {
      width = text.length * fontSize * 0.56;
    }
    cache.set(key, width);
    return width;
  };
}

function fitLine(line: string, maxWidth: number, measureText: (text: string) => number): string {
  if (measureText(line) <= maxWidth) return line;
  let text = line;
  while (text.length > 1 && measureText(`${text}…`) > maxWidth) text = text.slice(0, -1);
  return `${text.trimEnd()}…`;
}

/** Greedy word wrap, at most 2 lines — anything beyond is ellipsised (the full label is in the detail card). */
function wrapLabel(label: string, maxWidth: number, measureText: (text: string) => number): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measureText(candidate) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  const kept = lines.length > 2 ? [lines[0], lines.slice(1).join(" ")] : lines;
  return kept.map((line) => fitLine(line, maxWidth, measureText));
}

function measureTree(tree: FlatTree, measure: Measure): Map<string, NodeBox> {
  const boxes = new Map<string, NodeBox>();
  tree.forEach((node) => {
    const isRoot = node.depth === 0;
    const fontSize = isRoot ? ROOT_FONT : NODE_FONT;
    const fontWeight = isRoot ? 700 : 600;
    const lineHeight = isRoot ? ROOT_LINE : NODE_LINE;
    const padLeft = isRoot ? ROOT_PAD_X : NODE_PAD_LEFT;
    const padRight = isRoot ? ROOT_PAD_X : NODE_PAD_RIGHT;
    const padY = isRoot ? ROOT_PAD_Y : NODE_PAD_Y;
    const measureText = (text: string) => measure(text, fontSize, fontWeight);
    const lines = wrapLabel(node.label, isRoot ? ROOT_MAX_TEXT : NODE_MAX_TEXT, measureText);
    const textWidth = Math.max(...lines.map(measureText)) * TEXT_WIDTH_SLACK;
    boxes.set(node.id, {
      w: Math.ceil(Math.max(MIN_NODE_WIDTH, textWidth + padLeft + padRight)),
      h: Math.ceil(lines.length * lineHeight + padY * 2),
      lines,
      fontSize,
      fontWeight,
      lineHeight,
      padLeft,
      padY,
      align: isRoot ? "middle" : "start",
    });
  });
  return boxes;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Always the same command template (M + one C), so framer-motion can interpolate between any two of them. */
function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const mid = round1((x1 + x2) / 2);
  return `M ${round1(x1)} ${round1(y1)} C ${mid} ${round1(y1)} ${mid} ${round1(y2)} ${round1(x2)} ${round1(y2)}`;
}

function pointPath(x: number, y: number): string {
  return bezierPath(x, y, x, y);
}

/** Baseline of line `index`, relative to the node's vertical centre. 0.35em ≈ optical centre of mixed-case text. */
function baselineY(box: NodeBox, index: number): number {
  return -box.h / 2 + box.padY + box.lineHeight * (index + 0.5) + box.fontSize * 0.35;
}

/**
 * Left-to-right tidy tree. Columns are fixed per depth (from the widest node
 * at that depth across the WHOLE tree, so collapsing never shifts columns
 * sideways). Leaves are stacked top to bottom with fixed gaps, and each
 * parent sits at the midpoint of its first and last visible child — pushed
 * down only when its own box would otherwise poke out of its subtree's slot,
 * which is what guarantees no two boxes ever overlap.
 */
function computeLayout(tree: FlatTree, boxes: Map<string, NodeBox>, collapsed: ReadonlySet<string>): MapLayout {
  const columnWidths: number[] = [];
  tree.forEach((node) => {
    const width = boxes.get(node.id)?.w ?? MIN_NODE_WIDTH;
    columnWidths[node.depth] = Math.max(columnWidths[node.depth] ?? 0, width);
  });
  const columnX: number[] = [0];
  for (let depth = 1; depth < columnWidths.length; depth++) {
    columnX[depth] = columnX[depth - 1] + (columnWidths[depth - 1] ?? 0) + COLUMN_GAP;
  }

  const visibleChildren = (id: string): string[] => (collapsed.has(id) ? [] : tree.get(id)?.childIds ?? []);
  const ys = new Map<string, number>();

  const shift = (id: string, dy: number) => {
    ys.set(id, (ys.get(id) ?? 0) + dy);
    visibleChildren(id).forEach((childId) => shift(childId, dy));
  };

  const place = (id: string, top: number): number => {
    const box = boxes.get(id);
    const node = tree.get(id);
    if (!box || !node) return top;
    const children = visibleChildren(id);
    if (children.length === 0) {
      ys.set(id, top + box.h / 2);
      return top + box.h;
    }
    const gap = node.depth === 0 ? BRANCH_GAP : SIBLING_GAP;
    let cursor = top;
    let bottom = top;
    children.forEach((childId, index) => {
      if (index > 0) cursor += gap;
      bottom = place(childId, cursor);
      cursor = bottom;
    });
    let center = ((ys.get(children[0]) ?? top) + (ys.get(children[children.length - 1]) ?? top)) / 2;
    if (center - box.h / 2 < top) {
      const dy = top - (center - box.h / 2);
      children.forEach((childId) => shift(childId, dy));
      center += dy;
      bottom += dy;
    }
    ys.set(id, center);
    return Math.max(bottom, center + box.h / 2);
  };
  place(ROOT_ID, 0);

  const nodes = new Map<string, LayoutNode>();
  const order: string[] = [];
  const links: LayoutLink[] = [];

  const walk = (id: string) => {
    const flat = tree.get(id);
    const box = boxes.get(id);
    if (!flat || !box) return;
    const hasChildren = flat.childIds.length > 0;
    const node: LayoutNode = {
      id,
      x: columnX[flat.depth] ?? 0,
      y: ys.get(id) ?? 0,
      box,
      hasChildren,
      collapsed: hasChildren && collapsed.has(id),
    };
    nodes.set(id, node);
    order.push(id);
    const parent = flat.parentId ? nodes.get(flat.parentId) : undefined;
    if (parent) {
      const startX = parent.x + parent.box.w;
      links.push({
        id,
        kind: flat.branchKind,
        depth: flat.depth,
        path: bezierPath(startX, parent.y, node.x, node.y),
        startX,
        startY: parent.y,
      });
    }
    visibleChildren(id).forEach(walk);
  };
  walk(ROOT_ID);

  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  nodes.forEach((node) => {
    const rightExtra = node.collapsed ? 34 : node.hasChildren ? KNOB_R + 6 : 6;
    bounds.minX = Math.min(bounds.minX, node.x - 6);
    bounds.maxX = Math.max(bounds.maxX, node.x + node.box.w + rightExtra);
    bounds.minY = Math.min(bounds.minY, node.y - node.box.h / 2 - 6);
    bounds.maxY = Math.max(bounds.maxY, node.y + node.box.h / 2 + 6);
  });
  if (!Number.isFinite(bounds.minX)) Object.assign(bounds, { minX: 0, minY: 0, maxX: 1, maxY: 1 });

  return { nodes, order, links, bounds };
}

function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

function fitView(bounds: Bounds, size: CanvasSize): ViewState {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const k = clampZoom(Math.min((size.w - FIT_PADDING * 2) / width, (size.h - FIT_PADDING * 2) / height, 1.1));
  return {
    k,
    x: (size.w - width * k) / 2 - bounds.minX * k,
    y: (size.h - height * k) / 2 - bounds.minY * k,
  };
}

/** Fit when that stays readable; otherwise a readable zoom anchored on the root, vertically centred. */
function initialView(layout: MapLayout, size: CanvasSize): ViewState {
  const fitted = fitView(layout.bounds, size);
  if (fitted.k >= READABLE_ZOOM) return fitted;
  const root = layout.nodes.get(ROOT_ID);
  const k = READABLE_ZOOM;
  return { k, x: FIT_PADDING - layout.bounds.minX * k, y: size.h / 2 - (root?.y ?? 0) * k };
}

function nearestVisibleAncestor(tree: FlatTree, layout: MapLayout, id: string): LayoutNode | null {
  let parentId = tree.get(id)?.parentId ?? null;
  while (parentId) {
    const visible = layout.nodes.get(parentId);
    if (visible) return visible;
    parentId = tree.get(parentId)?.parentId ?? null;
  }
  return layout.nodes.get(ROOT_ID) ?? null;
}

// ---------------------------------------------------------------------------
// Export (standalone SVG with inlined colours, PNG via canvas)
// ---------------------------------------------------------------------------

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildExportSvg(
  layout: MapLayout,
  tree: FlatTree,
  title: string,
  dark: boolean,
  measure: Measure
): { markup: string; width: number; height: number } {
  const theme = dark ? EXPORT_THEME.dark : EXPORT_THEME.light;
  const scheme = dark ? "dark" : "light";
  const padding = 40;
  const header = 52;
  const safeTitle = title.length > 110 ? `${title.slice(0, 109)}…` : title;
  const mapWidth = layout.bounds.maxX - layout.bounds.minX;
  const mapHeight = layout.bounds.maxY - layout.bounds.minY;
  const width = Math.ceil(Math.max(mapWidth, measure(safeTitle, 18, 700) * TEXT_WIDTH_SLACK, 240) + padding * 2);
  const height = Math.ceil(mapHeight + padding * 2 + header);
  const offsetX = round1(padding - layout.bounds.minX);
  const offsetY = round1(padding + header - layout.bounds.minY);

  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FALLBACK_FONT}">`,
    `<rect width="${width}" height="${height}" fill="${theme.background}"/>`,
    `<text x="${padding}" y="${padding + 16}" font-size="18" font-weight="700" fill="${theme.title}">${escapeXml(safeTitle)}</text>`,
    `<text x="${padding}" y="${padding + 34}" font-size="11" font-weight="500" fill="${theme.subtitle}">Carte mentale · MedArt AI</text>`,
    `<g transform="translate(${offsetX} ${offsetY})">`,
  ];

  for (const link of layout.links) {
    const color = link.kind ? KIND_STYLES[link.kind].hex[scheme].link : ROOT_STYLE.hex[scheme].stroke;
    parts.push(
      `<path d="${link.path}" fill="none" stroke="${color}" stroke-width="${link.depth === 1 ? 2.4 : 1.6}" stroke-linecap="round" stroke-opacity="0.9"/>`
    );
  }

  for (const id of layout.order) {
    const node = layout.nodes.get(id);
    const flat = tree.get(id);
    if (!node || !flat) continue;
    const { box } = node;
    const isRoot = flat.depth === 0;
    const colors = isRoot ? ROOT_STYLE.hex[scheme] : KIND_STYLES[flat.kind ?? "autre"].hex[scheme];
    const top = round1(-box.h / 2);
    const textX = box.align === "middle" ? round1(box.w / 2) : box.padLeft;
    parts.push(`<g transform="translate(${round1(node.x)} ${round1(node.y)})">`);
    parts.push(
      `<rect x="0" y="${top}" width="${box.w}" height="${box.h}" rx="${isRoot ? 14 : 10}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.25"/>`
    );
    if (!isRoot) {
      const stripe = KIND_STYLES[flat.kind ?? "autre"].hex[scheme].stripe;
      parts.push(`<rect x="7" y="${round1(top + 7)}" width="3.5" height="${box.h - 14}" rx="1.75" fill="${stripe}"/>`);
    }
    const anchor = box.align === "middle" ? ` text-anchor="middle"` : "";
    parts.push(`<text font-size="${box.fontSize}" font-weight="${box.fontWeight}" fill="${colors.text}"${anchor}>`);
    box.lines.forEach((line, index) => {
      parts.push(`<tspan x="${textX}" y="${round1(baselineY(box, index))}">${escapeXml(line)}</tspan>`);
    });
    parts.push(`</text>`);
    if (node.collapsed) {
      const ring = isRoot ? ROOT_STYLE.hex[scheme].stroke : KIND_STYLES[flat.kind ?? "autre"].hex[scheme].link;
      parts.push(
        `<g transform="translate(${box.w} 0)"><circle r="${KNOB_R}" fill="${theme.knobFill}" stroke="${ring}" stroke-width="1.5"/>` +
          `<path d="${PLUS_GLYPH}" fill="none" stroke="${theme.glyph}" stroke-width="1.6" stroke-linecap="round"/>` +
          `<text x="${KNOB_R + 5}" y="3.5" font-size="10" font-weight="700" fill="${theme.count}">${flat.descendantCount}</text></g>`
      );
    }
    parts.push(`</g>`);
  }

  parts.push(`</g>`, `</svg>`);
  return { markup: parts.join(""), width, height };
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next ticks rather than synchronously — some browsers start the download asynchronously.
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function renderPng(markup: string, width: number, height: number, background: string): Promise<Blob> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Le navigateur n'a pas pu lire l'image de la carte."));
    // A data: URL (not a blob: URL) keeps the canvas untainted in every engine, Safari included.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
  const scale = Math.min(2, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Le rendu PNG n'est pas disponible dans ce navigateur.");
  context.scale(scale, scale);
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("La conversion en PNG a échoué.");
  return blob;
}

// ---------------------------------------------------------------------------
// Cache + misc helpers
// ---------------------------------------------------------------------------

function cacheKey(userId: string, courseId: number): string {
  return `medart:mindmap:${userId}:${courseId}`;
}

function isMindMapNode(value: unknown, depth: number, counter: { count: number }): value is MindMapNode {
  counter.count++;
  if (depth > 6 || counter.count > 400 || !value || typeof value !== "object") return false;
  const node = value as { label?: unknown; kind?: unknown; detail?: unknown; children?: unknown };
  if (typeof node.label !== "string" || typeof node.kind !== "string" || !NODE_KINDS.includes(node.kind as MindMapNodeKind)) return false;
  if (node.detail !== undefined && typeof node.detail !== "string") return false;
  if (node.children === undefined) return true;
  return Array.isArray(node.children) && node.children.every((child) => isMindMapNode(child, depth + 1, counter));
}

function isMindMapData(value: unknown): value is MindMapData {
  if (!value || typeof value !== "object") return false;
  const map = value as { title?: unknown; root?: unknown };
  if (typeof map.title !== "string" || !map.root || typeof map.root !== "object") return false;
  const root = map.root as { label?: unknown; children?: unknown };
  const counter = { count: 0 };
  return (
    typeof root.label === "string" &&
    Array.isArray(root.children) &&
    root.children.length > 0 &&
    root.children.every((child) => isMindMapNode(child, 1, counter))
  );
}

function readCachedMindMap(userId: string, courseId: number): CachedMindMap | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(userId, courseId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { v, generatedAt, mindmap } = parsed as { v?: unknown; generatedAt?: unknown; mindmap?: unknown };
    if (v !== CACHE_VERSION || typeof generatedAt !== "string" || Number.isNaN(Date.parse(generatedAt))) return null;
    return isMindMapData(mindmap) ? { generatedAt, mindmap } : null;
  } catch {
    return null;
  }
}

function writeCachedMindMap(userId: string, courseId: number, entry: CachedMindMap): void {
  try {
    window.localStorage.setItem(cacheKey(userId, courseId), JSON.stringify({ v: CACHE_VERSION, ...entry }));
  } catch {
    // Private mode / full storage: the cache is a convenience, the map itself is still displayed.
  }
}

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE_FORMAT.format(date);
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return "Connexion au serveur impossible. Vérifie ta connexion puis réessaie.";
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// --- Generation requests (module-level, survive remounts) --------------------

type GenerationOutcome = { ok: true; entry: CachedMindMap } | { ok: false; error: string };

const GENERATION_FAILED = "La génération de la carte mentale a échoué. Réessaie.";

/**
 * Generations in flight, keyed `${userId ?? "anon"}:${courseId}`.
 * Module-level on purpose (same idea as ClinicalCaseSimulator's store): the
 * panel remounts when the Studio pane is expanded/collapsed, the Lab tool
 * changes, or the course changes and back. A request owned by component
 * state would be orphaned by that remount — its result never shown — and the
 * student, back on the empty state, would click "Générer" again and pay a
 * second time. So the request outlives the instance that started it, writes
 * the localStorage cache itself, and whichever instance is mounted for that
 * key when it settles adopts the result.
 */
const inFlight = new Map<string, Promise<GenerationOutcome>>();

function inFlightKey(userId: string | null, courseId: number): string {
  return `${userId ?? "anon"}:${courseId}`;
}

async function requestMindMap(userId: string | null, courseId: number): Promise<GenerationOutcome> {
  try {
    const res = await fetch("/api/studio/mindmap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId }),
    });
    const data = ((await res.json().catch(() => null)) ?? {}) as { success?: unknown; error?: unknown; mindmap?: unknown };
    if (!res.ok || data.success !== true) {
      throw new Error(
        res.status === 429 ? buildRateLimitMessage(res) : typeof data.error === "string" && data.error ? data.error : GENERATION_FAILED
      );
    }
    if (!isMindMapData(data.mindmap)) {
      throw new Error("Réponse inattendue du serveur. Réessaie.");
    }
    const entry: CachedMindMap = { generatedAt: new Date().toISOString(), mindmap: data.mindmap };
    // Cached even if no instance is mounted any more (or the student switched course): the generation was paid for, it must be there next time.
    if (userId) writeCachedMindMap(userId, courseId, entry);
    return { ok: true, entry };
  } catch (failure) {
    return { ok: false, error: describeError(failure, GENERATION_FAILED) };
  }
}

/** Returns the generation already in flight for this key, or starts one — never two at once. */
function startGeneration(userId: string | null, courseId: number): Promise<GenerationOutcome> {
  const key = inFlightKey(userId, courseId);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = requestMindMap(userId, courseId).finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

function buildNodePrompt(tree: FlatTree, id: string, courseTitle: string): string {
  const node = tree.get(id);
  if (!node) return "";
  if (node.depth === 0) {
    return `Fais-moi une synthèse structurée de « ${node.label} » à partir de mon cours « ${courseTitle} » : les grands axes à connaître et les points qui tombent le plus souvent à l'examen.`;
  }
  const path = pathLabels(tree, id).join(" › ");
  const axis = node.kind ? KIND_STYLES[node.kind].label.toLowerCase() : "autre";
  const detail = node.detail ? ` Repère noté sur la carte : « ${node.detail} ».` : "";
  return `Dans mon cours « ${courseTitle} », explique-moi en détail le point « ${node.label} » (axe : ${axis}). Dans ma carte mentale, il se situe ici : ${path}.${detail} Relie-le au reste du cours et termine par ce qu'il faut retenir pour l'examen.`;
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

function WithTooltip({ label, side, children }: { label: string; side?: "top" | "bottom" | "left" | "right"; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function IconButton(
  { className, type = "button", ...props },
  ref
) {
  return <button ref={ref} type={type} className={cn(ICON_BUTTON, className)} {...props} />;
});

const CanvasButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function CanvasButton(
  { className, type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "grid h-8 w-8 place-items-center text-slate-600 transition-colors hover:bg-slate-100 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500/60 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-primary-300",
        className
      )}
      {...props}
    />
  );
});

function ErrorBanner({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200",
        className
      )}
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 leading-relaxed">{message}</p>
    </div>
  );
}

const CANVAS_FRAME = "relative h-[62vh] max-h-[720px] min-h-[340px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/70";

function MindMapSkeleton({ label }: { label: string }) {
  const offsets = [-108, -54, 0, 54, 108];
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-600 dark:text-primary-400" />
        {label}
      </p>
      <div className={CANVAS_FRAME}>
        <svg viewBox="0 0 480 320" className="h-full w-full animate-pulse" preserveAspectRatio="xMidYMid meet" aria-hidden>
          <rect x="20" y="142" width="112" height="36" rx="12" className="fill-primary-200 dark:fill-primary-900" />
          {offsets.map((dy, index) => (
            <g key={dy}>
              <path d={bezierPath(132, 160, 196, 160 + dy)} className="fill-none stroke-slate-300 dark:stroke-slate-700" strokeWidth={2} />
              <rect x="196" y={160 + dy - 14} width={88 + (index % 2) * 22} height="28" rx="9" className="fill-slate-200 dark:fill-slate-800" />
              {index % 2 === 0 && (
                <>
                  <path
                    d={bezierPath(284 + (index % 2) * 22, 160 + dy, 340, 160 + dy - 12)}
                    className="fill-none stroke-slate-200 dark:stroke-slate-800"
                    strokeWidth={1.5}
                  />
                  <rect x="340" y={160 + dy - 24} width="96" height="24" rx="8" className="fill-slate-200/70 dark:fill-slate-800/70" />
                </>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function MindMapEmptyState({ error, onGenerate }: { error: string | null; onGenerate: () => void }) {
  return (
    <div className="glass-card rounded-3xl p-5 shadow-soft dark:shadow-glass-dark">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-300">
          <Network className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h4 className="font-heading text-sm font-bold text-foreground">Ton cours en carte mentale</h4>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Une arborescence claire du cours, organisée par axes cliniques : déplie les branches, zoome, navigue au clavier et fais-toi
            expliquer n'importe quel point dans le chat.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {NODE_KINDS.filter((kind) => kind !== "autre").map((kind) => (
          <span
            key={kind}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
          >
            <span className={cn("h-2 w-2 rounded-full", KIND_STYLES[kind].dot)} />
            {KIND_STYLES[kind].label}
          </span>
        ))}
      </div>

      <div className="mt-5 flex flex-col items-start gap-2.5">
        <Button onClick={onGenerate} className={TEAL_BUTTON}>
          <Sparkles className="h-4 w-4" />
          Générer la carte mentale
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Générée une seule fois pour tous les étudiants : si elle existe déjà pour ce cours, elle s'affiche gratuitement ; sinon elle utilise 1 génération de ton forfait.
        </p>
      </div>

      {error && <ErrorBanner className="mt-4" message={error} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG layer (memoised: panning/zooming never re-renders the nodes)
// ---------------------------------------------------------------------------

/** DOM id of a node's element — referenced by the canvas's aria-activedescendant. Prefixed per viewer instance (useId) so two mounted maps can never collide. */
function nodeElementId(prefix: string, id: string): string {
  return `${prefix}-node-${id}`;
}

interface MapLayerProps {
  layout: MapLayout;
  tree: FlatTree;
  selectedId: string | null;
  reduceMotion: boolean;
  idPrefix: string;
  onNodeClick: (id: string) => void;
  onNodeToggle: (id: string) => void;
}

const MapLayer = memo(function MapLayer({ layout, tree, selectedId, reduceMotion, idPrefix, onNodeClick, onNodeToggle }: MapLayerProps) {
  const transition: Transition = reduceMotion ? { duration: 0 } : { duration: 0.32, ease: EASE };

  return (
    <>
      <g>
        <AnimatePresence initial={!reduceMotion} custom={layout}>
          {layout.links.map((link) => {
            // Resolved with the LATEST layout (AnimatePresence's `custom`), so a collapsing link folds into wherever its ancestor now sits.
            const variants: Variants = {
              exit: (current: MapLayout) => {
                const anchor = nearestVisibleAncestor(tree, current, link.id);
                return {
                  d: anchor ? pointPath(anchor.x + anchor.box.w, anchor.y) : link.path,
                  opacity: 0,
                  transition,
                };
              },
            };
            return (
              <motion.path
                key={link.id}
                custom={layout}
                variants={variants}
                initial={{ d: pointPath(link.startX, link.startY), opacity: 0 }}
                animate={{ d: link.path, opacity: 0.9 }}
                exit="exit"
                transition={transition}
                fill="none"
                strokeWidth={link.depth === 1 ? 2.4 : 1.6}
                strokeLinecap="round"
                className={link.kind ? KIND_STYLES[link.kind].link : ROOT_STYLE.link}
              />
            );
          })}
        </AnimatePresence>
      </g>
      <g role="tree" aria-label="Nœuds de la carte mentale">
        <AnimatePresence initial={!reduceMotion} custom={layout}>
          {layout.order.map((id) => {
            const node = layout.nodes.get(id);
            const flat = tree.get(id);
            if (!node || !flat) return null;
            const origin = nearestVisibleAncestor(tree, layout, id);
            const isRoot = flat.depth === 0;
            const style = KIND_STYLES[flat.kind ?? "autre"];
            const selected = selectedId === id;
            const { box } = node;
            const top = -box.h / 2;
            const rx = isRoot ? 14 : 10;
            const variants: Variants = {
              exit: (current: MapLayout) => {
                const anchor = nearestVisibleAncestor(tree, current, id);
                return {
                  x: anchor ? anchor.x + anchor.box.w - 12 : node.x,
                  y: anchor ? anchor.y : node.y,
                  opacity: 0,
                  transition,
                };
              },
            };
            return (
              <motion.g
                key={id}
                custom={layout}
                variants={variants}
                initial={
                  isRoot || !origin ? { x: node.x, y: node.y, opacity: 0 } : { x: origin.x + origin.box.w - 12, y: origin.y, opacity: 0 }
                }
                animate={{ x: node.x, y: node.y, opacity: 1 }}
                exit="exit"
                transition={transition}
                className="cursor-pointer"
                id={nodeElementId(idPrefix, id)}
                role="treeitem"
                aria-label={flat.label}
                aria-level={flat.depth + 1}
                aria-selected={selected}
                aria-expanded={node.hasChildren ? !node.collapsed : undefined}
                onClick={(event: ReactMouseEvent<SVGGElement>) => {
                  event.stopPropagation();
                  onNodeClick(id);
                }}
                onDoubleClick={(event: ReactMouseEvent<SVGGElement>) => {
                  event.stopPropagation();
                  if (node.hasChildren) onNodeToggle(id);
                }}
              >
                {selected && (
                  <rect
                    x={-5}
                    y={top - 5}
                    width={box.w + 10}
                    height={box.h + 10}
                    rx={rx + 5}
                    className="fill-none stroke-primary-500/40 dark:stroke-primary-400/50"
                    strokeWidth={4}
                  />
                )}
                <rect
                  x={0}
                  y={top}
                  width={box.w}
                  height={box.h}
                  rx={rx}
                  strokeWidth={selected ? 2 : 1.25}
                  className={cn(isRoot ? ROOT_STYLE.card : style.card, selected && !isRoot && "stroke-primary-500 dark:stroke-primary-400")}
                />
                {!isRoot && <rect x={7} y={top + 7} width={3.5} height={box.h - 14} rx={1.75} className={style.stripe} />}
                <text
                  className={isRoot ? ROOT_STYLE.text : style.text}
                  fontSize={box.fontSize}
                  fontWeight={box.fontWeight}
                  textAnchor={box.align === "middle" ? "middle" : "start"}
                >
                  {box.lines.map((line, index) => (
                    <tspan key={index} x={box.align === "middle" ? box.w / 2 : box.padLeft} y={baselineY(box, index)}>
                      {line}
                    </tspan>
                  ))}
                </text>
                {node.hasChildren && (
                  <g
                    transform={`translate(${box.w} 0)`}
                    role="button"
                    aria-label={node.collapsed ? `Déplier « ${flat.label} »` : `Replier « ${flat.label} »`}
                    onClick={(event: ReactMouseEvent<SVGGElement>) => {
                      event.stopPropagation();
                      onNodeToggle(id);
                    }}
                    onDoubleClick={(event: ReactMouseEvent<SVGGElement>) => event.stopPropagation()}
                  >
                    <circle r={KNOB_R + 5} className="fill-transparent" />
                    <circle r={KNOB_R} strokeWidth={1.5} className={cn("fill-white dark:fill-slate-900", isRoot ? ROOT_STYLE.link : style.link)} />
                    <path
                      d={node.collapsed ? PLUS_GLYPH : MINUS_GLYPH}
                      fill="none"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      className="stroke-slate-600 dark:stroke-slate-300"
                    />
                    {node.collapsed && (
                      <text x={KNOB_R + 5} y={3.5} fontSize={10} fontWeight={700} className="fill-slate-500 dark:fill-slate-400">
                        {flat.descendantCount}
                      </text>
                    )}
                  </g>
                )}
              </motion.g>
            );
          })}
        </AnimatePresence>
      </g>
    </>
  );
});

// ---------------------------------------------------------------------------
// Interactive viewer
// ---------------------------------------------------------------------------

interface MindMapViewerProps {
  entry: CachedMindMap;
  courseTitle: string;
  onAskInChat?: (prompt: string) => void;
  error: string | null;
}

function MindMapViewer({ entry, courseTitle, onAskInChat, error }: MindMapViewerProps) {
  const { mindmap, generatedAt } = entry;
  const reduceMotion = Boolean(useReducedMotion());
  const tree = useMemo(() => flattenMindMap(mindmap), [mindmap]);
  const idPrefix = `mindmap${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => defaultCollapsed(tree));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, k: 1 });
  const [viewAnimated, setViewAnimated] = useState(false);
  const [viewReady, setViewReady] = useState(false);
  const [size, setSize] = useState<CanvasSize | null>(null);
  const [fontState, setFontState] = useState<{ family: string; epoch: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [exporting, setExporting] = useState<"svg" | "png" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const measure = useMemo(() => (fontState ? createMeasure(fontState.family) : null), [fontState]);
  const boxes = useMemo(() => (measure ? measureTree(tree, measure) : null), [tree, measure]);
  const layout = useMemo(() => (boxes ? computeLayout(tree, boxes, collapsed) : null), [tree, boxes, collapsed]);

  // Latest values for event handlers that must not be re-created on every pan frame.
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<Gesture | null>(null);
  const suppressClickRef = useRef(false);
  const userMovedRef = useRef(false);
  const initializedRef = useRef(false);

  const applyView = useCallback((next: ViewState | ((current: ViewState) => ViewState), animated: boolean) => {
    setViewAnimated(animated);
    setView((current) => (typeof next === "function" ? next(current) : next));
  }, []);

  // Fonts: measure with the real page font, and re-measure once web fonts have actually loaded.
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      if (cancelled) return;
      const element = canvasRef.current;
      const family = (element ? window.getComputedStyle(element).fontFamily : "") || FALLBACK_FONT;
      setFontState((previous) => ({ family, epoch: (previous?.epoch ?? 0) + 1 }));
    };
    read();
    if (typeof document !== "undefined" && document.fonts && document.fonts.status !== "loaded") {
      document.fonts.ready.then(read).catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Canvas size — clientWidth/Height, not getBoundingClientRect, so an ancestor's transform animation can't skew it.
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const update = () => {
      const w = element.clientWidth;
      const h = element.clientHeight;
      if (w <= 0 || h <= 0) return;
      setSize((previous) => (previous && Math.abs(previous.w - w) < 1 && Math.abs(previous.h - h) < 1 ? previous : { w, h }));
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const hasLayout = layout !== null;
  // First view, and re-centring on resize until the student has moved the map themselves.
  useEffect(() => {
    const current = layoutRef.current;
    if (!size || !current) return;
    if (initializedRef.current && userMovedRef.current) return;
    applyView(initialView(current, size), false);
    initializedRef.current = true;
    setViewReady(true);
  }, [size, hasLayout, applyView]);

  const toLocal = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: clientX, y: clientY };
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width > 0 ? svg.clientWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? svg.clientHeight / rect.height : 1;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }, []);

  const zoomBy = useCallback(
    (factor: number, origin?: { x: number; y: number }, animated = true) => {
      const currentSize = sizeRef.current;
      if (!currentSize) return;
      const point = origin ?? { x: currentSize.w / 2, y: currentSize.h / 2 };
      userMovedRef.current = true;
      applyView((current) => {
        const k = clampZoom(current.k * factor);
        const ratio = k / current.k;
        return { k, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio };
      }, animated);
    },
    [applyView]
  );

  const fitToScreen = useCallback(() => {
    const current = layoutRef.current;
    const currentSize = sizeRef.current;
    if (!current || !currentSize) return;
    applyView(fitView(current.bounds, currentSize), true);
  }, [applyView]);

  // Ctrl/Cmd + wheel (and trackpad pinch, which browsers report as ctrl+wheel) zooms around the cursor.
  // Native listener: React's onWheel is passive, so it could not prevent the page from zooming.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomBy(Math.exp(-delta * 0.0018), toLocal(event.clientX, event.clientY), false);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toLocal, zoomBy]);

  /** Pans (animated) just enough to bring a node fully into view, keeping clear of the detail card. */
  const revealNode = useCallback(
    (id: string) => {
      const current = layoutRef.current;
      const currentSize = sizeRef.current;
      const node = current?.nodes.get(id);
      if (!node || !currentSize) return;
      const v = viewRef.current;
      const margin = 24;
      const drawerHeight = drawerRef.current?.offsetHeight ?? 0;
      const bottomLimit = currentSize.h - margin - (currentSize.w < 640 ? drawerHeight : 0);
      const left = node.x * v.k + v.x;
      const right = (node.x + node.box.w + KNOB_R) * v.k + v.x;
      const top = (node.y - node.box.h / 2) * v.k + v.y;
      const bottom = (node.y + node.box.h / 2) * v.k + v.y;
      let dx = 0;
      let dy = 0;
      if (left < margin) dx = margin - left;
      else if (right > currentSize.w - margin) dx = Math.max(margin - left, currentSize.w - margin - right);
      if (top < margin) dy = margin - top;
      else if (bottom > bottomLimit) dy = Math.max(margin - top, bottomLimit - bottom);
      if (dx !== 0 || dy !== 0) applyView({ k: v.k, x: v.x + dx, y: v.y + dy }, true);
    },
    [applyView]
  );

  const toggleNode = useCallback(
    (id: string) => {
      const flat = tree.get(id);
      if (!flat || flat.childIds.length === 0 || !boxes || !layout) return;
      const next = new Set(collapsed);
      const collapsing = !next.has(id);
      if (collapsing) next.add(id);
      else next.delete(id);
      // Keep the toggled node still on screen: compensate its layout move with an equal and opposite pan.
      const before = layout.nodes.get(id);
      const after = computeLayout(tree, boxes, next).nodes.get(id);
      if (before && after && (before.x !== after.x || before.y !== after.y)) {
        applyView((current) => ({ k: current.k, x: current.x + (before.x - after.x) * current.k, y: current.y + (before.y - after.y) * current.k }), true);
      }
      setCollapsed(next);
      if (collapsing) setSelectedId((current) => (current && isDescendantId(current, id) ? id : current));
    },
    [tree, boxes, layout, collapsed, applyView]
  );

  const setAllCollapsed = useCallback(
    (mode: "expand" | "collapse") => {
      if (!boxes) return;
      const next = new Set<string>();
      if (mode === "collapse") {
        tree.forEach((node) => {
          if (node.depth >= 1 && node.childIds.length > 0) next.add(node.id);
        });
      }
      const currentSize = sizeRef.current;
      if (currentSize) applyView(fitView(computeLayout(tree, boxes, next).bounds, currentSize), true);
      setCollapsed(next);
      if (mode === "collapse") {
        // Anything deeper than a branch is now hidden — fall back to its branch.
        setSelectedId((current) => (current && (tree.get(current)?.depth ?? 0) > 1 ? current.split(".").slice(0, 2).join(".") : current));
      }
    },
    [tree, boxes, applyView]
  );

  const handleNodeClick = useCallback((id: string) => {
    if (suppressClickRef.current) return;
    setSelectedId(id);
    canvasRef.current?.focus({ preventScroll: true });
  }, []);

  const handleNodeToggle = useCallback(
    (id: string) => {
      if (suppressClickRef.current) return;
      toggleNode(id);
      canvasRef.current?.focus({ preventScroll: true });
    },
    [toggleNode]
  );

  // ---- Pointer gestures: drag to pan (capture only once it's a real drag, so plain clicks still reach nodes), two-finger pinch to zoom.

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    canvasRef.current?.focus({ preventScroll: true });
    const point = toLocal(event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, point);
    const points = Array.from(pointersRef.current.values());
    if (points.length === 1) {
      suppressClickRef.current = false;
      gestureRef.current = { mode: "pan", startX: point.x, startY: point.y, view: viewRef.current, moved: false };
    } else if (points.length === 2) {
      const [a, b] = points;
      suppressClickRef.current = true;
      userMovedRef.current = true;
      gestureRef.current = {
        mode: "pinch",
        startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view: viewRef.current,
      };
      pointersRef.current.forEach((_, pointerId) => {
        try {
          event.currentTarget.setPointerCapture(pointerId);
        } catch {
          // The other pointer may already be gone — nothing to capture.
        }
      });
    }
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    // Mouse/pen released outside the canvas without capture (capture is best-effort,
    // and is only taken once the drag passes the threshold): the pointerup never
    // reached us, so the next hover would keep panning. No button held = it ended.
    if (event.pointerType !== "touch" && event.buttons === 0) {
      handlePointerEnd(event);
      return;
    }
    const point = toLocal(event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, point);
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (gesture.mode === "pan") {
      const dx = point.x - gesture.startX;
      const dy = point.y - gesture.startY;
      if (!gesture.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        gesture.moved = true;
        suppressClickRef.current = true;
        userMovedRef.current = true;
        setPanning(true);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture is an enhancement (keeps the drag alive outside the canvas), not a requirement.
        }
      }
      applyView({ k: gesture.view.k, x: gesture.view.x + dx, y: gesture.view.y + dy }, false);
      return;
    }

    const points = Array.from(pointersRef.current.values());
    if (points.length < 2) return;
    const [a, b] = points;
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const k = clampZoom(gesture.view.k * (distance / gesture.startDistance));
    const anchorX = (gesture.startMid.x - gesture.view.x) / gesture.view.k;
    const anchorY = (gesture.startMid.y - gesture.view.y) / gesture.view.k;
    applyView({ k, x: mid.x - anchorX * k, y: mid.y - anchorY * k }, false);
  }

  function handlePointerEnd(event: ReactPointerEvent<SVGSVGElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const remaining = Array.from(pointersRef.current.values());
    if (remaining.length === 1) {
      // Pinch → one finger left: keep panning from where it is, without a jump.
      gestureRef.current = { mode: "pan", startX: remaining[0].x, startY: remaining[0].y, view: viewRef.current, moved: true };
    } else if (remaining.length === 0) {
      gestureRef.current = null;
      setPanning(false);
    }
  }

  function handleBackgroundClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setSelectedId(null);
  }

  // ---- Keyboard: arrows move the selection, Enter/Space toggles, +/−/0 zoom and fit.

  function selectAndReveal(id: string) {
    setSelectedId(id);
    revealNode(id);
  }

  function verticalNeighbour(id: string, direction: 1 | -1): string | null {
    if (!layout) return null;
    const node = layout.nodes.get(id);
    const flat = tree.get(id);
    if (!node || !flat) return null;
    // Nearest visible node in the same column — siblings first by construction, then cousins across branches.
    let bestId: string | null = null;
    let bestDelta = Infinity;
    for (const candidate of Array.from(layout.nodes.values())) {
      if (candidate.id === id || tree.get(candidate.id)?.depth !== flat.depth) continue;
      const delta = (candidate.y - node.y) * direction;
      if (delta > 0 && delta < bestDelta) {
        bestDelta = delta;
        bestId = candidate.id;
      }
    }
    return bestId;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // Escape deselects from anywhere in the canvas, detail card buttons included.
    // preventDefault marks it as handled: the Studio overlay ignores a
    // defaultPrevented Escape, so closing the detail never closes the pane too.
    // With nothing selected it's left alone, and the overlay may close.
    if (event.key === "Escape") {
      if (selectedId) {
        event.preventDefault();
        const fromDrawer = event.target instanceof Node && !!drawerRef.current?.contains(event.target);
        setSelectedId(null);
        // The detail card unmounts with the selection — don't strand focus on a removed button.
        if (fromDrawer) canvasRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    // Keys pressed on the overlay buttons (zoom, detail card) belong to those buttons.
    if (event.target !== event.currentTarget || !layout) return;
    const current = selectedId && layout.nodes.has(selectedId) ? selectedId : null;

    // "0" = fit, matched on the physical key: on AZERTY the unshifted 0 key types "à".
    // event.key stays as a fallback; modifiers are left to the browser (Ctrl+0 resets the page zoom).
    if ((event.code === "Digit0" || event.code === "Numpad0" || event.key === "0") && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      fitToScreen();
      return;
    }

    switch (event.key) {
      case "ArrowRight": {
        event.preventDefault();
        if (!current) return selectAndReveal(ROOT_ID);
        const flat = tree.get(current);
        const node = layout.nodes.get(current);
        if (!flat || !node || flat.childIds.length === 0) return;
        if (collapsed.has(current)) return toggleNode(current);
        let target = flat.childIds[0];
        let bestDelta = Infinity;
        flat.childIds.forEach((childId) => {
          const child = layout.nodes.get(childId);
          const delta = child ? Math.abs(child.y - node.y) : Infinity;
          if (delta < bestDelta) {
            bestDelta = delta;
            target = childId;
          }
        });
        return selectAndReveal(target);
      }
      case "ArrowLeft": {
        event.preventDefault();
        if (!current) return selectAndReveal(ROOT_ID);
        const parentId = tree.get(current)?.parentId;
        if (parentId) selectAndReveal(parentId);
        return;
      }
      case "ArrowUp":
      case "ArrowDown": {
        event.preventDefault();
        if (!current) return selectAndReveal(ROOT_ID);
        const neighbour = verticalNeighbour(current, event.key === "ArrowDown" ? 1 : -1);
        if (neighbour) selectAndReveal(neighbour);
        return;
      }
      case "Enter":
      case " ": {
        if (!current) return;
        event.preventDefault();
        toggleNode(current);
        return;
      }
      case "+":
      case "=": {
        event.preventDefault();
        zoomBy(BUTTON_ZOOM_STEP);
        return;
      }
      case "-":
      case "_": {
        event.preventDefault();
        zoomBy(1 / BUTTON_ZOOM_STEP);
        return;
      }
      default:
        return;
    }
  }

  // ---- Export

  const fileBase = `carte-mentale-${slugify(courseTitle) || "cours"}`;

  function buildCurrentExport() {
    if (!layout || !measure) return null;
    const dark = document.documentElement.classList.contains("dark");
    return { dark, ...buildExportSvg(layout, tree, mindmap.title, dark, measure) };
  }

  function handleExportSvg() {
    setExportError(null);
    const built = buildCurrentExport();
    if (!built) return;
    setExporting("svg");
    try {
      downloadBlob(new Blob([built.markup], { type: "image/svg+xml;charset=utf-8" }), `${fileBase}.svg`);
    } catch {
      setExportError("L'export SVG a échoué dans ce navigateur.");
    } finally {
      setExporting(null);
    }
  }

  async function handleExportPng() {
    setExportError(null);
    const built = buildCurrentExport();
    if (!built) return;
    setExporting("png");
    try {
      const background = built.dark ? EXPORT_THEME.dark.background : EXPORT_THEME.light.background;
      downloadBlob(await renderPng(built.markup, built.width, built.height, background), `${fileBase}.png`);
    } catch (exportFailure) {
      setExportError(describeError(exportFailure, "L'export PNG a échoué."));
    } finally {
      setExporting(null);
    }
  }

  // ---- Derived display data

  const presentKinds = useMemo(() => {
    const kinds = new Set<MindMapNodeKind>();
    tree.forEach((node) => {
      if (node.kind) kinds.add(node.kind);
    });
    return NODE_KINDS.filter((kind) => kinds.has(kind));
  }, [tree]);

  const selectedFlat = selectedId ? tree.get(selectedId) ?? null : null;
  const selectedLayout = selectedId && layout ? layout.nodes.get(selectedId) ?? null : null;
  // Focus stays on the canvas while the arrows move the selection, so screen
  // readers need both: aria-activedescendant pointing at the selected node,
  // and a polite live region spelling out where it sits in the tree.
  const activeDescendant = selectedLayout && selectedId ? nodeElementId(idPrefix, selectedId) : undefined;
  let selectionAnnouncement = "";
  if (selectedFlat) {
    const ancestors = pathLabels(tree, selectedFlat.id).slice(0, -1);
    const branchState =
      selectedFlat.childIds.length === 0
        ? ""
        : selectedLayout?.collapsed
          ? ` Branche repliée, ${selectedFlat.descendantCount} point${selectedFlat.descendantCount > 1 ? "s" : ""}.`
          : " Branche dépliée.";
    selectionAnnouncement =
      ancestors.length === 0
        ? `Sujet central : ${selectedFlat.label}.${branchState}`
        : `${selectedFlat.label}. Chemin : ${ancestors.join(" › ")}.${branchState}`;
  }
  const totalNodes = tree.size;
  const gridSize = Math.max(10, 22 * view.k);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="min-w-0">
        <h4 className="font-heading text-sm font-bold leading-snug text-foreground">{mindmap.title}</h4>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {totalNodes} nœuds · {mindmap.root.children.length} branches
          </span>
          {generatedAt && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Générée le {formatGeneratedAt(generatedAt)}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setAllCollapsed("expand")} disabled={!boxes}>
          <ChevronsUpDown className="h-3.5 w-3.5" />
          Tout déplier
        </Button>
        <Button variant="outline" size="sm" onClick={() => setAllCollapsed("collapse")} disabled={!boxes}>
          <ChevronsDownUp className="h-3.5 w-3.5" />
          Tout replier
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <WithTooltip label="Télécharger en SVG (vectoriel)">
            <IconButton onClick={handleExportSvg} disabled={!layout || exporting !== null} aria-label="Télécharger la carte en SVG">
              <FileCode2 className="h-4 w-4" />
            </IconButton>
          </WithTooltip>
          <WithTooltip label="Télécharger en PNG (haute résolution)">
            <IconButton onClick={handleExportPng} disabled={!layout || exporting !== null} aria-label="Télécharger la carte en PNG">
              {exporting === "png" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileImage className="h-4 w-4" />}
            </IconButton>
          </WithTooltip>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {exportError && <ErrorBanner message={exportError} />}

      {presentKinds.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Légende des couleurs">
          {presentKinds.map((kind) => (
            <span
              key={kind}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
            >
              <span className={cn("h-2 w-2 rounded-full", KIND_STYLES[kind].dot)} />
              {KIND_STYLES[kind].label}
            </span>
          ))}
        </div>
      )}

      <div
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-roledescription="carte mentale"
        aria-label={`Carte mentale « ${mindmap.title} ». Flèches pour naviguer entre les nœuds, Entrée pour déplier ou replier, + et − pour zoomer, 0 pour ajuster.`}
        aria-activedescendant={activeDescendant}
        onKeyDown={handleKeyDown}
        className={cn(
          CANVAS_FRAME,
          "outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60 [--mindmap-dot:rgb(148_163_184/0.35)] dark:[--mindmap-dot:rgb(71_85_105/0.5)]"
        )}
        style={{
          backgroundImage: "radial-gradient(circle, var(--mindmap-dot) 1px, transparent 1.25px)",
          backgroundSize: `${gridSize}px ${gridSize}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
          transition: viewAnimated && !reduceMotion ? GRID_TRANSITION : "none",
        }}
      >
        <svg
          ref={svgRef}
          className={cn("absolute inset-0 h-full w-full touch-none select-none", panning ? "cursor-grabbing" : "cursor-grab")}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onClick={handleBackgroundClick}
        >
          <g
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
              transformOrigin: "0 0",
              transition: viewAnimated && !reduceMotion ? VIEW_TRANSITION : "none",
              opacity: viewReady ? 1 : 0,
            }}
          >
            {layout && (
              <MapLayer
                layout={layout}
                tree={tree}
                selectedId={selectedId}
                reduceMotion={reduceMotion}
                idPrefix={idPrefix}
                onNodeClick={handleNodeClick}
                onNodeToggle={handleNodeToggle}
              />
            )}
          </g>
        </svg>

        <div className="absolute right-2 top-2 z-10 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/90 shadow-soft backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
          <WithTooltip label="Zoomer" side="left">
            <CanvasButton onClick={() => zoomBy(BUTTON_ZOOM_STEP)} aria-label="Zoomer">
              <Plus className="h-4 w-4" />
            </CanvasButton>
          </WithTooltip>
          <span className="select-none px-1 py-0.5 text-center text-[10px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">
            {Math.round(view.k * 100)}%
          </span>
          <WithTooltip label="Dézoomer" side="left">
            <CanvasButton onClick={() => zoomBy(1 / BUTTON_ZOOM_STEP)} aria-label="Dézoomer">
              <Minus className="h-4 w-4" />
            </CanvasButton>
          </WithTooltip>
          <span className="h-px bg-slate-200 dark:bg-slate-700" />
          <WithTooltip label="Ajuster à l'écran" side="left">
            <CanvasButton onClick={fitToScreen} aria-label="Ajuster à l'écran">
              <Scan className="h-4 w-4" />
            </CanvasButton>
          </WithTooltip>
        </div>

        <AnimatePresence>
          {selectedFlat && (
            <motion.div
              ref={drawerRef}
              key="detail"
              initial={reduceMotion ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: 14 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="absolute inset-x-2 bottom-2 z-20 max-h-[60%] overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-card backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95 sm:inset-x-auto sm:bottom-3 sm:right-3 sm:w-[21rem]"
            >
              <div className="flex items-start justify-between gap-3">
                {selectedFlat.kind ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                      KIND_STYLES[selectedFlat.kind].badge
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", KIND_STYLES[selectedFlat.kind].dot)} />
                    {KIND_STYLES[selectedFlat.kind].label}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary-800 dark:bg-primary-950 dark:text-primary-200">
                    Sujet central
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Fermer le détail"
                  className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <p className="mt-2 font-heading text-[15px] font-bold leading-snug text-foreground">{selectedFlat.label}</p>
              {selectedFlat.depth > 0 && (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {pathLabels(tree, selectedFlat.id).slice(0, -1).join(" › ")}
                </p>
              )}
              <p className="mt-2.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {selectedFlat.detail ??
                  (selectedFlat.childIds.length > 0
                    ? `${selectedFlat.descendantCount} point${selectedFlat.descendantCount > 1 ? "s" : ""} rattaché${selectedFlat.descendantCount > 1 ? "s" : ""} à cette branche.`
                    : "Pas de précision supplémentaire pour ce point dans la carte.")}
              </p>

              <div className="mt-3.5 flex flex-wrap gap-2">
                {onAskInChat && (
                  <Button size="sm" className={TEAL_BUTTON} onClick={() => onAskInChat(buildNodePrompt(tree, selectedFlat.id, courseTitle))}>
                    <MessageSquareText className="h-3.5 w-3.5" />
                    Expliquer dans le chat
                  </Button>
                )}
                {selectedFlat.childIds.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => toggleNode(selectedFlat.id)}>
                    {selectedLayout?.collapsed ? (
                      <>
                        <Plus className="h-3.5 w-3.5" />
                        Déplier ({selectedFlat.descendantCount})
                      </>
                    ) : (
                      <>
                        <Minus className="h-3.5 w-3.5" />
                        Replier
                      </>
                    )}
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {selectionAnnouncement}
      </p>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Glisse le fond pour te déplacer · Ctrl + molette ou pincement pour zoomer · clique un nœud pour son détail, sur +/− pour le déplier ·
        au clavier : flèches puis Entrée.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * "Carte mentale interactive" — a course turned into a navigable SVG tree
 * (own tidy layout, no diagram dependency), generated on demand by
 * app/api/studio/mindmap/route.ts. Each generation costs one unit of the
 * plan's monthly quota, so the result is cached per student/course in
 * localStorage and reopening never re-spends anything.
 */
export function MindMapLab({ courseId, courseTitle, onAskInChat }: MindMapLabProps) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;

  const [entry, setEntry] = useState<CachedMindMap | null>(null);
  const [cacheReady, setCacheReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a response for a previous course/user landing in the current view.
  const scope = `${userId ?? "anonyme"}:${courseId}`;
  const scopeRef = useRef(scope);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Shows the generating state until `promise` (from startGeneration —
   * started by this instance or left running by a previous mount) settles,
   * then displays its result — only if this instance is still mounted and
   * still on the same course/user.
   */
  const adopt = useCallback((promise: Promise<GenerationOutcome>) => {
    const requestScope = scopeRef.current;
    setPending(true);
    setError(null);
    void promise.then((outcome) => {
      if (!mountedRef.current || scopeRef.current !== requestScope) return;
      if (outcome.ok) setEntry(outcome.entry);
      else setError(outcome.error);
      setPending(false);
    });
  }, []);

  useEffect(() => {
    scopeRef.current = scope;
    if (authLoading) {
      setCacheReady(false);
      return;
    }
    setEntry(userId ? readCachedMindMap(userId, courseId) : null);
    setPending(false);
    setError(null);
    setCacheReady(true);
    // A generation started before a remount (or before switching course and
    // back) is still running: show it as such and pick up its result rather
    // than offering — and charging — a second one.
    const running = inFlight.get(inFlightKey(userId, courseId));
    if (running) adopt(running);
  }, [adopt, authLoading, courseId, scope, userId]);

  const generate = useCallback(() => {
    // startGeneration hands back the running request if there is one, so a double click never pays twice.
    adopt(startGeneration(userId, courseId));
  }, [adopt, courseId, userId]);

  let content: ReactNode;
  if (!cacheReady) {
    content = <MindMapSkeleton label="Chargement de ta carte mentale…" />;
  } else if (entry) {
    content = (
      <MindMapViewer
        key={entry.generatedAt}
        entry={entry}
        courseTitle={courseTitle}
        onAskInChat={onAskInChat}
        error={error}
      />
    );
  } else if (pending) {
    content = <MindMapSkeleton label="Construction de la carte mentale à partir du cours…" />;
  } else {
    content = <MindMapEmptyState error={error} onGenerate={generate} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-glow">
          <Network className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="font-heading text-base font-bold leading-tight text-foreground">Carte mentale interactive</h3>
          <p className="truncate text-xs text-muted-foreground">{courseTitle}</p>
        </div>
      </div>
      {content}
    </div>
  );
}
