/**
 * Guided tour ids and the routes that start them. Kept free of tour content
 * so the provider (lib/onboarding/onboarding-context.tsx, mounted on every
 * /dashboard page) stays small: the steps themselves live in
 * lib/onboarding/tours.ts and load with the tour engine, only when a tour opens.
 */
export const TOUR_IDS = [
  "dashboard",
  "module",
  "exam",
  "exam-results",
  "synthesis",
  "assistant",
  "notes",
  "study",
  "pomodoro",
  "todo",
  "settings",
  "billing",
  "pool",
  "tool-explication",
  "tool-resume",
  "tool-cas",
  "tool-qcm",
  "tool-analogies",
  "tool-podcast",
  "tool-case",
  "tool-matrix",
  "tool-mindmap",
] as const;

export type TourId = (typeof TOUR_IDS)[number];

/** Page tours, by route — opened on the page's first visit. First match wins. */
const PAGE_TOURS: { tour: TourId; match: RegExp }[] = [
  { tour: "dashboard", match: /^\/dashboard$/ },
  { tour: "module", match: /^\/dashboard\/module\/[^/]+$/ },
  { tour: "exam", match: /^\/dashboard\/module\/[^/]+\/exam$/ },
  { tour: "synthesis", match: /^\/dashboard\/workspace\/module\/[^/]+$/ },
  { tour: "assistant", match: /^\/dashboard\/assistant$/ },
  { tour: "notes", match: /^\/dashboard\/notes$/ },
  { tour: "study", match: /^\/dashboard\/study$/ },
  { tour: "todo", match: /^\/dashboard\/todo$/ },
  { tour: "settings", match: /^\/dashboard\/settings$/ },
  { tour: "billing", match: /^\/dashboard\/billing$/ },
  { tour: "pool", match: /^\/dashboard\/billing\/pool\/[^/]+$/ },
];

/** The page tour of `pathname`, or null when the page has none. */
export function pageTourFor(pathname: string | null): TourId | null {
  if (!pathname) return null;
  return PAGE_TOURS.find((entry) => entry.match.test(pathname))?.tour ?? null;
}

/** Page tours close when their page is left; tool tours close when their tool view unmounts. */
export function isPageTour(tour: TourId): boolean {
  return PAGE_TOURS.some((entry) => entry.tour === tour);
}

/** Studio sections and Lab tools (their ids in lib/demo-content.ts and lib/workspace-lab.ts) → their tool tour. */
export const STUDIO_TOOL_TOURS: Partial<Record<string, TourId>> = {
  explication: "tool-explication",
  resume: "tool-resume",
  cas_clinique: "tool-cas",
  qcm: "tool-qcm",
  exemples_analogies: "tool-analogies",
  audio: "tool-podcast",
  "case-simulator": "tool-case",
  matrix: "tool-matrix",
  mindmap: "tool-mindmap",
};
