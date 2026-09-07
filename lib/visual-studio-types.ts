/**
 * Shared data contracts for the "Visual Studio" feature — the AI
 * classification layer (lib/prompts/visual-classification.ts) and the
 * per-type generators (lib/ai/generate-visual-studio.ts) both produce data
 * shaped exactly like these interfaces, so the frontend components
 * (components/visual-studio/*) can render them without any adapter layer.
 */

/** The six visual representations the classifier can choose between. */
export type VisualType =
  | "disease_journey"
  | "decision_tree"
  | "mind_map"
  | "drug_graph"
  | "comparison"
  | "timeline";

/** Output of the classification pass — which visual best fits the course text, and why. */
export interface VisualClassification {
  visual_type: VisualType;
  /** 0-1 confidence that this is the right visual for the content. */
  confidence: number;
  /** One-sentence justification, useful for logging/debugging the classifier's choice. */
  reasoning: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Disease Journey
// ─────────────────────────────────────────────────────────────────────────

/** The seven canonical stages of a clinical disease course, in fixed display order. */
export type DiseaseJourneyStage =
  | "normal_organ"
  | "risk_factors"
  | "pathophysiology"
  | "symptoms"
  | "diagnosis"
  | "treatment"
  | "complications";

export interface DiseaseJourneyStep {
  stage: DiseaseJourneyStage;
  title: string;
  /** One or two sentences shown on the collapsed card. */
  summary: string;
  /** Longer explanation shown when the student expands the step's drawer. */
  details: string;
  /** Short bullet facts shown inside the drawer, below `details`. */
  keyPoints: string[];
}

export interface DiseaseJourneyData {
  title: string;
  steps: DiseaseJourneyStep[];
}

// ─────────────────────────────────────────────────────────────────────────
// Decision Tree
// ─────────────────────────────────────────────────────────────────────────

export type DecisionNodeType = "question" | "test" | "decision" | "outcome";

export interface DecisionTreeNode {
  id: string;
  type: DecisionNodeType;
  label: string;
  /** Extra clinical detail shown when this node is expanded/selected. */
  detail?: string;
  /** Only meaningful when type === "outcome" — drives red/green coloring. */
  outcomeSeverity?: "favorable" | "urgent";
  children?: DecisionTreeNode[];
}

export interface DecisionTreeData {
  title: string;
  root: DecisionTreeNode;
}
