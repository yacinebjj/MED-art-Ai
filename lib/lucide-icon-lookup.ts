import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bug,
  CheckCircle2,
  Flame,
  HeartPulse,
  Pill,
  Shield,
  Stethoscope,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Resolves the kebab-case icon-name strings stored in Supabase (e.g.
 * "heart-pulse") to an actual Lucide component. Shared by
 * GastriteVisualStudio and GastriteCasCliniqueStudio, whose JSON data
 * carries icons as strings rather than component references.
 */
const LUCIDE_ICON_LOOKUP: Record<string, LucideIcon> = {
  shield: Shield,
  bug: Bug,
  pill: Pill,
  flame: Flame,
  stethoscope: Stethoscope,
  activity: Activity,
  "alert-triangle": AlertTriangle,
  "bar-chart-3": BarChart3,
  "check-circle-2": CheckCircle2,
  wind: Wind,
  zap: Zap,
  "heart-pulse": HeartPulse,
};

export function resolveLucideIcon(name: string): LucideIcon {
  return LUCIDE_ICON_LOOKUP[name] ?? Stethoscope;
}
