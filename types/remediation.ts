export type RemediationPriority = "haute" | "moyenne" | "basse";

export interface WeakSpot {
  concept: string;
  courseTitle: string;
  priority: RemediationPriority;
  whyItMatters: string;
  actionableAdvice: string;
}

export interface RemediationPlan {
  weakSpots: WeakSpot[];
  generatedAt: string;
}
