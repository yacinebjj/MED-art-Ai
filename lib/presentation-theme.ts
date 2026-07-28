import { Bone, HeartPulse, Microscope, Pill, Scissors, Stethoscope, type LucideIcon } from "lucide-react";
import type { MedicalDomain, SlideTheme } from "@/lib/presentation-types";

interface ThemeStyle {
  border: string;
  badgeBg: string;
  badgeText: string;
  gradient: string;
  dot: string;
}

/** The enforced Tailwind color tokens per slide theme — kept in one place so every component (canvas, TOC, control bar) stays visually consistent. */
export const SLIDE_THEME_STYLES: Record<SlideTheme, ThemeStyle> = {
  blue: {
    border: "border-blue-200",
    badgeBg: "bg-blue-50",
    badgeText: "text-blue-700",
    gradient: "from-blue-600 to-blue-500",
    dot: "bg-blue-500",
  },
  red: {
    border: "border-red-200",
    badgeBg: "bg-red-50",
    badgeText: "text-red-700",
    gradient: "from-red-600 to-rose-500",
    dot: "bg-red-500",
  },
  amber: {
    border: "border-amber-200",
    badgeBg: "bg-amber-50",
    badgeText: "text-amber-700",
    gradient: "from-amber-500 to-orange-500",
    dot: "bg-amber-500",
  },
  purple: {
    border: "border-purple-200",
    badgeBg: "bg-purple-50",
    badgeText: "text-purple-700",
    gradient: "from-purple-600 to-violet-500",
    dot: "bg-purple-500",
  },
  emerald: {
    border: "border-emerald-200",
    badgeBg: "bg-emerald-50",
    badgeText: "text-emerald-700",
    gradient: "from-emerald-600 to-teal-500",
    dot: "bg-emerald-500",
  },
  slate: {
    border: "border-slate-200",
    badgeBg: "bg-slate-100",
    badgeText: "text-slate-700",
    gradient: "from-slate-700 to-slate-600",
    dot: "bg-slate-500",
  },
};

export const DOMAIN_ICON: Record<MedicalDomain, LucideIcon> = {
  anatomy: Bone,
  physiology: HeartPulse,
  pathology: Microscope,
  pharmacology: Pill,
  surgery: Scissors,
  clinical: Stethoscope,
};

export const DOMAIN_LABEL: Record<MedicalDomain, string> = {
  anatomy: "Anatomie",
  physiology: "Physiologie",
  pathology: "Pathologie",
  pharmacology: "Pharmacologie",
  surgery: "Chirurgie",
  clinical: "Clinique",
};
