import {
  Activity,
  AlertTriangle,
  Baby,
  BarChart3,
  Bone,
  Brain,
  Bug,
  CheckCircle2,
  Clock,
  Droplet,
  Ear,
  Eye,
  Flame,
  HeartCrack,
  HeartPulse,
  Hourglass,
  Microscope,
  Pill,
  ScanLine,
  Shield,
  ShieldAlert,
  Siren,
  Skull,
  Stethoscope,
  Syringe,
  TestTube,
  Thermometer,
  Waves,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Resolves the kebab-case icon-name strings stored in Supabase (e.g.
 * "heart-pulse") to an actual Lucide component. Originally 12 entries for
 * GastriteCasCliniqueStudio's fixed icon/color palette (ICON_TONE_NOTES in
 * lib/prompts/public-course-sections.ts) — extended (additively, the
 * original 12 unchanged) for the Mind Map's per-node icon tagging, which
 * needs a much richer vocabulary since every node gets its own specific
 * icon rather than one icon per section.
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
  brain: Brain,
  thermometer: Thermometer,
  syringe: Syringe,
  microscope: Microscope,
  ear: Ear,
  eye: Eye,
  droplet: Droplet,
  clock: Clock,
  skull: Skull,
  waves: Waves,
  baby: Baby,
  bone: Bone,
  "test-tube": TestTube,
  siren: Siren,
  "scan-line": ScanLine,
  "heart-crack": HeartCrack,
  "shield-alert": ShieldAlert,
  hourglass: Hourglass,
};

export function resolveLucideIcon(name: string): LucideIcon {
  return LUCIDE_ICON_LOOKUP[name] ?? Stethoscope;
}
