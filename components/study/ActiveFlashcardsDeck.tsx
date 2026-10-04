"use client";

/**
 * "Flashcards" tab (see app/study/page.tsx) — a NotebookLM-style flip-card
 * deck, studied in BATCHES of 50 cards MIXED across every selected course
 * (the courses ticked in FlashcardCoursePicker, or every course of the
 * activated modules when none is ticked).
 *
 * Endless flow, no blocking "Bravo" screen:
 *  - the opening batch is the student's previously served cards, shuffled
 *    (/api/flashcards/pool), topped up with new ones if there are fewer than 50;
 *  - every later batch comes from /api/flashcards/generate, which pools the
 *    unseen cards of all selected courses, shuffles them (Fisher-Yates) and
 *    samples 50 round-robin across the courses — and, when the selection runs low, first EXTENDS a course's set
 *    with brand-new AI cards (stored for every later student). So there is
 *    always a next batch;
 *  - the next batch is PREFETCHED in the background once 5 cards remain, so
 *    "Continuer" at the end of a batch is instant.
 *
 * Bounded by construction: at most the current batch + one prefetched batch
 * live in memory; one request in flight at a time (ref guard); every request
 * is aborted on unmount / selection or language change and its late result
 * ignored, so nothing can setState after unmount or double-fetch.
 *
 * Content language = the global AI-content language (store/useLanguageStore.ts);
 * changing it starts a session in the new language.
 *
 * Resume-where-left-off: the current batch + index + score + batch number are
 * mirrored into localStorage (per user, per selection, per language). The
 * prefetched batch is not — it is re-requested on return. A deep-linked
 * push-notification card (`?cardId=`) bypasses the saved session.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Layers, Loader2, AlertTriangle, LogIn, Lock, ArrowRight, RotateCcw, Sparkles, Flame, Gauge, Zap, Activity, Trophy, Timer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CyberPanel, CyberStat, NeonRing } from "@/components/cyber/primitives";
import { FlipFlashcard, type FlashcardRating, type GradeFeedback } from "@/components/study/FlipFlashcard";
import { FlashcardCoursePicker } from "@/components/study/FlashcardCoursePicker";
import { AiLanguageSelect } from "@/components/course/workspace/AiLanguageSelect";
import { createClient } from "@/lib/supabase/client";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { useLanguageStore, type ContentLanguage } from "@/store/useLanguageStore";
import { tStudyTools } from "@/lib/translations/studyTools";
import type { FlashcardPoolItem } from "@/types/flashcard";

/** How long the "Bien joué !" / "Pas grave" confirmation stays before the deck advances. */
const GRADE_FEEDBACK_MS = 550;

/** One batch — mirrors BATCH_SIZE in app/api/flashcards/generate/route.ts and MAX_POOL_SIZE in /pool. */
const BATCH_SIZE = 50;

/** The next batch is requested once this many cards (or fewer) remain in the current one. */
const PREFETCH_AT_REMAINING = 5;

type Status = "loading" | "needs-auth" | "error" | "no-modules-active" | "empty-pool" | "quota-exceeded" | "ready";

/** State of the NEXT batch (the one shown after "Continuer"). */
type NextState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; items: FlashcardPoolItem[]; extended: boolean }
  | { kind: "quota" }
  | { kind: "error"; message: string };

const STORAGE_PREFIX = "medart:flashcards-session:";

/** Strings introduced by the batch flow (kept here rather than in the shared translations file). */
const COPY: Record<Language, Record<string, string>> = {
  fr: {
    batchDone: "Lot terminé",
    batchLabel: "Lot",
    reviewed: "cartes révisées dans cette session",
    continue: "Continuer : 50 cartes suivantes",
    preparing: "Préparation du lot suivant…",
    extended: "De nouvelles cartes inédites ont été générées pour tes cours.",
    retry: "Réessayer",
    nextError: "Le lot suivant n'a pas pu être préparé.",
    restart: "Recommencer la session",
    liveTitle: "Mémorisation en direct",
    mastery: "Rétention",
    streak: "Série",
    best: "record",
    pace: "Rythme",
    perMinute: "cartes / min",
    hard: "Difficile",
    medium: "Moyen",
    easy: "Facile",
    noGradeYet: "Note ta première carte pour activer la télémétrie.",
  },
  en: {
    batchDone: "Batch complete",
    batchLabel: "Batch",
    reviewed: "cards reviewed this session",
    continue: "Continue: next 50 cards",
    preparing: "Preparing the next batch…",
    extended: "Brand-new cards were generated for your courses.",
    retry: "Try again",
    nextError: "The next batch could not be prepared.",
    restart: "Restart the session",
    liveTitle: "Live memory tracking",
    mastery: "Retention",
    streak: "Streak",
    best: "best",
    pace: "Pace",
    perMinute: "cards / min",
    hard: "Hard",
    medium: "Good",
    easy: "Easy",
    noGradeYet: "Rate your first card to start the telemetry.",
  },
};

type RatingTally = Record<FlashcardRating, number>;
const EMPTY_TALLY: RatingTally = { hard: 0, medium: 0, easy: 0 };

interface SavedSession {
  deck: FlashcardPoolItem[];
  index: number;
  score: { correct: number; incorrect: number };
  round: number;
  reviewedTotal: number;
  /** Self-ratings this session — optional so sessions saved by older versions still load. */
  ratings?: RatingTally;
  streak?: number;
  bestStreak?: number;
}

function parseTally(value: unknown): RatingTally {
  if (!value || typeof value !== "object") return { ...EMPTY_TALLY };
  const raw = value as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return { hard: n(raw.hard), medium: n(raw.medium), easy: n(raw.easy) };
}

/** Per user (shared devices), per selection, per content language. */
function getStorageKey(userId: string, activeModuleIds: number[], activeCourseIds: number[], contentLanguage: ContentLanguage): string {
  const modulesPart = [...activeModuleIds].sort((a, b) => a - b).join(",");
  const coursesPart = [...activeCourseIds].sort((a, b) => a - b).join(",");
  return `${STORAGE_PREFIX}${userId}:${modulesPart}:${coursesPart}:${contentLanguage}`;
}

/** Removes every OTHER flashcard-session entry (other users on a shared device, older key formats). Best-effort. */
function purgeForeignFlashcardSessions(currentKey: string): void {
  try {
    for (const existingKey of Object.keys(window.localStorage)) {
      if (existingKey.startsWith(STORAGE_PREFIX) && existingKey !== currentKey) window.localStorage.removeItem(existingKey);
    }
  } catch {
    // Storage unavailable — nothing to clean up.
  }
}

/** Fisher-Yates. */
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function isFlashcardPoolItem(value: unknown): value is FlashcardPoolItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.question === "string" && typeof item.answer === "string";
}

/** Defensive: a saved session from an older app version is treated as absent, never a crash. */
function loadSavedSession(key: string): SavedSession | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.deck) || !parsed.deck.every(isFlashcardPoolItem)) return null;
    if (parsed.deck.length === 0 || parsed.deck.length > BATCH_SIZE * 2) return null;
    if (typeof parsed.index !== "number" || parsed.index < 0 || parsed.index > parsed.deck.length) return null;
    const score =
      parsed.score && typeof parsed.score.correct === "number" && typeof parsed.score.incorrect === "number"
        ? parsed.score
        : { correct: 0, incorrect: 0 };
    return {
      deck: parsed.deck,
      index: parsed.index,
      score,
      round: typeof parsed.round === "number" && parsed.round >= 1 ? parsed.round : 1,
      reviewedTotal: typeof parsed.reviewedTotal === "number" && parsed.reviewedTotal >= 0 ? parsed.reviewedTotal : parsed.index,
      ratings: parseTally(parsed.ratings),
      streak: typeof parsed.streak === "number" && parsed.streak >= 0 ? parsed.streak : 0,
      bestStreak: typeof parsed.bestStreak === "number" && parsed.bestStreak >= 0 ? parsed.bestStreak : 0,
    };
  } catch {
    return null;
  }
}

function saveSession(key: string, session: SavedSession): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(session));
  } catch {
    // Quota / privacy mode — resuming is a nice-to-have.
  }
}

function clearSavedSession(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best-effort.
  }
}

async function fetchPool(
  contentLanguage: ContentLanguage,
  signal: AbortSignal
): Promise<
  | { ok: true; items: FlashcardPoolItem[]; activeModuleCount: number; activeModuleIds: number[]; activeCourseIds: number[] }
  | { ok: false; status: number; error?: string }
> {
  const res = await fetch(`/api/flashcards/pool?language=${contentLanguage}`, { signal }).catch(() => null);
  if (!res) return { ok: false, status: 0 };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, error: body?.error };
  }
  const body = await res.json().catch(() => ({}));
  return {
    ok: true,
    items: Array.isArray(body.items) ? body.items.filter(isFlashcardPoolItem) : [],
    activeModuleCount: body.activeModuleCount ?? 0,
    activeModuleIds: Array.isArray(body.activeModuleIds) ? body.activeModuleIds : [],
    activeCourseIds: Array.isArray(body.activeCourseIds) ? body.activeCourseIds : [],
  };
}

/** The card a reminder notification pointed at (GET /api/flashcards/card) — null when it no longer exists. */
async function fetchLinkedCard(cardId: string, signal: AbortSignal): Promise<FlashcardPoolItem | null> {
  try {
    const res = await fetch(`/api/flashcards/card?id=${encodeURIComponent(cardId)}`, { signal });
    if (!res.ok) return null;
    const body: unknown = await res.json().catch(() => ({}));
    const card = body && typeof body === "object" ? (body as { card?: unknown }).card : null;
    return isFlashcardPoolItem(card) ? card : null;
  } catch {
    return null;
  }
}

type BatchResult =
  | { kind: "ok"; items: FlashcardPoolItem[]; extended: boolean }
  | { kind: "quota" }
  | { kind: "error"; message: string }
  | { kind: "aborted" };

async function requestBatch(contentLanguage: ContentLanguage, signal: AbortSignal): Promise<BatchResult> {
  let res: Response;
  try {
    res = await fetch("/api/flashcards/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: contentLanguage }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { kind: "aborted" };
    return { kind: "error", message: "Connexion impossible." };
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 403) return { kind: "quota" };
  if (!res.ok || !body?.success) return { kind: "error", message: typeof body?.error === "string" ? body.error : "Erreur serveur." };
  const items = Array.isArray(body.items) ? body.items.filter(isFlashcardPoolItem) : [];
  if (items.length === 0) return body.quotaReached ? { kind: "quota" } : { kind: "error", message: "Aucune carte n'a pu être préparée." };
  return { kind: "ok", items, extended: body.generated === "extension" || body.generated === "definitive" };
}

export function ActiveFlashcardsDeck() {
  const searchParams = useSearchParams();
  const deepLinkCardId = searchParams.get("cardId");
  const { language } = useLanguage();
  const copy = COPY[language];
  const contentLanguage = useLanguageStore((state) => state.language);

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [deck, setDeck] = useState<FlashcardPoolItem[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [score, setScore] = useState({ correct: 0, incorrect: 0 });
  const [round, setRound] = useState(1);
  const [reviewedTotal, setReviewedTotal] = useState(0);
  const [ratings, setRatings] = useState<RatingTally>({ ...EMPTY_TALLY });
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  // Pace is measured over THIS visit only (never persisted): grades since the deck became ready.
  const [visit, setVisit] = useState<{ startedAt: number; graded: number }>({ startedAt: 0, graded: 0 });
  const [nowTick, setNowTick] = useState(0);
  const [next, setNext] = useState<NextState>({ kind: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const [gradeFeedback, setGradeFeedback] = useState<GradeFeedback>(null);
  const gradeFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);

  // One request at a time, aborted on any session change / unmount. The
  // session id makes a late response from a previous session a no-op.
  const inFlightRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef(0);

  const abortInFlight = useCallback(() => {
    inFlightRef.current?.abort();
    inFlightRef.current = null;
  }, []);

  /** Requests the next batch in the background (no-op if one is already in flight or ready). */
  const prefetchNext = useCallback(() => {
    if (inFlightRef.current) return;
    const controller = new AbortController();
    inFlightRef.current = controller;
    const sessionId = sessionIdRef.current;
    setNext({ kind: "loading" });
    void requestBatch(contentLanguage, controller.signal).then((result) => {
      if (inFlightRef.current === controller) inFlightRef.current = null;
      if (result.kind === "aborted" || sessionId !== sessionIdRef.current) return;
      if (result.kind === "ok") setNext({ kind: "ready", items: result.items, extended: result.extended });
      else if (result.kind === "quota") setNext({ kind: "quota" });
      else setNext({ kind: "error", message: result.message });
    });
  }, [contentLanguage]);

  // ---- Session load (mount, selection change, restart, language change).
  useEffect(() => {
    const sessionId = ++sessionIdRef.current;
    abortInFlight();
    const controller = new AbortController();
    const isCurrent = () => sessionId === sessionIdRef.current && !controller.signal.aborted;

    async function load() {
      setStatus("loading");
      setNext({ kind: "idle" });
      const pool = await fetchPool(contentLanguage, controller.signal);
      if (!isCurrent()) return;

      if (!pool.ok) {
        if (pool.status === 401) setStatus("needs-auth");
        else {
          setStatus("error");
          setError(pool.error ?? tStudyTools("serverContactError", language));
        }
        return;
      }

      if (pool.activeModuleCount === 0 && pool.activeCourseIds.length === 0) {
        setStatus("no-modules-active");
        return;
      }

      const {
        data: { user },
      } = await createClient().auth.getUser();
      if (!isCurrent()) return;
      if (!user) {
        setStatus("needs-auth");
        return;
      }

      const key = getStorageKey(user.id, pool.activeModuleIds, pool.activeCourseIds, contentLanguage);
      purgeForeignFlashcardSessions(key);
      setStorageKey(key);

      if (!deepLinkCardId) {
        const saved = loadSavedSession(key);
        if (saved) {
          setDeck(saved.deck);
          setIndex(saved.index);
          setScore(saved.score);
          setRound(saved.round);
          setReviewedTotal(saved.reviewedTotal);
          setRatings(saved.ratings ?? { ...EMPTY_TALLY });
          setStreak(saved.streak ?? 0);
          setBestStreak(saved.bestStreak ?? 0);
          setVisit({ startedAt: Date.now(), graded: 0 });
          setFlipped(false);
          setStatus("ready");
          return;
        }
      }

      setScore({ correct: 0, incorrect: 0 });
      setRound(1);
      setReviewedTotal(0);
      setRatings({ ...EMPTY_TALLY });
      setStreak(0);
      setBestStreak(0);
      setVisit({ startedAt: Date.now(), graded: 0 });

      // Opening batch: previously served cards (already shuffled across the
      // selected courses by /pool), topped up with NEW cards when short.
      let opening = pool.items;
      let extra: FlashcardPoolItem[] = [];
      if (opening.length < BATCH_SIZE) {
        inFlightRef.current = controller;
        const result = await requestBatch(contentLanguage, controller.signal);
        if (inFlightRef.current === controller) inFlightRef.current = null;
        if (!isCurrent() || result.kind === "aborted") return;
        if (result.kind === "ok") {
          const combined = shuffle([...opening, ...result.items]);
          opening = combined.slice(0, BATCH_SIZE);
          extra = combined.slice(BATCH_SIZE);
        } else if (opening.length === 0) {
          setStatus(result.kind === "quota" ? "quota-exceeded" : "empty-pool");
          if (result.kind === "error") setError(result.message);
          return;
        }
      }

      const deepLinkIndex = deepLinkCardId ? opening.findIndex((item) => item.id === deepLinkCardId) : -1;
      let ordered =
        deepLinkIndex > 0 ? [opening[deepLinkIndex], ...opening.slice(0, deepLinkIndex), ...opening.slice(deepLinkIndex + 1)] : opening;
      // Opened from a reminder notification whose card isn't in this batch: fetch it and show it first.
      if (deepLinkCardId && deepLinkIndex < 0) {
        const linked = await fetchLinkedCard(deepLinkCardId, controller.signal);
        if (!isCurrent()) return;
        if (linked) ordered = [linked, ...opening.filter((item) => item.id !== linked.id)].slice(0, BATCH_SIZE);
      }

      setDeck(ordered);
      setIndex(0);
      setFlipped(false);
      // Cards that didn't fit the opening batch become the next one — never wasted, never refetched.
      setNext(extra.length > 0 ? { kind: "ready", items: extra, extended: false } : { kind: "idle" });
      setStatus("ready");
    }

    void load();
    return () => {
      controller.abort();
    };
    // `language` (UI) only shapes error strings — not a reason to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, deepLinkCardId, contentLanguage]);

  // Abort any background request on unmount.
  useEffect(() => () => abortInFlight(), [abortInFlight]);

  // ---- Background prefetch of the next batch.
  useEffect(() => {
    if (status !== "ready" || deck.length === 0) return;
    if (next.kind !== "idle") return;
    if (deck.length - index <= PREFETCH_AT_REMAINING) prefetchNext();
  }, [status, deck.length, index, next.kind, prefetchNext]);

  // ---- Persist the live session.
  useEffect(() => {
    if (status !== "ready" || !storageKey || deck.length === 0) return;
    saveSession(storageKey, { deck, index, score, round, reviewedTotal, ratings, streak, bestStreak });
  }, [storageKey, status, deck, index, score, round, reviewedTotal, ratings, streak, bestStreak]);

  // Re-render the pace once every 15 s while studying (cheap, no per-second churn).
  useEffect(() => {
    if (status !== "ready") return;
    const id = window.setInterval(() => setNowTick(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, [status]);

  // ---- Cross-tab sync (another tab of the same selection moved on).
  useEffect(() => {
    const key = storageKey;
    if (!key) return;
    function handleStorageChange(e: StorageEvent) {
      if (!key || e.key !== key || e.newValue === null || status !== "ready") return;
      const saved = loadSavedSession(key);
      if (!saved) return;
      setDeck(saved.deck);
      setIndex(saved.index);
      setScore(saved.score);
      setRound(saved.round);
      setReviewedTotal(saved.reviewedTotal);
      setRatings(saved.ratings ?? { ...EMPTY_TALLY });
      setStreak(saved.streak ?? 0);
      setBestStreak(saved.bestStreak ?? 0);
      setFlipped(false);
    }
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [storageKey, status]);

  useEffect(() => {
    return () => {
      if (gradeFeedbackTimeoutRef.current) clearTimeout(gradeFeedbackTimeoutRef.current);
    };
  }, []);

  function handleRestart() {
    if (storageKey) clearSavedSession(storageKey);
    setReloadKey((k) => k + 1);
  }

  /** The picker changed the selection — start over on the new selection (different storage key). */
  function handleSelectionChanged() {
    setReloadKey((k) => k + 1);
  }

  function handleContinue() {
    if (next.kind !== "ready") return;
    setDeck(next.items.slice(0, BATCH_SIZE));
    setIndex(0);
    setFlipped(false);
    setRound((r) => r + 1);
    // Anything beyond one batch (only possible from the opening top-up) stays queued as the next one.
    setNext(next.items.length > BATCH_SIZE ? { kind: "ready", items: next.items.slice(BATCH_SIZE), extended: false } : { kind: "idle" });
  }

  function handleNext() {
    if (index >= deck.length) return;
    setFlipped(false);
    setReviewedTotal((total) => total + 1);
    setIndex(index + 1);
  }

  function handlePrev() {
    if (index === 0) return;
    setFlipped(false);
    setIndex(index - 1);
  }

  function handleGrade(isCorrect: boolean, rating: FlashcardRating) {
    if (gradeFeedbackTimeoutRef.current) return;
    setScore((prev) => (isCorrect ? { ...prev, correct: prev.correct + 1 } : { ...prev, incorrect: prev.incorrect + 1 }));
    setRatings((prev) => ({ ...prev, [rating]: prev[rating] + 1 }));
    const nextStreak = rating === "hard" ? 0 : streak + 1;
    setStreak(nextStreak);
    setBestStreak((best) => Math.max(best, nextStreak));
    setVisit((v) => ({ ...v, graded: v.graded + 1 }));
    setGradeFeedback(isCorrect ? "correct" : "incorrect");
    gradeFeedbackTimeoutRef.current = setTimeout(() => {
      gradeFeedbackTimeoutRef.current = null;
      setGradeFeedback(null);
      handleNext();
    }, GRADE_FEEDBACK_MS);
  }

  const statusShell = (children: ReactNode) => (
    <CyberPanel laser className="animate-in fade-in-0 duration-300">
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">{children}</div>
    </CyberPanel>
  );

  if (status === "loading") {
    return statusShell(
      <>
        <span className="relative flex h-14 w-14 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-cyan-400/20" />
          <Loader2 className="h-6 w-6 animate-spin text-cyan-300" />
        </span>
        <span className="text-sm text-slate-300">{tStudyTools("preparingFlashcards", language)}</span>
      </>
    );
  }

  if (status === "needs-auth") {
    return statusShell(
      <>
        <LogIn className="h-6 w-6 text-cyan-300" />
        <p className="text-sm text-slate-300">{tStudyTools("signInForFlashcards", language)}</p>
      </>
    );
  }

  if (status === "error") {
    return statusShell(
      <>
        <AlertTriangle className="h-6 w-6 text-amber-300" />
        <p className="text-sm text-slate-300">{error}</p>
        <Button variant="secondary" size="sm" onClick={handleRestart}>
          <RotateCcw className="h-3.5 w-3.5" />
          {copy.retry}
        </Button>
      </>
    );
  }

  if (status === "no-modules-active") {
    return statusShell(
      <>
        <Layers className="h-9 w-9 text-cyan-300/60" />
        <p className="text-sm font-bold text-white">{tStudyTools("noActiveModulesTitle", language)}</p>
        <p className="max-w-sm text-xs text-slate-400">{tStudyTools("noActiveModulesFlashcardsSubtitle", language)}</p>
        <FlashcardCoursePicker onSelectionChanged={handleSelectionChanged} />
      </>
    );
  }

  if (status === "empty-pool") {
    return statusShell(
      <>
        <Layers className="h-9 w-9 text-cyan-300/60" />
        <p className="text-sm font-bold text-white">{tStudyTools("emptyPoolTitle", language)}</p>
        <p className="max-w-sm text-xs text-slate-400">{error ?? tStudyTools("emptyPoolSubtitle", language)}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <FlashcardCoursePicker onSelectionChanged={handleSelectionChanged} />
          <Button variant="secondary" size="sm" onClick={handleRestart}>
            <RotateCcw className="h-3.5 w-3.5" />
            {copy.retry}
          </Button>
        </div>
      </>
    );
  }

  if (status === "quota-exceeded") {
    return statusShell(
      <>
        <Lock className="h-9 w-9 text-amber-300" />
        <p className="text-sm font-bold text-white">{tStudyTools("flashcardQuotaTitle", language)}</p>
        <p className="max-w-sm text-xs text-slate-400">{tStudyTools("flashcardQuotaSubtitle", language)}</p>
      </>
    );
  }

  const current = deck[index];
  const graded = score.correct + score.incorrect;
  const retention = graded > 0 ? score.correct / graded : 0;
  const elapsedMinutes = visit.startedAt > 0 ? Math.max(1, ((nowTick || Date.now()) - visit.startedAt) / 60000) : 1;
  const pace = visit.graded > 0 ? visit.graded / elapsedMinutes : 0;
  const ratingRows: { key: FlashcardRating; label: string; icon: typeof Flame; bar: string; text: string }[] = [
    { key: "easy", label: copy.easy, icon: Zap, bar: "from-emerald-400 to-teal-400", text: "text-emerald-300" },
    { key: "medium", label: copy.medium, icon: Gauge, bar: "from-amber-400 to-orange-400", text: "text-amber-300" },
    { key: "hard", label: copy.hard, icon: Flame, bar: "from-rose-400 to-pink-500", text: "text-rose-300" },
  ];
  const ratingTotal = ratings.hard + ratings.medium + ratings.easy;

  const header = (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] p-4 sm:p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-200 ring-1 ring-inset ring-violet-400/30">
        <Layers className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-white">{tStudyTools("flashcardsActiveModulesTitle", language)}</p>
        <p className="truncate text-xs text-slate-400">
          {copy.batchLabel} {round}
          {current ? ` · ${current.courseTitle}` : ""}
        </p>
      </div>
      <AiLanguageSelect compact />
      <FlashcardCoursePicker onSelectionChanged={handleSelectionChanged} />
    </div>
  );

  // Live memory telemetry — every number is this session's real grading.
  const tracker = (
    <CyberPanel className="p-5">
      <p className="cyber-kicker flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5" />
        {copy.liveTitle}
      </p>
      <div className="mt-4 flex items-center gap-4">
        <NeonRing value={retention} size={104} stroke={9} from="#34d399" to="#22d3ee" aria-label={`${copy.mastery} ${Math.round(retention * 100)}%`}>
          <span className="text-2xl font-black tabular-nums text-white">{graded > 0 ? `${Math.round(retention * 100)}%` : "—"}</span>
          <span className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">{copy.mastery}</span>
        </NeonRing>
        <div className="min-w-0 flex-1 space-y-2.5">
          {ratingRows.map(({ key, label, icon: Icon, bar, text }) => (
            <div key={key}>
              <div className="flex items-center justify-between text-[11px] font-bold">
                <span className={`flex items-center gap-1 ${text}`}>
                  <Icon className="h-3 w-3" />
                  {label}
                </span>
                <span className="tabular-nums text-slate-300">{ratings[key]}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div className={`h-full w-full origin-left rounded-full bg-gradient-to-r ${bar} transition-transform duration-500`} style={{ transform: `scaleX(${ratingTotal > 0 ? ratings[key] / ratingTotal : 0})` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <CyberStat label={copy.streak} value={streak} hint={`${copy.best} ${bestStreak}`} icon={Trophy} tone="amber" />
        <CyberStat label={copy.pace} value={pace > 0 ? pace.toFixed(1) : "—"} hint={copy.perMinute} icon={Timer} tone="violet" />
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        {graded === 0 ? copy.noGradeYet : `${reviewedTotal} ${copy.reviewed}`}
      </p>
    </CyberPanel>
  );

  if (!current) {
    // End of a batch — never a dead end: the next batch is (being) prepared.
    return (
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <CyberPanel laser className="animate-in fade-in-0 duration-300">
          {header}
          <div className="flex flex-col items-center gap-3 px-6 pb-12 pt-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-slate-950 shadow-[0_0_30px_rgba(52,211,153,0.45)]">
              <Trophy className="h-6 w-6" />
            </span>
            <p className="text-base font-black text-white">
              {copy.batchDone} · {copy.batchLabel} {round}
            </p>
            <p className="text-xs text-slate-400">
              {reviewedTotal} {copy.reviewed} · ✓ {score.correct} · ↺ {score.incorrect}
            </p>

            {next.kind === "ready" ? (
              <>
                {next.extended && (
                  <p className="flex items-center gap-1.5 text-xs text-violet-200">
                    <Sparkles className="h-3.5 w-3.5" />
                    {copy.extended}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleContinue}
                  className="mt-2 flex min-h-12 items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-300 to-violet-500 px-6 text-sm font-black text-slate-950 shadow-[0_0_30px_rgba(34,211,238,0.45)] transition-transform active:scale-95"
                >
                  {copy.continue}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </>
            ) : next.kind === "quota" ? (
              <>
                <Lock className="h-6 w-6 text-amber-300" />
                <p className="text-sm font-bold text-white">{tStudyTools("flashcardQuotaTitle", language)}</p>
                <p className="max-w-sm text-xs text-slate-400">{tStudyTools("flashcardQuotaSubtitle", language)}</p>
              </>
            ) : next.kind === "error" ? (
              <>
                <p className="max-w-sm text-xs text-slate-400">
                  {copy.nextError} {next.message}
                </p>
                <Button variant="secondary" size="sm" onClick={prefetchNext}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {copy.retry}
                </Button>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
                {copy.preparing}
              </p>
            )}

            <Button variant="ghost" size="sm" onClick={handleRestart}>
              <RotateCcw className="h-3.5 w-3.5" />
              {copy.restart}
            </Button>
          </div>
        </CyberPanel>
        {tracker}
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <CyberPanel className="animate-in fade-in-0 duration-300">
        {header}
        <div className="space-y-3 p-4 sm:p-6">
          <FlipFlashcard
            key={current.id}
            item={current}
            index={index}
            total={deck.length}
            flipped={flipped}
            onFlip={() => setFlipped((f) => !f)}
            onPrev={handlePrev}
            onNext={handleNext}
            canGoPrev={index > 0}
            score={score}
            onGrade={handleGrade}
            feedback={gradeFeedback}
          />
          {next.kind === "loading" && (
            <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin text-cyan-300" />
              {tStudyTools("preparingMoreInBackground", language)}
            </div>
          )}
        </div>
      </CyberPanel>
      {tracker}
    </div>
  );
}
