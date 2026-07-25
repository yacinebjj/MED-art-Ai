import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import {
  VISUAL_CLASSIFICATION_SYSTEM_PROMPT,
  buildVisualClassificationUserMessage,
} from "@/lib/prompts/visual-classification";
import {
  DISEASE_JOURNEY_SYSTEM_PROMPT,
  buildDiseaseJourneyUserMessage,
} from "@/lib/prompts/disease-journey";
import {
  DECISION_TREE_SYSTEM_PROMPT,
  buildDecisionTreeUserMessage,
} from "@/lib/prompts/decision-tree";
import type {
  VisualClassification,
  VisualType,
  DiseaseJourneyData,
  DiseaseJourneyStage,
  DecisionTreeData,
  DecisionTreeNode,
} from "@/lib/visual-studio-types";

const MAX_COURSE_CHARS = 60_000;

const VISUAL_TYPES: VisualType[] = [
  "disease_journey",
  "decision_tree",
  "mind_map",
  "drug_graph",
  "comparison",
  "timeline",
];

const DISEASE_JOURNEY_STAGES: DiseaseJourneyStage[] = [
  "normal_organ",
  "risk_factors",
  "pathophysiology",
  "symptoms",
  "diagnosis",
  "treatment",
  "complications",
];

export class VisualStudioGenerationError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function fromOpenRouterError(error: unknown): VisualStudioGenerationError {
  if (error instanceof OpenRouterError) {
    return new VisualStudioGenerationError(error.message, error.status);
  }
  console.error("Unexpected error calling OpenRouter", error);
  return new VisualStudioGenerationError("Une erreur inattendue est survenue.", 500);
}

/** Strips a ```json ... ``` fence if the model added one despite instructions not to. */
function parseJson(raw: string, context: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.error(`Failed to parse AI JSON output for ${context}:`, error, cleaned.slice(0, 500));
    throw new VisualStudioGenerationError("L'IA a renvoyé une réponse invalide. Réessaie.", 502);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────

function isVisualClassification(value: unknown): value is VisualClassification {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.visual_type === "string" &&
    VISUAL_TYPES.includes(v.visual_type as VisualType) &&
    typeof v.confidence === "number" &&
    v.confidence >= 0 &&
    v.confidence <= 1 &&
    typeof v.reasoning === "string"
  );
}

/** Classifies which of the 6 Visual Studio representations best fits a course excerpt. */
export async function classifyVisualType(courseText: string): Promise<VisualClassification> {
  const truncatedText = courseText.slice(0, MAX_COURSE_CHARS);

  let raw: string;
  try {
    raw = await callOpenRouter([
      { role: "system", content: VISUAL_CLASSIFICATION_SYSTEM_PROMPT },
      { role: "user", content: buildVisualClassificationUserMessage(truncatedText) },
    ]);
  } catch (error) {
    throw fromOpenRouterError(error);
  }

  const parsed = parseJson(raw, "visual classification");
  if (!isVisualClassification(parsed)) {
    throw new VisualStudioGenerationError(
      "La classification renvoyée par l'IA est invalide ou incomplète.",
      502
    );
  }

  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────
// Disease Journey
// ─────────────────────────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDiseaseJourneyData(value: unknown): value is DiseaseJourneyData {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.title) || !Array.isArray(v.steps)) return false;

  const stagesPresent = new Set<string>();
  for (const step of v.steps) {
    if (!step || typeof step !== "object") return false;
    const s = step as Record<string, unknown>;
    if (
      typeof s.stage !== "string" ||
      !DISEASE_JOURNEY_STAGES.includes(s.stage as DiseaseJourneyStage) ||
      !isNonEmptyString(s.title) ||
      !isNonEmptyString(s.summary) ||
      !isNonEmptyString(s.details) ||
      !Array.isArray(s.keyPoints) ||
      s.keyPoints.some((p) => typeof p !== "string")
    ) {
      return false;
    }
    stagesPresent.add(s.stage);
  }

  // Every one of the 7 canonical stages must be represented exactly once.
  return DISEASE_JOURNEY_STAGES.every((stage) => stagesPresent.has(stage));
}

/** Generates the 7-stage clinical progression rendered by DiseaseJourneyViewer. */
export async function generateDiseaseJourney(courseText: string): Promise<DiseaseJourneyData> {
  const truncatedText = courseText.slice(0, MAX_COURSE_CHARS);

  let raw: string;
  try {
    raw = await callOpenRouter([
      { role: "system", content: DISEASE_JOURNEY_SYSTEM_PROMPT },
      { role: "user", content: buildDiseaseJourneyUserMessage(truncatedText) },
    ]);
  } catch (error) {
    throw fromOpenRouterError(error);
  }

  const parsed = parseJson(raw, "disease journey");
  if (!isDiseaseJourneyData(parsed)) {
    throw new VisualStudioGenerationError(
      "Le parcours clinique renvoyé par l'IA est incomplet (une ou plusieurs des 7 étapes manquent).",
      502
    );
  }

  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────
// Decision Tree
// ─────────────────────────────────────────────────────────────────────────

const DECISION_NODE_TYPES = ["question", "test", "decision", "outcome"];

function isDecisionTreeNode(value: unknown): value is DecisionTreeNode {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  if (
    !isNonEmptyString(v.id) ||
    typeof v.type !== "string" ||
    !DECISION_NODE_TYPES.includes(v.type) ||
    !isNonEmptyString(v.label)
  ) {
    return false;
  }

  if (v.detail !== undefined && typeof v.detail !== "string") return false;

  if (v.outcomeSeverity !== undefined) {
    if (v.type !== "outcome") return false;
    if (v.outcomeSeverity !== "favorable" && v.outcomeSeverity !== "urgent") return false;
  }

  if (v.children === undefined) return true;
  if (!Array.isArray(v.children)) return false;
  return v.children.every(isDecisionTreeNode);
}

function isDecisionTreeData(value: unknown): value is DecisionTreeData {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return isNonEmptyString(v.title) && isDecisionTreeNode(v.root);
}

/** Generates the recursive clinical algorithm rendered by DiagnosticDecisionTree. */
export async function generateDecisionTree(courseText: string): Promise<DecisionTreeData> {
  const truncatedText = courseText.slice(0, MAX_COURSE_CHARS);

  let raw: string;
  try {
    raw = await callOpenRouter([
      { role: "system", content: DECISION_TREE_SYSTEM_PROMPT },
      { role: "user", content: buildDecisionTreeUserMessage(truncatedText) },
    ]);
  } catch (error) {
    throw fromOpenRouterError(error);
  }

  const parsed = parseJson(raw, "decision tree");
  if (!isDecisionTreeData(parsed)) {
    throw new VisualStudioGenerationError(
      "L'arbre de décision renvoyé par l'IA est mal formé.",
      502
    );
  }

  return parsed;
}
