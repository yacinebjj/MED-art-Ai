"use client";

/**
 * "Flashcards" tab (see app/study/page.tsx) — a NotebookLM-style flip-card
 * deck, studied in BATCHES of 25 cards MIXED across every selected course
 * (the courses ticked in FlashcardCoursePicker, or every course of the
 * activated modules when none is ticked).
 *
 * Endless flow, no blocking "Bravo" screen:
 *  - the opening batch is the student's previously served cards, shuffled
 *    (/api/flashcards/pool), topped up with new ones if there are fewer than 25;
 *  - every later batch comes from /api/flashcards/generate, which pools the
 *    unseen cards of all selected courses, shuffles them (Fisher-Yates) and
 *    cuts 25 — and, when the selection runs low, first EXTENDS a course's set
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

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Layers, Loader2, AlertTriangle, LogIn, Lock, ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FlipFlashcard, type GradeFeedback } from "@/components/study/FlipFlashcard";
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
const BATCH_SIZE = 25;

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
    continue: "Continuer : 25 cartes suivantes",
    preparing: "Préparation du lot suivant…",
    extended: "De nouvelles cartes inédites ont été générées pour tes cours.",
    retry: "Réessayer",
    nextError: "Le lot suivant n'a pas pu être préparé.",
    restart: "Recommencer la session",
  },
  en: {
    batchDone: "Batch complete",
    batchLabel: "Batch",
    reviewed: "cards reviewed this session",
    continue: "Continue: next 25 cards",
    preparing: "Preparing the next batch…",
    extended: "Brand-new cards were generated for your courses.",
    retry: "Try again",
    nextError: "The next batch could not be prepared.",
    restart: "Restart the session",
  },
};

interface SavedSession {
  deck: FlashcardPoolItem[];
  index: number;
  score: { correct: number; incorrect: number };
  round: number;
  reviewedTotal: number;
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
          setFlipped(false);
          setStatus("ready");
          return;
        }
      }

      setScore({ correct: 0, incorrect: 0 });
      setRound(1);
      setReviewedTotal(0);

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
      const ordered =
        deepLinkIndex > 0 ? [opening[deepLinkIndex], ...opening.slice(0, deepLinkIndex), ...opening.slice(deepLinkIndex + 1)] : opening;

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
    saveSession(storageKey, { deck, index, score, round, reviewedTotal });
  }, [storageKey, status, deck, index, score, round, reviewedTotal]);

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

  function handleGrade(isCorrect: boolean) {
    if (gradeFeedbackTimeoutRef.current) return;
    setScore((prev) => (isCorrect ? { ...prev, correct: prev.correct + 1 } : { ...prev, incorrect: prev.incorrect + 1 }));
    setGradeFeedback(isCorrect ? "correct" : "incorrect");
    gradeFeedbackTimeoutRef.current = setTimeout(() => {
      gradeFeedbackTimeoutRef.current = null;
      setGradeFeedback(null);
      handleNext();
    }, GRADE_FEEDBACK_MS);
  }

  if (status === "loading") {
    return (
      <Card className="glass-card animate-in fade-in-0 shadow-soft duration-300">
        <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">{tStudyTools("preparingFlashcards", language)}</span>
        </CardContent>
      </Card>
    );
  }

  if (status === "needs-auth") {
    return (
      <Card className="glass-card animate-in fade-in-0 shadow-soft duration-300">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <LogIn className="h-6 w-6" />
          <p className="text-sm">{tStudyTools("signInForFlashcards", language)}</p>
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="glass-card animate-in fade-in-0 shadow-soft duration-300">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          <p className="text-sm">{error}</p>
          <Button variant="secondary" size="sm" onClick={handleRestart}>
            <RotateCcw className="h-3.5 w-3.5" />
            {copy.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status === "no-modules-active") {
    return (
      <Card className="glass-card animate-in fade-in-0 shadow-soft duration-300">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Layers className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-semibold text-foreground">{tStudyTools("noActiveModulesTitle", language)}</p>
          <p className="max-w-sm text-xs text-muted-foreground">{tStudyTools("noActiveModulesFlashcardsSubtitle", language)}</p>
          <FlashcardCoursePicker onSelectionChanged={handleSelectionChanged} />
        </CardContent>
      </Card>
    );
  }

  if (status === "empty-pool") {
    return (
      <Card className="glass-card animate-in fade-in-0 shadow-soft duration-300">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Layers className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-semibold text-foreground">{tStudyTools("emptyPoolTitle", language)}</p>
          <p className="max-w-sm text-xs text-muted-foreground">{error ?? tStudyTools("emptyPoolSubtitle", language)}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <FlashcardCoursePicker onSelectionChanged={handleSelectionChanged} />
            <Button variant="secondary" size="sm" onClick={handleRestart}>
              <RotateCcw className="h-3.5 w-3.5" />
              {copy.retry}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === "quota-exceeded") {
    return (
      <Card className="glass-card animate-in fade-in-0 shadow-soft duration-300">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Lock className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-semibold text-foreground">{tStudyTools("flashcardQuotaTitle", language)}</p>
          <p className="max-w-sm text-xs text-muted-foreground">{tStudyTools("flashcardQuotaSubtitle", language)}</p>
        </CardContent>
      </Card>
    );
  }

  const current = deck[index];
  const header = (
    <CardHeader className="flex flex-row flex-wrap items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
        <Layers className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <CardTitle>{tStudyTools("flashcardsActiveModulesTitle", language)}</CardTitle>
        <p className="truncate text-sm text-muted-foreground">
          {copy.batchLabel} {round}
          {current ? ` · ${current.courseTitle}` : ""}
        </p>
      </div>
      <AiLanguageSelect compact />
      <FlashcardCoursePicker onSelectionChanged={handleSelectionChanged} />
    </CardHeader>
  );

  if (!current) {
    // End of a batch — never a dead end: the next batch is (being) prepared.
    return (
      <Card className="glass-card animate-in fade-in-0 shadow-soft duration-300">
        {header}
        <CardContent className="flex flex-col items-center gap-3 pb-12 pt-4 text-center">
          <p className="text-sm font-semibold text-foreground">
            {copy.batchDone} · {copy.batchLabel} {round}
          </p>
          <p className="text-xs text-muted-foreground">
            {reviewedTotal} {copy.reviewed} · ✓ {score.correct} · ✗ {score.incorrect}
          </p>

          {next.kind === "ready" ? (
            <>
              {next.extended && (
                <p className="flex items-center gap-1.5 text-xs text-violet-700 dark:text-violet-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  {copy.extended}
                </p>
              )}
              <Button size="sm" onClick={handleContinue}>
                {copy.continue}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : next.kind === "quota" ? (
            <>
              <Lock className="h-6 w-6 text-amber-500" />
              <p className="text-sm font-semibold text-foreground">{tStudyTools("flashcardQuotaTitle", language)}</p>
              <p className="max-w-sm text-xs text-muted-foreground">{tStudyTools("flashcardQuotaSubtitle", language)}</p>
            </>
          ) : next.kind === "error" ? (
            <>
              <p className="max-w-sm text-xs text-muted-foreground">
                {copy.nextError} {next.message}
              </p>
              <Button variant="secondary" size="sm" onClick={prefetchNext}>
                <RotateCcw className="h-3.5 w-3.5" />
                {copy.retry}
              </Button>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {copy.preparing}
            </p>
          )}

          <Button variant="ghost" size="sm" onClick={handleRestart}>
            <RotateCcw className="h-3.5 w-3.5" />
            {copy.restart}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card animate-in fade-in-0 shadow-soft duration-300">
      {header}
      <CardContent className="space-y-3">
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
          <div className="mx-auto flex w-fit items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {tStudyTools("preparingMoreInBackground", language)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
