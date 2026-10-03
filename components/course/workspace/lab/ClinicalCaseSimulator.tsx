"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { AnimatePresence, animate, motion, useReducedMotion, type Transition } from "framer-motion";
import {
  Activity,
  Brain,
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  ClipboardList,
  FileText,
  FlaskConical,
  GraduationCap,
  HeartPulse,
  History,
  Hospital,
  Lightbulb,
  ListChecks,
  Loader2,
  Lock,
  MessageSquareText,
  Microscope,
  Play,
  RotateCcw,
  ScanLine,
  Send,
  Siren,
  Stethoscope,
  Target,
  TriangleAlert,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { buildRateLimitMessage } from "@/lib/rate-limit-message";
import { cn } from "@/lib/utils";

export interface ClinicalCaseSimulatorProps {
  courseId: number;
  courseTitle: string;
  /** Sends a free-text prompt to the workspace chat (the caller opens the chat view). */
  onAskInChat?: (prompt: string) => void;
}

/* ----------------------------------------------------------------------- */
/* Types — mirror app/api/studio/case-simulator/route.ts's response shapes  */
/* ----------------------------------------------------------------------- */

type Difficulty = "externe" | "interne" | "concours";
type ExamCategory = "clinique" | "biologie" | "imagerie" | "autre";
type Verdict = "correct" | "partiel" | "incorrect";

interface CaseExam {
  id: string;
  category: ExamCategory;
  label: string;
}

interface PublicCase {
  title: string;
  patient: { age: number; sexe: "F" | "M"; contexte: string };
  motif: string;
  anamnese: string;
  constantes: Array<{ label: string; value: string }>;
  exams: CaseExam[];
}

interface Correction {
  results: Record<string, string>;
  pertinentExamIds: string[];
  diagnostic: string;
  diagnosticsDifferentiels: string[];
  argumentsCles: string[];
  priseEnCharge: string[];
  piegeExamen: string;
}

interface Evaluation {
  score: number;
  diagnosisScore: number;
  efficiencyScore: number;
  verdict: Verdict;
  feedback: string;
  missedArguments: string[];
  correction: Correction;
  pertinentExamIds: string[];
}

interface ObtainedResult {
  examId: string;
  result: string;
  /** 1-based request order — shown as "#n" in the timeline. */
  order: number;
}

/** Everything persisted to sessionStorage — enough to resume a case exactly where it was left. */
interface CaseSnapshot {
  v: 1;
  courseId: number;
  startedAt: number;
  difficulty: Difficulty;
  caseData: PublicCase;
  token: string;
  obtained: ObtainedResult[];
  diagnosisDraft: string;
  reasoningDraft: string;
  evaluation: Evaluation | null;
  submittedDiagnosis: string | null;
  submittedReasoning: string | null;
}

interface ApiFailure {
  status: number;
  message: string;
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

interface SimulatorState {
  snapshot: CaseSnapshot | null;
  difficulty: Difficulty;
  starting: boolean;
  startError: ApiFailure | null;
  pendingExamIds: string[];
  submitting: boolean;
  caseError: ApiFailure | null;
}

/* ----------------------------------------------------------------------- */
/* Constants                                                                */
/* ----------------------------------------------------------------------- */

const ENDPOINT = "/api/studio/case-simulator";
const STORAGE_PREFIX = "medart:case-simulator:v1:";
/** Same lifetime as the server-side sealed token — an older snapshot could only ever fail with 410. */
const CASE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_DIAGNOSIS_CHARS = 600;
const MAX_REASONING_CHARS = 1500;

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const SPRING: Transition = { type: "spring", stiffness: 260, damping: 26 };
const SCREEN_MOTION = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 220, damping: 26 } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.15 } },
} as const;

const DIFFICULTY_OPTIONS: Array<{ id: Difficulty; label: string; description: string; icon: LucideIcon }> = [
  {
    id: "externe",
    label: "Externe",
    description: "Présentation typique, signes francs — idéal pour ancrer la sémiologie du cours.",
    icon: GraduationCap,
  },
  {
    id: "interne",
    label: "Interne",
    description: "Tableau moins typique, signes trompeurs et un différentiel crédible à éliminer.",
    icon: Hospital,
  },
  {
    id: "concours",
    label: "Concours",
    description: "Niveau résidanat : présentation atypique, examens tentants et vrais pièges d'examen.",
    icon: Siren,
  },
];

const DIFFICULTY_IDS: readonly Difficulty[] = DIFFICULTY_OPTIONS.map((option) => option.id);

const CATEGORY_ORDER: ExamCategory[] = ["clinique", "biologie", "imagerie", "autre"];

const CATEGORY_META: Record<ExamCategory, { label: string; icon: LucideIcon; chip: string }> = {
  clinique: {
    label: "Clinique",
    icon: Stethoscope,
    chip: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  },
  biologie: {
    label: "Biologie",
    icon: FlaskConical,
    chip: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  },
  imagerie: {
    label: "Imagerie",
    icon: ScanLine,
    chip: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300",
  },
  autre: {
    label: "Autre",
    icon: Activity,
    chip: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
};

const VERDICT_META: Record<Verdict, { label: string; icon: LucideIcon; badge: string }> = {
  correct: {
    label: "Diagnostic correct",
    icon: CircleCheck,
    badge: "bg-emerald-100 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-400/20",
  },
  partiel: {
    label: "Partiellement juste",
    icon: TriangleAlert,
    badge: "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-400/20",
  },
  incorrect: {
    label: "Diagnostic incorrect",
    icon: CircleX,
    badge: "bg-rose-100 text-rose-800 ring-rose-600/20 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-400/20",
  },
};

/** One honest line per thing the generation actually writes, in the order the case is built. Holds on the last line instead of looping. */
const LOADING_LINES = [
  "Lecture de ton cours…",
  "Choix du tableau clinique…",
  "Rédaction de l'anamnèse…",
  "Calibrage des constantes…",
  "Sélection des examens proposés…",
  "Rédaction des résultats d'examens…",
  "Mise sous scellés de la correction…",
];

const CASE_STEPS = ["Observation", "Examens", "Diagnostic"] as const;

/* ----------------------------------------------------------------------- */
/* Formatting helpers                                                       */
/* ----------------------------------------------------------------------- */

function formatAge(age: number): string {
  if (age < 2) {
    const months = Math.max(1, Math.round(age * 12));
    return `${months} mois`;
  }
  return `${Math.round(age)} ans`;
}

function formatSexe(sexe: "F" | "M", age: number): string {
  if (age < 15) return sexe === "F" ? "Fille" : "Garçon";
  return sexe === "F" ? "Femme" : "Homme";
}

function difficultyLabel(difficulty: Difficulty): string {
  return DIFFICULTY_OPTIONS.find((option) => option.id === difficulty)?.label ?? difficulty;
}

function scoreTone(score: number): { stroke: string; text: string } {
  if (score >= 70) return { stroke: "stroke-emerald-500", text: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 45) return { stroke: "stroke-amber-500", text: "text-amber-600 dark:text-amber-400" };
  return { stroke: "stroke-rose-500", text: "text-rose-600 dark:text-rose-400" };
}

function buildDebriefPrompt(courseTitle: string, snapshot: CaseSnapshot, evaluation: Evaluation): string {
  const { caseData } = snapshot;
  const labelOf = (id: string) => caseData.exams.find((exam) => exam.id === id)?.label ?? id;
  const requested = snapshot.obtained.map((item) => item.examId);
  const requestedSet = new Set(requested);
  const pertinent = new Set(evaluation.pertinentExamIds);
  const missed = evaluation.pertinentExamIds.filter((id) => !requestedSet.has(id)).map(labelOf);
  const useless = requested.filter((id) => !pertinent.has(id)).map(labelOf);
  const reasoning = snapshot.submittedReasoning?.trim();

  return [
    `Je viens de terminer un cas clinique simulé (niveau ${difficultyLabel(snapshot.difficulty)}) tiré de mon cours « ${courseTitle} ».`,
    `Cas : ${caseData.title} — ${formatSexe(caseData.patient.sexe, caseData.patient.age)}, ${formatAge(caseData.patient.age)}. ${caseData.patient.contexte} Motif : ${caseData.motif}`,
    `Examens que j'ai demandés : ${requested.length > 0 ? requested.map(labelOf).join(", ") : "aucun"}.`,
    missed.length > 0 ? `Examens pertinents que j'ai oubliés : ${missed.join(", ")}.` : "",
    useless.length > 0 ? `Examens non pertinents que j'ai demandés : ${useless.join(", ")}.` : "",
    `Mon diagnostic : « ${snapshot.submittedDiagnosis ?? ""} ».${reasoning ? ` Mon raisonnement : « ${reasoning.slice(0, 600)} ».` : ""}`,
    `Diagnostic attendu : ${evaluation.correction.diagnostic}. Mon score : ${evaluation.score}/100 (${VERDICT_META[evaluation.verdict].label.toLowerCase()}).`,
    "Fais-moi un débriefing détaillé de ce cas : le raisonnement attendu étape par étape, la sémiologie clé, l'interprétation de chaque examen pertinent, comment éliminer les diagnostics différentiels, la prise en charge, et le piège à retenir pour l'examen.",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ----------------------------------------------------------------------- */
/* Persistence (sessionStorage) + module-level store                        */
/*                                                                          */
/* State lives outside React on purpose: a case keeps progressing (start,   */
/* exam results, correction) even while the panel is unmounted by a tab     */
/* switch, and a remount picks up exactly where the requests left it.       */
/* ----------------------------------------------------------------------- */

function storageKey(courseId: number): string {
  return `${STORAGE_PREFIX}${courseId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCaseSnapshot(value: unknown, courseId: number): value is CaseSnapshot {
  if (!isRecord(value) || value.v !== 1 || value.courseId !== courseId) return false;
  if (typeof value.token !== "string" || typeof value.startedAt !== "number") return false;
  if (!DIFFICULTY_IDS.includes(value.difficulty as Difficulty)) return false;
  if (typeof value.diagnosisDraft !== "string" || typeof value.reasoningDraft !== "string") return false;
  if (!Array.isArray(value.obtained)) return false;
  if (value.evaluation !== null && !isRecord(value.evaluation)) return false;
  const caseData = value.caseData;
  if (!isRecord(caseData) || typeof caseData.title !== "string" || typeof caseData.motif !== "string") return false;
  if (typeof caseData.anamnese !== "string" || !isRecord(caseData.patient)) return false;
  return Array.isArray(caseData.constantes) && Array.isArray(caseData.exams);
}

function readSnapshot(courseId: number): CaseSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(courseId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isCaseSnapshot(parsed, courseId) || Date.now() - parsed.startedAt > CASE_MAX_AGE_MS) {
      window.sessionStorage.removeItem(storageKey(courseId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSnapshot(courseId: number, snapshot: CaseSnapshot | null): void {
  if (typeof window === "undefined") return;
  try {
    if (snapshot) window.sessionStorage.setItem(storageKey(courseId), JSON.stringify(snapshot));
    else window.sessionStorage.removeItem(storageKey(courseId));
  } catch {
    // Storage full or blocked (private mode) — the case keeps working in memory for this visit.
  }
}

function createInitialState(snapshot: CaseSnapshot | null): SimulatorState {
  return {
    snapshot,
    difficulty: snapshot?.difficulty ?? "interne",
    starting: false,
    startError: null,
    pendingExamIds: [],
    submitting: false,
    caseError: null,
  };
}

const SERVER_STATE = createInitialState(null);
const stores = new Map<number, SimulatorState>();
const listeners = new Map<number, Set<() => void>>();

function getStore(courseId: number): SimulatorState {
  let state = stores.get(courseId);
  if (!state) {
    state = createInitialState(readSnapshot(courseId));
    stores.set(courseId, state);
  }
  return state;
}

function updateStore(courseId: number, updater: (previous: SimulatorState) => SimulatorState): void {
  const previous = getStore(courseId);
  const next = updater(previous);
  if (next === previous) return;
  stores.set(courseId, next);
  if (next.snapshot !== previous.snapshot) writeSnapshot(courseId, next.snapshot);
  listeners.get(courseId)?.forEach((listener) => listener());
}

function subscribeStore(courseId: number, listener: () => void): () => void {
  let set = listeners.get(courseId);
  if (!set) {
    set = new Set();
    listeners.set(courseId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

/* ----------------------------------------------------------------------- */
/* API calls                                                                */
/* ----------------------------------------------------------------------- */

function fallbackMessage(status: number): string {
  if (status === 401) return "Ta session a expiré — reconnecte-toi puis réessaie.";
  if (status === 504) return "Le modèle IA met trop de temps à répondre. Réessaie dans un instant.";
  return "Une erreur est survenue. Réessaie dans un instant.";
}

async function postSimulator<T>(payload: Record<string, unknown>): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, failure: { status: 0, message: "Connexion impossible — vérifie ta connexion internet et réessaie." } };
  }

  const data: unknown = await res.json().catch(() => null);
  if (res.status === 429) {
    return { ok: false, failure: { status: 429, message: buildRateLimitMessage(res) } };
  }
  if (!res.ok || !isRecord(data) || data.success !== true) {
    const message = isRecord(data) && typeof data.error === "string" && data.error ? data.error : fallbackMessage(res.status);
    return { ok: false, failure: { status: res.status, message } };
  }
  return { ok: true, data: data as T };
}

const UNEXPECTED_RESPONSE: ApiFailure = { status: 502, message: "Réponse inattendue du serveur. Réessaie." };

async function startCase(courseId: number): Promise<void> {
  const current = getStore(courseId);
  if (current.starting || current.snapshot) return;
  const difficulty = current.difficulty;
  updateStore(courseId, (state) => ({ ...state, starting: true, startError: null }));

  const result = await postSimulator<{ case: PublicCase; token: string }>({ action: "start", courseId, difficulty });

  updateStore(courseId, (state) => {
    if (!result.ok) return { ...state, starting: false, startError: result.failure };
    const { case: caseData, token } = result.data;
    if (!isRecord(caseData) || !Array.isArray(caseData.exams) || typeof token !== "string") {
      return { ...state, starting: false, startError: UNEXPECTED_RESPONSE };
    }
    return {
      ...createInitialState({
        v: 1,
        courseId,
        startedAt: Date.now(),
        difficulty,
        caseData,
        token,
        obtained: [],
        diagnosisDraft: "",
        reasoningDraft: "",
        evaluation: null,
        submittedDiagnosis: null,
        submittedReasoning: null,
      }),
    };
  });
}

async function requestExam(courseId: number, examId: string): Promise<void> {
  const current = getStore(courseId);
  const snapshot = current.snapshot;
  if (!snapshot || snapshot.evaluation || current.submitting) return;
  if (current.pendingExamIds.includes(examId) || snapshot.obtained.some((item) => item.examId === examId)) return;

  const token = snapshot.token;
  updateStore(courseId, (state) => ({ ...state, pendingExamIds: [...state.pendingExamIds, examId], caseError: null }));

  const result = await postSimulator<{ examId: string; result: string }>({ action: "exam", courseId, token, examId });

  updateStore(courseId, (state) => {
    const pendingExamIds = state.pendingExamIds.filter((id) => id !== examId);
    // The case was abandoned or replaced while this request was in flight — drop the stale answer.
    if (!state.snapshot || state.snapshot.token !== token) return { ...state, pendingExamIds };
    // Already graded: the correction was computed without this exam, so
    // appending it now would rewrite the history the score was based on.
    if (state.snapshot.evaluation) return { ...state, pendingExamIds };
    if (!result.ok) return { ...state, pendingExamIds, caseError: result.failure };
    if (typeof result.data.result !== "string") return { ...state, pendingExamIds, caseError: UNEXPECTED_RESPONSE };
    if (state.snapshot.obtained.some((item) => item.examId === examId)) return { ...state, pendingExamIds };
    const obtained = [...state.snapshot.obtained, { examId, result: result.data.result, order: state.snapshot.obtained.length + 1 }];
    return { ...state, pendingExamIds, snapshot: { ...state.snapshot, obtained } };
  });
}

async function submitDiagnosis(courseId: number): Promise<void> {
  const current = getStore(courseId);
  const snapshot = current.snapshot;
  if (!snapshot || snapshot.evaluation || current.submitting) return;
  // An exam still in flight would be missing from requestedExamIds and land after grading — wait for it.
  if (current.pendingExamIds.length > 0) return;
  const diagnosis = snapshot.diagnosisDraft.trim();
  const reasoning = snapshot.reasoningDraft.trim();
  if (!diagnosis) return;

  const token = snapshot.token;
  updateStore(courseId, (state) => ({ ...state, submitting: true, caseError: null }));

  const result = await postSimulator<Evaluation>({
    action: "diagnose",
    courseId,
    token,
    diagnosis,
    reasoning: reasoning || undefined,
    requestedExamIds: snapshot.obtained.map((item) => item.examId),
  });

  updateStore(courseId, (state) => {
    if (!state.snapshot || state.snapshot.token !== token) return { ...state, submitting: false };
    if (!result.ok) return { ...state, submitting: false, caseError: result.failure };
    const evaluation = result.data;
    if (typeof evaluation.score !== "number" || !isRecord(evaluation.correction)) {
      return { ...state, submitting: false, caseError: UNEXPECTED_RESPONSE };
    }
    return {
      ...state,
      submitting: false,
      pendingExamIds: [],
      snapshot: { ...state.snapshot, evaluation, submittedDiagnosis: diagnosis, submittedReasoning: reasoning || null },
    };
  });
}

function resetCase(courseId: number): void {
  updateStore(courseId, (state) => ({ ...createInitialState(null), difficulty: state.difficulty }));
}

function setDifficulty(courseId: number, difficulty: Difficulty): void {
  updateStore(courseId, (state) => (state.difficulty === difficulty ? state : { ...state, difficulty }));
}

function updateDraft(courseId: number, field: "diagnosisDraft" | "reasoningDraft", value: string): void {
  updateStore(courseId, (state) => {
    const snapshot = state.snapshot;
    if (!snapshot || snapshot.evaluation) return state;
    return {
      ...state,
      snapshot: field === "diagnosisDraft" ? { ...snapshot, diagnosisDraft: value } : { ...snapshot, reasoningDraft: value },
    };
  });
}

function dismissErrors(courseId: number): void {
  updateStore(courseId, (state) => (state.startError || state.caseError ? { ...state, startError: null, caseError: null } : state));
}

/* ----------------------------------------------------------------------- */
/* Small building blocks                                                    */
/* ----------------------------------------------------------------------- */

function IconButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            FOCUS_RING,
            className
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function SectionCard({
  icon: Icon,
  title,
  aside,
  children,
  className,
  delay = 0,
}: {
  icon: LucideIcon;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay }}
      className={cn("glass-card min-w-0 rounded-2xl p-3.5 shadow-soft sm:p-4", className)}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h4 className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary-700 dark:text-primary-300">
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{title}</span>
        </h4>
        {aside}
      </div>
      {children}
    </motion.section>
  );
}

function ErrorBanner({ failure, onDismiss, action }: { failure: ApiFailure; onDismiss?: () => void; action?: ReactNode }) {
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={SPRING}
      className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="break-words leading-relaxed">{failure.message}</p>
        {action}
      </div>
      {onDismiss && (
        <IconButton label="Masquer l'erreur" onClick={onDismiss} className="-mr-1 -mt-1 h-7 w-7 text-rose-700 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-900/40">
          <X className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </motion.div>
  );
}

function CharCounter({ length, max }: { length: number; max: number }) {
  return (
    <span className={cn("text-[11px] tabular-nums", length >= max * 0.9 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
      {length}/{max}
    </span>
  );
}

/* ----------------------------------------------------------------------- */
/* Setup screen                                                             */
/* ----------------------------------------------------------------------- */

function DifficultyPicker({ value, onChange, disabled }: { value: Difficulty; onChange: (value: Difficulty) => void; disabled: boolean }) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const descriptionId = useId();
  const indicatorId = useId();
  const selected = DIFFICULTY_OPTIONS.find((option) => option.id === value) ?? DIFFICULTY_OPTIONS[0];

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = DIFFICULTY_OPTIONS.length;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % count;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next < 0) return;
    event.preventDefault();
    onChange(DIFFICULTY_OPTIONS[next].id);
    buttonsRef.current[next]?.focus();
  }

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Niveau de difficulté"
        aria-describedby={descriptionId}
        className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-slate-100/80 p-1 dark:bg-slate-900/60"
      >
        {DIFFICULTY_OPTIONS.map((option, index) => {
          const isSelected = option.id === value;
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              ref={(element) => {
                buttonsRef.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                "relative min-w-0 rounded-xl px-1.5 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                FOCUS_RING,
                isSelected ? "text-primary-700 dark:text-primary-200" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isSelected && (
                <motion.span
                  layoutId={indicatorId}
                  transition={SPRING}
                  className="absolute inset-0 rounded-xl bg-white shadow-soft ring-1 ring-primary-500/20 dark:bg-slate-800 dark:ring-primary-400/20"
                  aria-hidden
                />
              )}
              <span className="relative flex flex-col items-center gap-1">
                <Icon className="h-4 w-4" aria-hidden />
                <span className="truncate">{option.label}</span>
              </span>
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={selected.id}
          id={descriptionId}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="mt-2 min-h-[2.5rem] px-1 text-[13px] leading-snug text-muted-foreground"
        >
          <span className="font-semibold text-foreground">{selected.label} — </span>
          {selected.description}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function SetupScreen({
  courseTitle,
  state,
  onDifficultyChange,
  onStart,
  onDismissError,
}: {
  courseTitle: string;
  state: SimulatorState;
  onDifficultyChange: (value: Difficulty) => void;
  onStart: () => void;
  onDismissError: () => void;
}) {
  const steps: Array<{ icon: LucideIcon; text: string }> = [
    { icon: ClipboardList, text: "Lis l'observation : motif, anamnèse, constantes." },
    { icon: FlaskConical, text: "Demande les examens que tu juges utiles — chaque examen inutile coûte des points." },
    { icon: Brain, text: "Pose ton diagnostic et ton raisonnement : tu es noté sur 100." },
  ];

  return (
    <div className="space-y-3.5">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="glass-card relative overflow-hidden rounded-2xl p-4 shadow-soft"
      >
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary-400/20 blur-3xl dark:bg-primary-500/15"
          aria-hidden
        />
        <p className="relative text-[13px] leading-relaxed text-muted-foreground">
          Un patient virtuel construit uniquement à partir de ton cours{" "}
          <span className="font-semibold text-foreground">« {courseTitle} »</span>. Mène l'enquête comme en garde.
        </p>
        <ol className="relative mt-3 space-y-2">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.text} className="flex items-start gap-2.5 text-[13px] leading-snug">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-950/60 dark:text-primary-300">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="pt-0.5">
                  <span className="sr-only">Étape {index + 1} : </span>
                  {step.text}
                </span>
              </li>
            );
          })}
        </ol>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING, delay: 0.05 }}
        className="glass-card rounded-2xl p-4 shadow-soft"
      >
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-primary-700 dark:text-primary-300">Niveau du cas</p>
        <DifficultyPicker value={state.difficulty} onChange={onDifficultyChange} disabled={state.starting} />

        <Button type="button" size="lg" onClick={onStart} isLoading={state.starting} className="mt-3 w-full">
          {!state.starting && <Play className="h-4 w-4" aria-hidden />}
          Lancer le cas
        </Button>
        <p className="mt-2.5 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
          <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Le cas d'un cours n'est généré qu'une seule fois pour tous les étudiants : s'il existe déjà, le lancer est gratuit ; sinon il utilise 1 génération de ton forfait. Les examens et la correction sont inclus.
        </p>
      </motion.div>

      <AnimatePresence>
        {state.startError && (
          <ErrorBanner
            failure={state.startError}
            onDismiss={onDismissError}
            action={
              state.startError.status === 403 ? (
                <Link
                  href="/dashboard/billing"
                  className={cn("inline-flex items-center gap-1 rounded-md text-[13px] font-semibold underline underline-offset-2", FOCUS_RING)}
                >
                  Voir les formules
                </Link>
              ) : undefined
            }
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Loading screen                                                           */
/* ----------------------------------------------------------------------- */

function LoadingScreen({ difficulty }: { difficulty: Difficulty }) {
  const reduceMotion = useReducedMotion();
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setLineIndex((index) => Math.min(index + 1, LOADING_LINES.length - 1));
    }, 2600);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="glass-card overflow-hidden rounded-2xl p-5 shadow-soft">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary-700 dark:text-primary-300">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Préparation du cas · niveau {difficultyLabel(difficulty)}
      </div>

      <svg viewBox="0 0 200 60" className="mt-4 h-14 w-full text-primary-500" fill="none" aria-hidden>
        <path d="M0 30 H200" className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="1" />
        <motion.path
          d="M0 30 H44 L52 30 L58 10 L65 50 L71 22 L77 30 H124 L132 30 L138 10 L145 50 L151 22 L157 30 H200"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: reduceMotion ? 1 : 0 }}
          animate={{ pathLength: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 2.2, ease: "linear", repeat: Infinity, repeatDelay: 0.2 }}
        />
      </svg>

      <div role="status" aria-live="polite" className="mt-3 h-6 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={lineIndex}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="text-sm font-medium text-foreground"
          >
            {LOADING_LINES[lineIndex]}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="mt-4 space-y-2" aria-hidden>
        {["w-11/12", "w-4/5", "w-2/3"].map((width) => (
          <div
            key={width}
            className={cn(
              "h-2.5 animate-shimmer rounded-full bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 bg-[length:200%_100%] dark:from-slate-800 dark:via-slate-700 dark:to-slate-800",
              width
            )}
          />
        ))}
      </div>

      <p className="mt-4 text-[12px] leading-snug text-muted-foreground">
        Cela prend généralement moins d'une minute. Tu peux changer d'onglet : le cas t'attendra ici.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Case screen                                                              */
/* ----------------------------------------------------------------------- */

function CaseStepper({ step, examsCount, totalExams }: { step: number; examsCount: number; totalExams: number }) {
  return (
    <div className="rounded-2xl border border-border bg-white/70 dark:bg-slate-900/50 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
        <span className="truncate text-primary-700 dark:text-primary-300">
          Étape {step + 1}/{CASE_STEPS.length} · {CASE_STEPS[step]}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {examsCount}/{totalExams} examen{examsCount > 1 ? "s" : ""}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden>
        {CASE_STEPS.map((label, index) => (
          <div key={label} className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-600"
              initial={false}
              animate={{ width: index <= step ? "100%" : "0%" }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function PatientCard({ caseData }: { caseData: PublicCase }) {
  const { patient } = caseData;
  return (
    <motion.section
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={SPRING}
      className="glass-card relative min-w-0 overflow-hidden rounded-2xl p-4 shadow-soft"
    >
      <div className="pointer-events-none absolute -left-12 -top-12 h-32 w-32 rounded-full bg-primary-400/15 blur-3xl" aria-hidden />
      <div className="relative flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-glow">
          <UserRound className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary-700 dark:text-primary-300">Dossier patient</p>
          <h3 className="break-words font-heading text-[15px] font-semibold leading-snug text-foreground">{caseData.title}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[formatSexe(patient.sexe, patient.age), formatAge(patient.age)].map((value) => (
              <span
                key={value}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                {value}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="relative mt-3 break-words text-[13px] leading-relaxed text-muted-foreground">{patient.contexte}</p>
      <div className="relative mt-3 rounded-xl border-l-4 border-primary-500 bg-primary-50/80 px-3 py-2 dark:bg-primary-950/30">
        <p className="text-[11px] font-bold uppercase tracking-wider text-primary-700 dark:text-primary-300">Motif de consultation</p>
        <p className="mt-0.5 break-words text-[13px] font-medium leading-relaxed text-foreground">{caseData.motif}</p>
      </div>
    </motion.section>
  );
}

function ExamButton({
  exam,
  done,
  pending,
  locked,
  onRequest,
}: {
  exam: CaseExam;
  done: boolean;
  pending: boolean;
  locked: boolean;
  onRequest: (examId: string) => void;
}) {
  const meta = CATEGORY_META[exam.category];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => onRequest(exam.id)}
      disabled={done || pending || locked}
      aria-label={done ? `${exam.label} — résultat déjà obtenu` : pending ? `${exam.label} — demande en cours` : `Demander : ${exam.label}`}
      className={cn(
        "flex min-h-[44px] w-full min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-[13px] font-medium transition-all duration-200 disabled:cursor-not-allowed",
        FOCUS_RING,
        done
          ? "border-primary-200 bg-primary-50/70 text-primary-800 dark:border-primary-900/60 dark:bg-primary-950/30 dark:text-primary-200"
          : "border-border bg-card text-foreground hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-soft dark:hover:border-primary-700",
        locked && !done && "opacity-60"
      )}
    >
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", meta.chip)}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 break-words leading-snug">{exam.label}</span>
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary-600 dark:text-primary-400" aria-hidden />
      ) : done ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-primary-600 dark:text-primary-400" aria-hidden />
      ) : null}
    </button>
  );
}

function ExamsPanel({
  exams,
  obtainedIds,
  pendingExamIds,
  locked,
  onRequest,
}: {
  exams: CaseExam[];
  obtainedIds: Set<string>;
  pendingExamIds: string[];
  locked: boolean;
  onRequest: (examId: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | ExamCategory>("all");
  const categories = CATEGORY_ORDER.filter((category) => exams.some((exam) => exam.category === category));
  const activeFilter = filter !== "all" && !categories.includes(filter) ? "all" : filter;
  const visible = activeFilter === "all" ? exams : exams.filter((exam) => exam.category === activeFilter);
  const filters: Array<{ id: "all" | ExamCategory; label: string; count: number }> = [
    { id: "all", label: "Tous", count: exams.length },
    ...categories.map((category) => ({
      id: category,
      label: CATEGORY_META[category].label,
      count: exams.filter((exam) => exam.category === category).length,
    })),
  ];

  return (
    <SectionCard
      icon={Microscope}
      title="Examens"
      delay={0.12}
      aside={<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{obtainedIds.size} demandé{obtainedIds.size > 1 ? "s" : ""}</span>}
    >
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer les examens par catégorie">
        {filters.map((option) => {
          const pressed = option.id === activeFilter;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={pressed}
              onClick={() => setFilter(option.id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors",
                FOCUS_RING,
                pressed
                  ? "border-primary-600 bg-primary-600 text-white shadow-soft dark:border-primary-500 dark:bg-primary-500 dark:text-primary-950"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
              <span className={cn("tabular-nums", pressed ? "opacity-80" : "opacity-60")}>{option.count}</span>
            </button>
          );
        })}
      </div>

      <motion.div layout className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map((exam) => (
            <motion.div
              key={exam.id}
              layout
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={SPRING}
              className="min-w-0"
            >
              <ExamButton
                exam={exam}
                done={obtainedIds.has(exam.id)}
                pending={pendingExamIds.includes(exam.id)}
                locked={locked}
                onRequest={onRequest}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
        <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" aria-hidden />
        Choisis comme en garde : chaque examen non pertinent fait baisser ta note de pertinence.
      </p>
    </SectionCard>
  );
}

function ResultsTimeline({ exams, obtained }: { exams: CaseExam[]; obtained: ObtainedResult[] }) {
  const ordered = [...obtained].sort((a, b) => b.order - a.order);
  return (
    <SectionCard icon={History} title="Résultats obtenus" delay={0.16}>
      {ordered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[13px] text-muted-foreground">
          Aucun examen demandé pour l'instant. Les résultats s'afficheront ici, du plus récent au plus ancien.
        </p>
      ) : (
        <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-border">
          <AnimatePresence initial={false}>
            {ordered.map((item) => {
              const exam = exams.find((candidate) => candidate.id === item.examId);
              const meta = CATEGORY_META[exam?.category ?? "autre"];
              const Icon = meta.icon;
              return (
                <motion.li
                  key={item.examId}
                  layout
                  initial={{ opacity: 0, y: -10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={SPRING}
                  className="relative flex min-w-0 gap-3"
                >
                  <span className={cn("relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-background", meta.chip)}>
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 rounded-xl border border-border bg-white/80 dark:bg-slate-900/60 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                      <p className="min-w-0 break-words text-[13px] font-semibold text-foreground">{exam?.label ?? item.examId}</p>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        #{item.order} · {meta.label}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-line break-words text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">{item.result}</p>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </SectionCard>
  );
}

function DiagnosisForm({
  snapshot,
  submitting,
  examsPending,
  onDiagnosisChange,
  onReasoningChange,
  onSubmit,
}: {
  snapshot: CaseSnapshot;
  submitting: boolean;
  /** True while at least one requested exam has not answered yet — grading now would ignore it. */
  examsPending: boolean;
  onDiagnosisChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const diagnosisId = useId();
  const reasoningId = useId();
  const hintId = useId();
  const canSubmit = snapshot.diagnosisDraft.trim().length > 0 && !submitting && !examsPending;
  const inputClass = cn(
    "w-full rounded-xl border border-input bg-white px-3 py-2.5 text-base text-foreground placeholder:text-slate-400 dark:bg-slate-950/60 dark:placeholder:text-slate-500 shadow-sm transition-colors sm:text-sm",
    "focus-visible:border-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60"
  );

  function handleReasoningKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && canSubmit) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <SectionCard icon={Target} title="Ton diagnostic" delay={0.2}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit();
        }}
        className="space-y-3"
        aria-describedby={hintId}
      >
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={diagnosisId} className="text-[13px] font-semibold text-foreground">
              Diagnostic principal
            </label>
            <CharCounter length={snapshot.diagnosisDraft.length} max={MAX_DIAGNOSIS_CHARS} />
          </div>
          <input
            id={diagnosisId}
            type="text"
            value={snapshot.diagnosisDraft}
            onChange={(event) => onDiagnosisChange(event.target.value)}
            maxLength={MAX_DIAGNOSIS_CHARS}
            disabled={submitting}
            autoComplete="off"
            spellCheck
            placeholder="Diagnostic précis : forme, étiologie, gravité…"
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={reasoningId} className="text-[13px] font-semibold text-foreground">
              Raisonnement <span className="font-normal text-muted-foreground">(conseillé)</span>
            </label>
            <CharCounter length={snapshot.reasoningDraft.length} max={MAX_REASONING_CHARS} />
          </div>
          <textarea
            id={reasoningId}
            value={snapshot.reasoningDraft}
            onChange={(event) => onReasoningChange(event.target.value)}
            onKeyDown={handleReasoningKeyDown}
            maxLength={MAX_REASONING_CHARS}
            disabled={submitting}
            rows={4}
            spellCheck
            placeholder="Arguments cliniques et paracliniques qui te font retenir ce diagnostic, et ce qui écarte les différentiels…"
            className={cn(inputClass, "min-h-[6.5rem] resize-y leading-relaxed")}
          />
        </div>

        <p id={hintId} className="text-[12px] leading-snug text-muted-foreground" aria-live="polite">
          {examsPending
            ? "Attends les résultats en cours… Tu pourras soumettre ton diagnostic dès qu'ils seront arrivés."
            : snapshot.obtained.length === 0
              ? "Tu n'as demandé aucun examen : la pertinence des examens comptera 0/30."
              : "Une fois soumis, le cas est corrigé et la correction complète s'affiche. Ctrl + Entrée pour envoyer depuis le raisonnement."}
        </p>

        <Button type="submit" size="lg" disabled={!canSubmit} isLoading={submitting} className="w-full">
          {!submitting && <Send className="h-4 w-4" aria-hidden />}
          {submitting ? "Correction en cours…" : "Soumettre mon diagnostic"}
        </Button>
      </form>
    </SectionCard>
  );
}

function CaseScreen({
  courseId,
  state,
  snapshot,
}: {
  courseId: number;
  state: SimulatorState;
  snapshot: CaseSnapshot;
}) {
  const { caseData } = snapshot;
  const obtainedIds = useMemo(() => new Set(snapshot.obtained.map((item) => item.examId)), [snapshot.obtained]);
  const step = snapshot.diagnosisDraft.trim().length > 0 ? 2 : snapshot.obtained.length > 0 ? 1 : 0;
  const caseIsDead = state.caseError !== null && [400, 403, 410].includes(state.caseError.status);

  const handleRequest = useCallback((examId: string) => void requestExam(courseId, examId), [courseId]);

  return (
    <div className="space-y-3.5">
      <CaseStepper step={step} examsCount={snapshot.obtained.length} totalExams={caseData.exams.length} />
      <PatientCard caseData={caseData} />

      <SectionCard icon={FileText} title="Anamnèse" delay={0.04}>
        <p className="whitespace-pre-line break-words text-[13px] leading-relaxed text-foreground">{caseData.anamnese}</p>
      </SectionCard>

      <SectionCard icon={HeartPulse} title="Constantes" delay={0.08}>
        <ul className="flex flex-wrap gap-1.5">
          {caseData.constantes.map((constante, index) => (
            <li
              key={`${constante.label}-${index}`}
              className="inline-flex min-w-0 max-w-full items-baseline gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5"
            >
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{constante.label}</span>
              <span className="min-w-0 break-words text-[13px] font-semibold tabular-nums text-foreground">{constante.value}</span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <ExamsPanel
        exams={caseData.exams}
        obtainedIds={obtainedIds}
        pendingExamIds={state.pendingExamIds}
        locked={state.submitting}
        onRequest={handleRequest}
      />

      <ResultsTimeline exams={caseData.exams} obtained={snapshot.obtained} />

      <AnimatePresence>
        {state.caseError && (
          <ErrorBanner
            failure={state.caseError}
            onDismiss={() => dismissErrors(courseId)}
            action={
              caseIsDead ? (
                <Button type="button" size="sm" variant="outline" onClick={() => resetCase(courseId)}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Rejouer un cas
                </Button>
              ) : undefined
            }
          />
        )}
      </AnimatePresence>

      <DiagnosisForm
        snapshot={snapshot}
        submitting={state.submitting}
        examsPending={state.pendingExamIds.length > 0}
        onDiagnosisChange={(value) => updateDraft(courseId, "diagnosisDraft", value)}
        onReasoningChange={(value) => updateDraft(courseId, "reasoningDraft", value)}
        onSubmit={() => void submitDiagnosis(courseId)}
      />
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Results screen                                                           */
/* ----------------------------------------------------------------------- */

function ScoreRing({ score }: { score: number }) {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(reduceMotion ? score : 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const tone = scoreTone(clamped);

  useEffect(() => {
    if (reduceMotion) {
      setDisplay(clamped);
      return;
    }
    const controls = animate(0, clamped, {
      duration: 1.2,
      ease: "easeOut",
      onUpdate: (value) => setDisplay(Math.round(value)),
    });
    return () => controls.stop();
  }, [clamped, reduceMotion]);

  return (
    <div className="relative h-32 w-32 shrink-0" role="img" aria-label={`Score : ${clamped} sur 100`}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="10" className="stroke-slate-200 dark:stroke-slate-800" />
        <motion.circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          className={tone.stroke}
          initial={{ strokeDashoffset: reduceMotion ? circumference * (1 - clamped / 100) : circumference }}
          animate={{ strokeDashoffset: circumference * (1 - clamped / 100) }}
          transition={reduceMotion ? { duration: 0 } : { duration: 1.2, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
        <span className={cn("font-heading text-3xl font-bold tabular-nums leading-none", tone.text)}>{display}</span>
        <span className="mt-1 text-[11px] font-semibold text-muted-foreground">/100</span>
      </div>
    </div>
  );
}

function ScoreBar({ label, value, max, delay }: { label: string; value: number; max: number; delay: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">
          {value}/{max}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-600"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: "easeOut", delay }}
        />
      </div>
    </div>
  );
}

function BulletList({ items, icon: Icon, iconClassName }: { items: string[]; icon: LucideIcon; iconClassName: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li key={`${index}-${item.slice(0, 24)}`} className="flex min-w-0 items-start gap-2 text-[13px] leading-relaxed text-foreground">
          <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", iconClassName)} aria-hidden />
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ExamReviewRow({ exam, result, pertinent, requested }: { exam: CaseExam; result: string | undefined; pertinent: boolean; requested: boolean }) {
  const meta = CATEGORY_META[exam.category];
  const Icon = meta.icon;
  const status = pertinent
    ? requested
      ? { label: "Demandé", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300", icon: CircleCheck }
      : { label: "Oublié", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300", icon: TriangleAlert }
    : requested
      ? { label: "Inutile", className: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300", icon: CircleX }
      : { label: "Non demandé", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", icon: null };
  const StatusIcon = status.icon;

  return (
    <li>
      <details className="group rounded-xl border border-border bg-white/80 dark:bg-slate-900/60">
        <summary
          className={cn(
            "flex cursor-pointer list-none items-center gap-2 rounded-xl px-2.5 py-2 [&::-webkit-details-marker]:hidden",
            FOCUS_RING
          )}
        >
          <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", meta.chip)}>
            <Icon className="h-3 w-3" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 break-words text-[13px] font-medium text-foreground">{exam.label}</span>
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold", status.className)}>
            {StatusIcon && <StatusIcon className="h-3 w-3" aria-hidden />}
            {status.label}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <p className="whitespace-pre-line break-words px-3 pb-3 text-[13px] leading-relaxed text-muted-foreground">
          {result ?? "Résultat indisponible."}
        </p>
      </details>
    </li>
  );
}

function ResultsScreen({
  courseTitle,
  snapshot,
  evaluation,
  onNewCase,
  onAskInChat,
}: {
  courseTitle: string;
  snapshot: CaseSnapshot;
  evaluation: Evaluation;
  onNewCase: () => void;
  onAskInChat?: (prompt: string) => void;
}) {
  const { caseData } = snapshot;
  const verdict = VERDICT_META[evaluation.verdict];
  const VerdictIcon = verdict.icon;
  const requested = new Set(snapshot.obtained.map((item) => item.examId));
  const pertinent = new Set(evaluation.pertinentExamIds);
  const pertinentExams = caseData.exams.filter((exam) => pertinent.has(exam.id));
  const otherExams = caseData.exams.filter((exam) => !pertinent.has(exam.id));
  const { correction } = evaluation;

  return (
    <div className="space-y-3.5">
      <motion.section
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={SPRING}
        className="glass-card relative overflow-hidden rounded-2xl p-4 shadow-soft"
        aria-label="Score du cas"
      >
        <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-primary-400/20 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-center gap-4">
          <ScoreRing score={evaluation.score} />
          <div className="min-w-[11rem] flex-1 space-y-3">
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold ring-1 ring-inset", verdict.badge)}>
              <VerdictIcon className="h-3.5 w-3.5" aria-hidden />
              {verdict.label}
            </span>
            <ScoreBar label="Diagnostic" value={evaluation.diagnosisScore} max={70} delay={0.2} />
            <ScoreBar label="Pertinence des examens" value={evaluation.efficiencyScore} max={30} delay={0.35} />
          </div>
        </div>
      </motion.section>

      <SectionCard icon={Target} title="Ta réponse face à la correction" delay={0.05}>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="min-w-0 rounded-xl border border-border bg-white/80 dark:bg-slate-900/60 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Ton diagnostic</p>
            <p className="mt-1 break-words text-[13px] font-semibold text-foreground">{snapshot.submittedDiagnosis}</p>
          </div>
          <div className="min-w-0 rounded-xl border border-primary-200 bg-primary-50/80 p-3 dark:border-primary-900/60 dark:bg-primary-950/30">
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary-700 dark:text-primary-300">Diagnostic attendu</p>
            <p className="mt-1 break-words text-[13px] font-semibold text-foreground">{correction.diagnostic}</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard icon={GraduationCap} title="Retour du correcteur" delay={0.1}>
        <p className="whitespace-pre-line break-words text-[13px] leading-relaxed text-foreground">{evaluation.feedback}</p>
        {evaluation.missedArguments.length > 0 && (
          <div className="mt-3 rounded-xl border border-border bg-white/70 dark:bg-slate-900/50 p-3">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Arguments non mobilisés</p>
            <BulletList items={evaluation.missedArguments} icon={CircleX} iconClassName="text-rose-500" />
          </div>
        )}
      </SectionCard>

      <SectionCard icon={ListChecks} title="Correction complète" delay={0.15}>
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Diagnostics différentiels</p>
            <ul className="flex flex-wrap gap-1.5">
              {correction.diagnosticsDifferentiels.map((item, index) => (
                <li
                  key={`${index}-${item.slice(0, 24)}`}
                  className="rounded-lg border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Arguments clés</p>
            <BulletList items={correction.argumentsCles} icon={CircleCheck} iconClassName="text-emerald-500" />
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Prise en charge</p>
            <ol className="space-y-1.5">
              {correction.priseEnCharge.map((item, index) => (
                <li key={`${index}-${item.slice(0, 24)}`} className="flex min-w-0 items-start gap-2 text-[13px] leading-relaxed text-foreground">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[11px] font-bold tabular-nums text-primary-700 dark:bg-primary-950/60 dark:text-primary-300">
                    {index + 1}
                  </span>
                  <span className="min-w-0 break-words">{item}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800/60 dark:bg-amber-950/30">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Piège d'examen</p>
              <p className="mt-0.5 break-words text-[13px] leading-relaxed text-amber-900 dark:text-amber-100">{correction.piegeExamen}</p>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard icon={Microscope} title="Examens : pertinents ou non" delay={0.2}>
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              Pertinents ({pertinentExams.length})
            </p>
            <ul className="space-y-1.5">
              {pertinentExams.map((exam) => (
                <ExamReviewRow key={exam.id} exam={exam} result={correction.results[exam.id]} pertinent requested={requested.has(exam.id)} />
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Non pertinents ({otherExams.length})</p>
            <ul className="space-y-1.5">
              {otherExams.map((exam) => (
                <ExamReviewRow
                  key={exam.id}
                  exam={exam}
                  result={correction.results[exam.id]}
                  pertinent={false}
                  requested={requested.has(exam.id)}
                />
              ))}
            </ul>
          </div>
        </div>
      </SectionCard>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING, delay: 0.25 }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <Button type="button" variant={onAskInChat ? "outline" : "primary"} onClick={onNewCase} className="w-full sm:flex-1">
          <RotateCcw className="h-4 w-4" aria-hidden />
          Rejouer un cas
        </Button>
        {onAskInChat && (
          <Button type="button" onClick={() => onAskInChat(buildDebriefPrompt(courseTitle, snapshot, evaluation))} className="w-full sm:flex-1">
            <MessageSquareText className="h-4 w-4" aria-hidden />
            Approfondir dans le chat
          </Button>
        )}
      </motion.div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Root                                                                     */
/* ----------------------------------------------------------------------- */

/**
 * "Simulateur de patient virtuel" — interactive clinical case grounded in
 * one Studio course (see app/api/studio/case-simulator/route.ts). The answer
 * key never reaches this component until the diagnosis is graded: it only
 * ever holds the public presentation, an opaque sealed token, and the exam
 * results the student explicitly asked for.
 */
export function ClinicalCaseSimulator({ courseId, courseTitle, onAskInChat }: ClinicalCaseSimulatorProps) {
  const subscribe = useCallback((listener: () => void) => subscribeStore(courseId, listener), [courseId]);
  const getSnapshot = useCallback(() => getStore(courseId), [courseId]);
  const state = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_STATE);
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);

  const snapshot = state.snapshot;
  const evaluation = snapshot?.evaluation ?? null;
  const phase: "setup" | "loading" | "case" | "results" = snapshot ? (evaluation ? "results" : "case") : state.starting ? "loading" : "setup";

  // Bring the top of the simulator back into view on every screen change — results land while the student is down at the diagnosis form.
  const previousPhase = useRef(phase);
  useEffect(() => {
    if (previousPhase.current === phase) return;
    previousPhase.current = phase;
    setConfirmingAbandon(false);
    rootRef.current?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  }, [phase, reduceMotion]);

  return (
    <div ref={rootRef} className="w-full min-w-0 scroll-mt-4 space-y-3.5 text-foreground">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-glow">
          <Stethoscope className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-base font-semibold leading-tight text-foreground">Simulateur de patient virtuel</h2>
          <p className="truncate text-[12px] text-muted-foreground" title={courseTitle}>
            {snapshot ? `Niveau ${difficultyLabel(snapshot.difficulty)} · ${courseTitle}` : courseTitle}
          </p>
        </div>
        {phase === "case" && (
          <IconButton label="Abandonner ce cas" onClick={() => setConfirmingAbandon((value) => !value)}>
            <RotateCcw className="h-4 w-4" />
          </IconButton>
        )}
      </header>

      <AnimatePresence initial={false}>
        {phase === "case" && confirmingAbandon && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-800/60 dark:bg-amber-950/30">
              <p className="min-w-[10rem] flex-1 text-[13px] leading-snug text-amber-900 dark:text-amber-100">
                Abandonner ce cas ? Il ne pourra pas être repris, mais tu pourras le rejouer gratuitement : il est conservé pour ce cours.
              </p>
              <div className="flex gap-1.5">
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingAbandon(false)}>
                  Continuer
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setConfirmingAbandon(false);
                    resetCase(courseId);
                  }}
                >
                  Abandonner
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {phase === "setup" && (
          <motion.div key="setup" {...SCREEN_MOTION}>
            <SetupScreen
              courseTitle={courseTitle}
              state={state}
              onDifficultyChange={(value) => setDifficulty(courseId, value)}
              onStart={() => void startCase(courseId)}
              onDismissError={() => dismissErrors(courseId)}
            />
          </motion.div>
        )}
        {phase === "loading" && (
          <motion.div key="loading" {...SCREEN_MOTION}>
            <LoadingScreen difficulty={state.difficulty} />
          </motion.div>
        )}
        {phase === "case" && snapshot && (
          <motion.div key={`case-${snapshot.token.slice(0, 16)}`} {...SCREEN_MOTION}>
            <CaseScreen courseId={courseId} state={state} snapshot={snapshot} />
          </motion.div>
        )}
        {phase === "results" && snapshot && evaluation && (
          <motion.div key={`results-${snapshot.token.slice(0, 16)}`} {...SCREEN_MOTION}>
            <ResultsScreen
              courseTitle={courseTitle}
              snapshot={snapshot}
              evaluation={evaluation}
              onNewCase={() => resetCase(courseId)}
              onAskInChat={onAskInChat}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
