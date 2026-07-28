/**
 * Shared data contracts for the "Visual Presentation Engine" — a PPTX-style
 * slide deck studio built on top of the existing Visual Studio primitives
 * (DiseaseJourneyData / DecisionTreeData are reused as-is inside slides so
 * DiseaseJourneyViewer / DiagnosticDecisionTree can render them unchanged).
 */
import type { DecisionTreeData, DiseaseJourneyData } from "@/lib/visual-studio-types";

/** Drives the enforced Tailwind color tokens for a slide's chrome (border, badge, accents). */
export type SlideTheme = "blue" | "red" | "amber" | "purple" | "emerald" | "slate";

/** Medical domain classification — feeds the same color-coding system as SlideTheme, kept separate because a slide's dominant *theme* (e.g. "red" for pathology) and its *domain* label ("Pathologie") are shown in different places. */
export type MedicalDomain =
  | "anatomy"
  | "physiology"
  | "pathology"
  | "pharmacology"
  | "surgery"
  | "clinical";

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  /** Index into `options` of the correct answer. */
  correctIndex: number;
  explanation: string;
}

export interface LearningModeContent {
  summary: string;
  keyPoints: string[];
  pearl: string;
  commonMistakes: string[];
  quiz: QuizQuestion[];
}

interface BaseSlide {
  id: string;
  title: string;
  subtitle: string;
  theme: SlideTheme;
  domain: MedicalDomain;
  learningMode: LearningModeContent;
}

export interface AnatomyStructureCallout {
  id: string;
  label: string;
  description: string;
  /** Percentage position (0-100) of the callout pin over the diagram. */
  x: number;
  y: number;
}

export interface AnatomySlide extends BaseSlide {
  visualType: "anatomy";
  anatomy: {
    diagramLabel: string;
    structures: AnatomyStructureCallout[];
    embryology: string;
    physiology: string;
  };
}

export interface DiseaseJourneySlide extends BaseSlide {
  visualType: "disease_journey";
  journey: DiseaseJourneyData;
}

export interface PathophysiologyStep {
  id: string;
  order: number;
  title: string;
  summary: string;
  details: string;
  keyPoints: string[];
}

/**
 * A free-form, N-step pathophysiological cascade (e.g. Obstruction -> Distension ->
 * Ischemia -> Translocation -> Gangrene -> Perforation -> Peritonitis). Deliberately
 * separate from DiseaseJourneySlide: that type is locked to the fixed macro-clinical
 * stage taxonomy (normal_organ..complications) used elsewhere in the app, whereas a
 * pathophysiology deep-dive needs its own disease-specific step labels.
 */
export interface PathophysiologyCascadeSlide extends BaseSlide {
  visualType: "pathophysiology_cascade";
  cascade: {
    title: string;
    steps: PathophysiologyStep[];
  };
}

export interface ClinicalSign {
  name: string;
  description: string;
  howToElicit: string;
  significance: string;
}

export interface ClinicalSignsSlide extends BaseSlide {
  visualType: "clinical_signs";
  signs: ClinicalSign[];
}

export interface DecisionTreeSlide extends BaseSlide {
  visualType: "decision_tree";
  tree: DecisionTreeData;
}

export interface ComparisonMatrixSlide extends BaseSlide {
  visualType: "comparison_matrix";
  matrix: {
    criteria: string[];
    entities: {
      name: string;
      /** One value per criterion, same order as `matrix.criteria`. */
      values: string[];
      /** True for the entity the slide is actually about (highlighted column). */
      isPrimary?: boolean;
    }[];
  };
}

export interface ManagementApproach {
  name: string;
  description: string;
  pros: string[];
  cons: string[];
}

export interface ManagementComplication {
  name: string;
  frequency: string;
  management: string;
  severity: "favorable" | "urgent";
}

export interface ManagementSlide extends BaseSlide {
  visualType: "management";
  management: {
    approaches: ManagementApproach[];
    antibioticProphylaxis: string;
    complications: ManagementComplication[];
  };
}

export interface PearlsSlide extends BaseSlide {
  visualType: "pearls";
  pearls: string[];
  pitfalls: string[];
  mistakes: string[];
}

export interface QuizSlide extends BaseSlide {
  visualType: "quiz";
  quiz: QuizQuestion[];
}

export type Slide =
  | AnatomySlide
  | DiseaseJourneySlide
  | PathophysiologyCascadeSlide
  | ClinicalSignsSlide
  | DecisionTreeSlide
  | ComparisonMatrixSlide
  | ManagementSlide
  | PearlsSlide
  | QuizSlide;

export interface PresentationDeck {
  id: string;
  title: string;
  slides: Slide[];
}
