"use client";

import { useState } from "react";
import { GitFork, Sparkles, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { DiseaseJourneyViewer } from "@/components/visual-studio/DiseaseJourneyViewer";
import { DiagnosticDecisionTree } from "@/components/visual-studio/DiagnosticDecisionTree";
import {
  MOCK_APPENDICITIS_DECISION_TREE,
  MOCK_APPENDICITIS_JOURNEY,
} from "@/lib/visual-studio-mock-data";

const VISUAL_TABS = [
  { id: "journey", label: "Parcours de la Maladie", icon: Workflow },
  { id: "tree", label: "Arbre de Décision", icon: GitFork },
] as const;

type VisualTabId = (typeof VISUAL_TABS)[number]["id"];

/** Self-contained "Mode Visuel" demo, wired to the same Appendicite course used by every other Studio tab. */
export function VisualStudioDemo() {
  const [activeTab, setActiveTab] = useState<VisualTabId>("journey");

  return (
    <div className="animate-fade-in">
      <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-cyan-500/30">
        <Sparkles className="h-4 w-4" />
        Mode Visuel — sélection automatique de la meilleure représentation
      </div>

      <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
        {VISUAL_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200",
                isActive
                  ? "border-cyan-600 bg-cyan-600 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "journey" ? (
        <DiseaseJourneyViewer data={MOCK_APPENDICITIS_JOURNEY} />
      ) : (
        <DiagnosticDecisionTree data={MOCK_APPENDICITIS_DECISION_TREE} />
      )}
    </div>
  );
}
