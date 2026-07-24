import { Fragment } from "react";
import { cn } from "@/lib/utils";
import type { FlowChartData, FlowNode, FlowNodeTone } from "@/lib/demo-resume-content";

/** Card border/background per semantic tone — matches the app's callout palette. */
const CARD_TONE_STYLES: Record<FlowNodeTone, string> = {
  blue: "border-blue-200 bg-blue-50 text-blue-900",
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
  rose: "border-rose-200 bg-rose-50 text-rose-900",
};

/** The little icon "chip" inside each card gets a slightly stronger fill of the same tone. */
const ICON_TONE_STYLES: Record<FlowNodeTone, string> = {
  blue: "bg-blue-100 text-blue-600",
  amber: "bg-amber-100 text-amber-600",
  emerald: "bg-emerald-100 text-emerald-600",
  rose: "bg-rose-100 text-rose-600",
};

function FlowCard({ node }: { node: FlowNode }) {
  const Icon = node.icon;
  return (
    <div
      className={cn(
        "flex w-full max-w-[220px] flex-col items-center gap-2 rounded-xl border p-4 text-center shadow-sm",
        CARD_TONE_STYLES[node.tone]
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full",
          ICON_TONE_STYLES[node.tone]
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold leading-snug">{node.label}</p>
      {node.sublabel && <p className="text-xs leading-snug opacity-80">{node.sublabel}</p>}
    </div>
  );
}

/** Vertical line + down-chevron between two levels; widens into a short horizontal bar when the next level forks into several cards. */
function Connector({ fanOut }: { fanOut: boolean }) {
  return (
    <div className="flex flex-col items-center py-1" aria-hidden>
      <div className="h-3 w-px bg-slate-300" />
      {fanOut && <div className="h-px w-24 bg-slate-300 sm:w-40" />}
      <svg width="14" height="9" viewBox="0 0 14 9" fill="none" className="text-slate-400">
        <path
          d="M1 1L7 8L13 1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function SingleFlowchart({ chart }: { chart: FlowChartData }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
      <h3 className="mb-5 text-center text-xs font-bold uppercase tracking-wide text-slate-500">
        {chart.title}
      </h3>
      <div className="flex flex-col items-center">
        {chart.levels.map((level, i) => (
          <Fragment key={i}>
            {i > 0 && <Connector fanOut={level.nodes.length > 1} />}
            <div className="flex flex-wrap items-stretch justify-center gap-4">
              {level.nodes.map((node, j) => (
                <FlowCard key={j} node={node} />
              ))}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** Renders the "Visual Summary" mode's decision trees as real HTML/Tailwind cards + SVG connectors — no ASCII art, no code block. */
export function VisualFlowchart({ charts }: { charts: FlowChartData[] }) {
  return (
    <div className="space-y-8">
      {charts.map((chart, i) => (
        <SingleFlowchart key={i} chart={chart} />
      ))}
    </div>
  );
}
