"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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

type Tone = "blue" | "amber" | "purple" | "emerald" | "rose";

function toneForNode(node: DecisionTreeNode): Tone {
  if (node.type === "outcome") {
    return node.outcomeSeverity === "urgent" ? "rose" : "emerald";
  }
  if (node.type === "question") return "blue";
  if (node.type === "test") return "amber";
  return "purple";
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

const CHIP_TONE_STYLES: Record<Tone, string> = {
  blue: "bg-blue-100 text-blue-600",
  amber: "bg-amber-100 text-amber-600",
  purple: "bg-purple-100 text-purple-600",
  emerald: "bg-emerald-100 text-emerald-600",
  rose: "bg-rose-100 text-rose-600",
};

const CARD_TONE_STYLES: Record<Tone, string> = {
  blue: "border-blue-200 bg-blue-50/60 hover:border-blue-300",
  amber: "border-amber-200 bg-amber-50/60 hover:border-amber-300",
  purple: "border-purple-200 bg-purple-50/60 hover:border-purple-300",
  emerald: "border-emerald-200 bg-emerald-50/60 hover:border-emerald-300",
  rose: "border-rose-200 bg-rose-50/60 hover:border-rose-300",
};

const BADGE_TONE_STYLES: Record<Tone, string> = {
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
  purple: "bg-purple-100 text-purple-700",
  emerald: "bg-emerald-100 text-emerald-700",
  rose: "bg-rose-100 text-rose-700",
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
          "flex w-full items-start gap-3 rounded-xl border p-3 text-left shadow-sm transition-colors sm:p-3.5",
          CARD_TONE_STYLES[tone],
          !isExpandable && "cursor-default"
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
          <span className="block text-sm font-semibold leading-snug text-slate-900">
            {node.label}
          </span>
        </span>

        {isExpandable && (
          <ChevronRight
            className={cn(
              "mt-1.5 h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200",
              isOpen && "rotate-90"
            )}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {isExpandable && isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="pt-2">
              {node.detail && (
                <p className="mb-2 rounded-lg bg-white/70 p-2.5 text-xs leading-relaxed text-slate-600">
                  {node.detail}
                </p>
              )}

              {hasChildren && (
                <div className="space-y-2 border-l-2 border-dashed border-slate-200 pl-4">
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
          </motion.div>
        )}
      </AnimatePresence>
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
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <h3 className="mb-6 text-center text-lg font-bold text-slate-900">{data.title}</h3>
      <DecisionNodeCard node={data.root} expandedIds={expandedIds} onToggle={handleToggle} depth={0} />
    </div>
  );
}
