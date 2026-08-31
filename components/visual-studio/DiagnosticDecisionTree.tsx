"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  GitFork,
  HelpCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DecisionNodeType, DecisionTreeData, DecisionTreeNode } from "@/lib/visual-studio-types";

type Tone = "blue" | "amber" | "violet" | "emerald" | "rose";

function toneForNode(node: DecisionTreeNode): Tone {
  if (node.type === "outcome") {
    return node.outcomeSeverity === "urgent" ? "rose" : "emerald";
  }
  if (node.type === "question") return "blue";
  if (node.type === "test") return "amber";
  return "violet";
}

function iconForNode(node: DecisionTreeNode): LucideIcon {
  if (node.type === "outcome") {
    return node.outcomeSeverity === "urgent" ? XCircle : CheckCircle2;
  }
  if (node.type === "question") return HelpCircle;
  if (node.type === "test") return FlaskConical;
  return GitFork;
}

const NODE_TYPE_LABEL: Record<DecisionNodeType, string> = {
  question: "Question",
  test: "Examen",
  decision: "Décision",
  outcome: "Conclusion",
};

/** Same five-tone language used across every Visual Studio content panel — dark variants keep every hue legible against the dark card surface. */
const CHIP_TONE_STYLES: Record<Tone, string> = {
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  violet: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  rose: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
};

const CARD_TONE_STYLES: Record<Tone, string> = {
  blue: "border-blue-200 bg-blue-50/60 hover:border-blue-300 dark:border-blue-500/25 dark:bg-blue-500/10 dark:hover:border-blue-500/45",
  amber: "border-amber-200 bg-amber-50/60 hover:border-amber-300 dark:border-amber-500/25 dark:bg-amber-500/10 dark:hover:border-amber-500/45",
  violet: "border-violet-200 bg-violet-50/60 hover:border-violet-300 dark:border-violet-500/25 dark:bg-violet-500/10 dark:hover:border-violet-500/45",
  emerald: "border-emerald-200 bg-emerald-50/60 hover:border-emerald-300 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:hover:border-emerald-500/45",
  rose: "border-rose-200 bg-rose-50/60 hover:border-rose-300 dark:border-rose-500/25 dark:bg-rose-500/10 dark:hover:border-rose-500/45",
};

const BADGE_TONE_STYLES: Record<Tone, string> = {
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
};

interface DecisionNodeCardProps {
  node: DecisionTreeNode;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  depth: number;
}

function DecisionNodeCard({ node, expandedIds, onToggle, depth }: DecisionNodeCardProps) {
  const tone = toneForNode(node);
  const Icon = iconForNode(node);
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isExpandable = hasChildren || Boolean(node.detail);
  const isOpen = expandedIds.has(node.id);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => isExpandable && onToggle(node.id)}
        aria-expanded={isExpandable ? isOpen : undefined}
        className={cn(
          "flex w-full items-start gap-3 rounded-xl border p-3 text-left shadow-sm transition-all duration-300 sm:p-3.5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          CARD_TONE_STYLES[tone],
          isExpandable ? "hover:-translate-y-0.5 active:scale-[0.99]" : "cursor-default"
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            CHIP_TONE_STYLES[tone]
          )}
        >
          <Icon className="h-4 w-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              BADGE_TONE_STYLES[tone]
            )}
          >
            {NODE_TYPE_LABEL[node.type]}
            {node.type === "outcome" &&
              (node.outcomeSeverity === "urgent" ? " · urgent" : " · favorable")}
          </span>
          <span className="block text-sm font-semibold leading-snug text-foreground">
            {node.label}
          </span>
        </span>

        {isExpandable && (
          <ChevronRight
            className={cn(
              "mt-1.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-90"
            )}
          />
        )}
      </button>

      {isExpandable && isOpen && (
        <div className="animate-fade-in overflow-hidden">
          <div className="pt-2">
            {node.detail && (
              <p className="mb-2 rounded-lg bg-background/60 p-2.5 text-xs leading-relaxed text-muted-foreground dark:bg-background/30">
                {node.detail}
              </p>
            )}

            {hasChildren && (
              <div className="space-y-2 border-l-2 border-dashed border-border pl-4">
                {node.children!.map((child) => (
                  <DecisionNodeCard
                    key={child.id}
                    node={child}
                    expandedIds={expandedIds}
                    onToggle={onToggle}
                    depth={depth + 1}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Collects every node id down to `depth` levels below the root, used to seed the default-expanded set. */
function collectIdsUpToDepth(node: DecisionTreeNode, depth: number): string[] {
  if (depth <= 0) return [];
  const ids = [node.id];
  for (const child of node.children ?? []) {
    ids.push(...collectIdsUpToDepth(child, depth - 1));
  }
  return ids;
}

interface DiagnosticDecisionTreeProps {
  data: DecisionTreeData;
  /** How many levels below the root start expanded. Defaults to 1 (root's own children visible). */
  defaultExpandedDepth?: number;
}

export function DiagnosticDecisionTree({
  data,
  defaultExpandedDepth = 1,
}: DiagnosticDecisionTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(collectIdsUpToDepth(data.root, defaultExpandedDepth + 1))
  );

  function handleToggle(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft dark:shadow-glass-dark sm:p-6">
      <h3 className="mb-6 text-center text-lg font-bold text-foreground">{data.title}</h3>

      {/* Compact legend — five tones repeat down every branch, so naming them once up front keeps the nested cards scannable instead of forcing a color-memory game. */}
      <div className="mb-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-blue-500 dark:bg-blue-400" /> Question
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-500 dark:bg-amber-400" /> Examen
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-violet-500 dark:bg-violet-400" /> Décision
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400" /> Favorable
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-500 dark:bg-rose-400" /> Urgent
        </span>
      </div>

      <DecisionNodeCard node={data.root} expandedIds={expandedIds} onToggle={handleToggle} depth={0} />
    </div>
  );
}
