"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  BookOpen,
  Brain,
  CreditCard,
  FileQuestion,
  FileText,
  FolderOpen,
  LayoutDashboard,
  ListTodo,
  Mic,
  MoonStar,
  NotebookPen,
  Settings,
  Sparkles,
  Timer,
  Users,
} from "lucide-react";
import { CommandPalette, type CommandItem } from "@/components/course/workspace/os/CommandPalette";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useLanguage } from "@/providers/LanguageProvider";
import { useLanguageStore } from "@/store/useLanguageStore";
import { useCockpitStore } from "@/store/useCockpitStore";
import { useCockpitUi } from "@/store/useCockpitUi";
import { LAB_TOOLS } from "@/lib/workspace-lab";
import { translateCurriculumName } from "@/lib/translations/curriculumNames";
import { tCockpit } from "@/lib/translations/cockpit";
import { ASSISTANT_PREFILL_KEY } from "@/lib/dashboard/assistant-prefill";

const GROUPS = {
  fr: { ask: "Assistant IA", nav: "Navigation", lab: "MedArt Lab", courses: "Cours", modules: "Modules", notes: "Notes", audio: "Smart Notes audio", prefs: "Préférences" },
  en: { ask: "AI assistant", nav: "Navigation", lab: "MedArt Lab", courses: "Courses", modules: "Modules", notes: "Notes", audio: "Audio smart notes", prefs: "Preferences" },
} as const;

const PREFETCH_ON_OPEN = [
  "/dashboard",
  "/dashboard/assistant",
  "/dashboard/study",
  "/dashboard/todo",
  "/dashboard/notes",
  "/dashboard/groups",
  "/dashboard/billing",
  "/dashboard/settings",
  "/dashboard/audio-workspace",
];

/**
 * Global ⌘K / Ctrl+K Spotlight for the dashboard shell: every page, every
 * course, module, note, audio note and Lab tool of the student, plus a
 * direct "ask the assistant" with whatever was typed. Reuses the module
 * workspace's CommandPalette (fuzzy search, keyboard navigation, portal).
 * The module workspace is outside this shell and keeps its own Ctrl+K.
 */
export function Spotlight() {
  const router = useRouter();
  const { language, setLanguage } = useLanguage();
  const setAiLanguage = useLanguageStore((state) => state.setLanguage);
  const { resolvedTheme, setTheme } = useTheme();
  const overview = useCockpitStore((state) => state.overview);
  const open = useCockpitUi((state) => state.spotlightOpen);
  const setOpen = useCockpitUi((state) => state.setSpotlightOpen);
  const openLauncher = useCockpitUi((state) => state.openLauncher);
  const [query, setQuery] = useState("");

  useHotkeys([{ combo: "mod+k", allowInInputs: true, handler: () => setOpen(!useCockpitUi.getState().spotlightOpen) }]);

  const g = GROUPS[language];

  // Warm every top-level page while the palette is open, so picking one switches instantly.
  useEffect(() => {
    if (!open) return;
    for (const href of PREFETCH_ON_OPEN) router.prefetch(href);
  }, [open, router]);

  const items = useMemo<CommandItem[]>(() => {
    const go = (href: string) => () => router.push(href);
    const list: CommandItem[] = [
      { id: "nav-dashboard", group: g.nav, label: tCockpit("navDashboard", language), icon: LayoutDashboard, keywords: ["accueil", "home", "cockpit"], run: go("/dashboard") },
      { id: "nav-assistant", group: g.nav, label: tCockpit("navAssistant", language), icon: Sparkles, keywords: ["copilot", "chat", "ia"], run: go("/dashboard/assistant") },
      { id: "nav-flashcards", group: g.nav, label: tCockpit("navFlashcards", language), icon: Brain, keywords: ["anki", "cartes", "batch 50"], run: go("/dashboard/study?tab=flashcards") },
      { id: "nav-pomodoro", group: g.nav, label: tCockpit("navPomodoro", language), icon: Timer, keywords: ["focus", "timer", "chrono"], run: go("/dashboard/study?tab=session") },
      { id: "nav-todo", group: g.nav, label: tCockpit("navTodo", language), icon: ListTodo, keywords: ["planning", "planner", "tâches"], run: go("/dashboard/todo") },
      { id: "nav-notes", group: g.nav, label: tCockpit("navNotes", language), icon: NotebookPen, run: go("/dashboard/notes") },
      { id: "nav-groups", group: g.nav, label: tCockpit("navGroups", language), icon: Users, keywords: ["communauté", "chat"], run: go("/dashboard/groups") },
      { id: "nav-billing", group: g.nav, label: tCockpit("navBilling", language), icon: CreditCard, keywords: ["quota", "abonnement", "plan"], run: go("/dashboard/billing") },
      { id: "nav-settings", group: g.nav, label: tCockpit("navSettings", language), icon: Settings, run: go("/dashboard/settings") },
      { id: "nav-audio", group: g.lab, label: tCockpit("navAudio", language), description: tCockpit("navAudioHint", language), icon: Mic, keywords: ["enregistrement", "cours audio"], run: go("/dashboard/audio-workspace") },
      ...LAB_TOOLS.map<CommandItem>((tool) => ({
        id: `lab-${tool.id}`,
        group: g.lab,
        label: tCockpit(`lab_${tool.id}`, language),
        description: tCockpit("labPickCourse", language),
        icon: tool.icon,
        keywords: tool.keywords,
        run: () => openLauncher({ kind: "lab", tool: tool.id }),
      })),
      { id: "lab-exam", group: g.lab, label: tCockpit("navEvaluation", language), description: tCockpit("labPickModule", language), icon: FileQuestion, keywords: ["qcm", "examen", "test"], run: () => openLauncher({ kind: "exam" }) },
      {
        id: "pref-language",
        group: g.prefs,
        label: language === "fr" ? "Switch to English (interface + AI)" : "Passer en français (interface + IA)",
        icon: Sparkles,
        keywords: ["langue", "language", "english", "français"],
        run: () => {
          const next = language === "fr" ? "en" : "fr";
          setLanguage(next);
          setAiLanguage(next);
        },
      },
      {
        id: "pref-theme",
        group: g.prefs,
        label: resolvedTheme === "dark" ? tCockpit("themeToLight", language) : tCockpit("themeToDark", language),
        icon: MoonStar,
        keywords: ["thème", "theme", "dark", "sombre", "clair"],
        run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
      },
    ];

    if (overview) {
      const moduleSeen = new Set<number>();
      for (const course of overview.courses) {
        list.push({
          id: `course-${course.id}`,
          group: g.courses,
          label: course.title,
          description: course.moduleTitle ? translateCurriculumName(course.moduleTitle, language) : undefined,
          icon: BookOpen,
          run: go(`/dashboard/module/${course.moduleId}?course=${course.id}`),
        });
        if (!moduleSeen.has(course.moduleId) && course.moduleTitle) {
          moduleSeen.add(course.moduleId);
          list.push({
            id: `module-${course.moduleId}`,
            group: g.modules,
            label: translateCurriculumName(course.moduleTitle, language),
            icon: FolderOpen,
            run: go(`/dashboard/module/${course.moduleId}`),
          });
        }
      }
      for (const note of overview.notes) {
        list.push({ id: `note-${note.id}`, group: g.notes, label: note.title || tCockpit("untitledNote", language), icon: FileText, run: go("/dashboard/notes") });
      }
      for (const job of overview.lectureNotes) {
        list.push({ id: `audio-${job.id}`, group: g.audio, label: job.title, icon: Mic, run: go(`/dashboard/audio-workspace?jobId=${job.id}`) });
      }
    }

    const trimmed = query.trim();
    if (trimmed) {
      // Always first while typing: the free-text question goes to the assistant (pre-filled, not sent).
      list.unshift({
        id: "ask-assistant",
        group: g.ask,
        label: `${tCockpit("askAssistant", language)} « ${trimmed.slice(0, 80)} »`,
        icon: Sparkles,
        keywords: [trimmed],
        run: () => {
          // Handed over in sessionStorage, not the URL: a student's question never lands in server logs or history.
          try {
            sessionStorage.setItem(ASSISTANT_PREFILL_KEY, trimmed.slice(0, 4000));
          } catch {
            // Storage blocked: the assistant simply opens empty.
          }
          router.push("/dashboard/assistant");
        },
      });
    }
    return list;
  }, [g, language, overview, query, resolvedTheme, router, openLauncher, setAiLanguage, setLanguage, setTheme]);

  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      items={items}
      groupOrder={[g.ask, g.nav, g.lab, g.courses, g.modules, g.notes, g.audio, g.prefs]}
      placeholder={tCockpit("spotlightPlaceholder", language)}
      onQueryChange={setQuery}
    />
  );
}
