import { DiseaseJourneyViewer } from "@/components/visual-studio/DiseaseJourneyViewer";
import { DiagnosticDecisionTree } from "@/components/visual-studio/DiagnosticDecisionTree";
import { AnatomyCalloutView } from "@/components/visual-studio/AnatomyCalloutView";
import { PathophysiologyCascade } from "@/components/visual-studio/PathophysiologyCascade";
import { ClinicalSignsGrid } from "@/components/visual-studio/ClinicalSignsGrid";
import { ComparisonMatrix } from "@/components/visual-studio/ComparisonMatrix";
import { ManagementOverview } from "@/components/visual-studio/ManagementOverview";
import { ClinicalPearlsPanel } from "@/components/visual-studio/ClinicalPearlsPanel";
import { QuizPanel } from "@/components/visual-studio/QuizPanel";
import type { Slide } from "@/lib/presentation-types";

/**
 * Dynamic graphical dispatcher — inspects `slide.visualType` and routes to the
 * matching renderer. The exhaustive switch (with a `never`-typed default) is
 * a compile-time guarantee that every Slide variant added to the union has a
 * renderer wired here.
 */
export function VisualRenderer({ slide }: { slide: Slide }) {
  switch (slide.visualType) {
    case "anatomy":
      return <AnatomyCalloutView slide={slide} />;
    case "disease_journey":
      return <DiseaseJourneyViewer data={slide.journey} />;
    case "pathophysiology_cascade":
      return <PathophysiologyCascade slide={slide} />;
    case "clinical_signs":
      return <ClinicalSignsGrid slide={slide} />;
    case "decision_tree":
      return <DiagnosticDecisionTree data={slide.tree} />;
    case "comparison_matrix":
      return <ComparisonMatrix slide={slide} />;
    case "management":
      return <ManagementOverview slide={slide} />;
    case "pearls":
      return <ClinicalPearlsPanel slide={slide} />;
    case "quiz":
      return <QuizPanel key={slide.id} questions={slide.quiz} accent="emerald" />;
    default: {
      const _exhaustiveCheck: never = slide;
      return _exhaustiveCheck;
    }
  }
}
