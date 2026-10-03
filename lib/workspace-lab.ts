import { Brain, Network, Stethoscope, Table2, type LucideIcon } from "lucide-react";

/**
 * "MedArt Lab" — the interactive tools that live under the 7 Studio tiles in
 * the module workspace's right pane (components/course/workspace/lab/*).
 * Unlike a Studio tile, a Lab tool is an interactive engine, not a single
 * generated document: each owns its own API route and its own state.
 */
export type LabToolId = "case-simulator" | "matrix" | "mindmap";

export interface LabToolDescriptor {
  id: LabToolId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Literal Tailwind classes (the JIT scanner must see them verbatim). */
  tint: { bg: string; icon: string };
  /** Whether opening it can spend a plan generation (shown as a hint on the card). */
  usesQuota: boolean;
  keywords: string[];
}

export const LAB_TOOLS: LabToolDescriptor[] = [
  {
    id: "case-simulator",
    label: "Patient virtuel",
    description: "Cas clinique interactif : examens, diagnostic, score",
    icon: Stethoscope,
    tint: { bg: "bg-rose-50/80 border-rose-200/60 dark:bg-rose-950/20 dark:border-rose-900/40", icon: "text-rose-600 dark:text-rose-400" },
    usesQuota: true,
    keywords: ["simulateur", "cas clinique", "ecn", "diagnostic", "patient"],
  },
  {
    id: "matrix",
    label: "Matrice Pharmaco / DDx",
    description: "Tableaux comparatifs triables et exportables",
    icon: Table2,
    tint: { bg: "bg-violet-50/80 border-violet-200/60 dark:bg-violet-950/20 dark:border-violet-900/40", icon: "text-violet-600 dark:text-violet-400" },
    usesQuota: true,
    keywords: ["pharmacologie", "molecules", "diagnostic differentiel", "tableau", "comparatif"],
  },
  {
    id: "mindmap",
    label: "Carte mentale",
    description: "Étiologies → mécanismes → clinique → traitement",
    icon: Network,
    tint: { bg: "bg-cyan-50/80 border-cyan-200/60 dark:bg-cyan-950/20 dark:border-cyan-900/40", icon: "text-cyan-600 dark:text-cyan-400" },
    usesQuota: true,
    keywords: ["mind map", "schema", "physiopathologie", "arbre"],
  },
];

export const LAB_HEADING_ICON = Brain;

export function getLabTool(id: LabToolId): LabToolDescriptor {
  const tool = LAB_TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Unknown lab tool: ${id}`);
  return tool;
}
