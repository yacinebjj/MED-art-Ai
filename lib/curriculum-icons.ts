import {
  Activity,
  Atom,
  Baby,
  Bone,
  BookOpen,
  Brain,
  Briefcase,
  Bug,
  Building2,
  Calculator,
  ClipboardList,
  Dna,
  Droplet,
  Ear,
  Eye,
  Factory,
  FlaskConical,
  Flower2,
  Globe,
  GraduationCap,
  Heart,
  Landmark,
  Languages,
  Leaf,
  type LucideIcon,
  Microscope,
  Pill,
  Scale,
  Scissors,
  ShieldAlert,
  ShieldPlus,
  Siren,
  Smile,
  Sparkles,
  Stethoscope,
  TestTube,
  Users,
  UserRound,
} from "lucide-react";

/**
 * Ordered keyword -> icon table, most specific first. Matched against the
 * module title lowercased with accents stripped, so "Épidémiologie" and
 * "epidemiologie" hit the same rule. First match wins; falls back to
 * Stethoscope (a generic medical default, never a broken/missing icon).
 */
const ICON_RULES: { keywords: string[]; icon: LucideIcon }[] = [
  { keywords: ["stage internat", "internat"], icon: GraduationCap },
  { keywords: ["cardio"], icon: Heart },
  { keywords: ["neuro"], icon: Brain },
  { keywords: ["psychiatr"], icon: UserRound },
  { keywords: ["psycholog"], icon: UserRound },
  { keywords: ["hemato", "hemobiologie", "sang"], icon: Droplet },
  { keywords: ["urolog", "nephro"], icon: Droplet },
  { keywords: ["immunolog"], icon: ShieldPlus },
  { keywords: ["parasitolog"], icon: Bug },
  { keywords: ["microbiolog"], icon: Bug },
  { keywords: ["infectiolog"], icon: Bug },
  { keywords: ["genetique"], icon: Dna },
  { keywords: ["anatomie pathologique"], icon: Microscope },
  { keywords: ["histolog"], icon: Microscope },
  { keywords: ["biologie cellulaire"], icon: Microscope },
  { keywords: ["anatomie"], icon: Bone },
  { keywords: ["orthoped"], icon: Bone },
  { keywords: ["rhumatolog"], icon: Bone },
  { keywords: ["physiolog"], icon: Activity },
  { keywords: ["pneumo", "respiratoire"], icon: Activity },
  { keywords: ["urgence"], icon: Siren },
  { keywords: ["pharmacolog"], icon: Pill },
  { keywords: ["therapeutique"], icon: Pill },
  { keywords: ["toxicolog"], icon: ShieldAlert },
  { keywords: ["gyneco"], icon: Flower2 },
  { keywords: ["pediatr"], icon: Baby },
  { keywords: ["dermatolog"], icon: Sparkles },
  { keywords: ["ophtalmolog"], icon: Eye },
  { keywords: ["orl"], icon: Ear },
  { keywords: ["epidemiolog", "hydro-bromatologie", "hydro bromatologie"], icon: Globe },
  { keywords: ["medecine legale", "droit"], icon: Scale },
  { keywords: ["medecine de travail", "gestion"], icon: Briefcase },
  { keywords: ["economie"], icon: Landmark },
  { keywords: ["prothese", "odontolog", "parodont", "dento", "dentaire", "buccal", "implantolog"], icon: Smile },
  { keywords: ["chirurgie"], icon: Scissors },
  { keywords: ["hospitaliere"], icon: Building2 },
  { keywords: ["industrielle"], icon: Factory },
  { keywords: ["clinique"], icon: Stethoscope },
  { keywords: ["biochimie"], icon: FlaskConical },
  { keywords: ["galenique", "pharmacognosie", "botanique", "biologie vegetale"], icon: Leaf },
  { keywords: ["chimie"], icon: TestTube },
  { keywords: ["biophysique", "physique"], icon: Atom },
  { keywords: ["biomathematiques", "biostatistiques", "statistiques"], icon: Calculator },
  { keywords: ["histoire", "culture generale"], icon: BookOpen },
  { keywords: ["anglais", "francais", "terminologie"], icon: Languages },
  { keywords: ["sante sociale", "sciences humaines"], icon: Users },
  { keywords: ["semiologie"], icon: ClipboardList },
];

// eslint-disable-next-line no-misleading-character-class -- deliberately matches the Unicode combining-diacritical-marks block (U+0300-U+036F) left behind by String.normalize("NFD"), e.g. turning "é" into "e" + a combining accent this regex then strips.
const COMBINING_DIACRITICS = /[̀-ͯ]/g;

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(COMBINING_DIACRITICS, "");
}

/** Picks a Lucide icon for a module title by keyword match — never throws, always returns a renderable icon. */
export function getModuleIcon(title: string): LucideIcon {
  const normalized = normalize(title);
  for (const rule of ICON_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.icon;
    }
  }
  return Stethoscope;
}
