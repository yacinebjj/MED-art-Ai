"use client";

/**
 * "Flashcards" tab (see app/study/page.tsx) — a NotebookLM-style flip-card
 * deck of freshly AI-generated Q&A pairs pooled and shuffled across ALL of
 * the student's activated modules/courses (see
 * app/api/flashcards/pool/route.ts) — a rich blended mix, not limited to one
 * course. Always reachable via its own tab, independent of any other
 * feature's state.
 *
 * NOT wired into qcm_attempts/the Leitner box — this is a casual "cram
 * everything" mode, not formal spaced repetition (see
 * lib/ai/flashcard-prompts.ts's header comment for the full architecture).
 * The correct/incorrect score tracked here (via FlipFlashcard) is a
 * session-local counter for the student's own feedback — never sent to the
 * server, only ever persisted to localStorage alongside the deck itself (see
 * below).
 *
 * Lazy, capped stream: the initial load tops the deck up to (at least) 20
 * cards in one blocking round-trip (cached pool cards first, a single
 * generate() call only for whatever's still missing) so the student can
 * start immediately. From then on, every navigation checks how many UNSEEN
 * cards remain ahead of the new index — once that drops to LOW_WATER_MARK or
 * below, a background generate() call fires WITHOUT blocking navigation,
 * appending results to the in-memory deck (index is never touched by this,
 * so the student's position never jumps). SESSION_CAP stops all further
 * generation once this session has loaded 60 cards total, protecting API
 * spend — the backend enforces the same ceiling independently (see
 * app/api/flashcards/generate/route.ts), this is just the fast local check
 * that avoids the round-trip.
 *
 * Resume-where-left-off: the whole deck + current index + score are mirrored
 * into localStorage, keyed by the sorted set of active module ids (so
 * switching which courses are activated naturally lands on a fresh/different
 * saved session rather than mixing them). On mount, a matching saved session
 * is restored VERBATIM — no new pool/generate fetch at all — so leaving the
 * tab (or the whole app) and coming back drops the student on the exact
 * card, with the exact score, they left. A deep-linked push-notification
 * card (`?cardId=`) always bypasses the saved session, since the student
 * explicitly asked to see that one card.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Layers, Loader2, AlertTriangle, LogIn, Lock, PartyPopper, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FlipFlashcard, type GradeFeedback } from "@/components/study/FlipFlashcard";
import { FlashcardCoursePicker } from "@/components/study/FlashcardCoursePicker";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/providers/LanguageProvider";
import { tStudyTools } from "@/lib/translations/studyTools";
import type { FlashcardPoolItem } from "@/types/flashcard";

/** How long the warm "Bien joué !" / "Pas grave, on continue" confirmation
 * stays on screen before the deck advances — long enough to register as
 * deliberate feedback, short enough to never feel like it's stalling the
 * session. */
const GRADE_FEEDBACK_MS = 550;

type Status = "loading" | "needs-auth" | "error" | "no-modules-active" | "empty-pool" | "quota-exceeded" | "ready";

/** Once fewer than this many UNSEEN cards remain in the loaded deck, a background top-up fires. */
const LOW_WATER_MARK = 5;

/** A fresh session always tries to have at least this many cards ready up front. */
const INITIAL_BATCH_TARGET = 20;

/** Hard ceiling on cards loaded into one session's deck — mirrors the backend's own SESSION_CAP (see app/api/flashcards/generate/route.ts and /api/flashcards/pool/route.ts's MAX_POOL_SIZE). */
const SESSION_CAP = 60;

const STORAGE_PREFIX = "medart:flashcards-session:";

interface SavedSession {
  deck: FlashcardPoolItem[];
  index: number;
  score: { correct: number; incorrect: number };
}

/**
 * SECURITY FIX: previously keyed ONLY by the sorted active-module-id set,
 * with no user component at all — since localStorage is scoped to the
 * BROWSER ORIGIN, not per-account, a student's own flashcard deck/progress/
 * score could leak to a DIFFERENT student who later activates the same
 * modules on the same shared/lab computer. Found during the same security
 * audit that caught the identical pattern in the Workspace module page
 * (app/dashboard/workspace/module/[moduleId]/page.tsx). Now namespaced by
 * userId (resolved client-side, see the load() effect below) — order-
 * independent on activeModuleIds so activating the same set in a different
 * sequence still resumes the same saved session.
 */
function getStorageKey(userId: string, activeModuleIds: number[], activeCourseIds: number[]): string {
  const modulesPart = [...activeModuleIds].sort((a, b) => a - b).join(",");
  const coursesPart = [...activeCourseIds].sort((a, b) => a - b).join(",");
  return `${STORAGE_PREFIX}${userId}:${modulesPart}:${coursesPart}`;
}

/** Removes every OTHER flashcard-session entry in this browser's storage — the old unscoped key format, and any DIFFERENT user's own scoped entries left behind on a shared device. Safe: this is a pure "resume where I left off" convenience cache, never the only copy of anything (the real content lives server-side), so losing a stale entry just means that other session starts fresh next time instead of resuming. */
function purgeForeignFlashcardSessions(currentKey: string): void {
  try {
    for (const existingKey of Object.keys(window.localStorage)) {
      if (existingKey.startsWith(STORAGE_PREFIX) && existingKey !== currentKey) {
        window.localStorage.removeItem(existingKey);
      }
    }
  } catch {
    // Storage unavailable — nothing to clean up either way.
  }
}

/** Fisher-Yates — used instead of `.sort(() => Math.random() - 0.5)`, which is a well-known non-uniform shuffle. Mirrors app/api/flashcards/pool/route.ts's own shuffle(). */
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

/** Defensive about shape — a saved session from a since-changed app version should never crash the deck, just be treated as absent. */
function loadSavedSession(key: string): SavedSession | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.deck) || !parsed.deck.every(isFlashcardPoolItem)) return null;
    if (typeof parsed.index !== "number" || parsed.index < 0 || parsed.index > parsed.deck.length) return null;
    const score =
      parsed.score && typeof parsed.score.correct === "number" && typeof parsed.score.incorrect === "number"
        ? parsed.score
        : { correct: 0, incorrect: 0 };
    return { deck: parsed.deck, index: parsed.index, score };
  } catch {
    return null;
  }
}

function saveSession(key: string, session: SavedSession): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(session));
  } catch {
    // Quota exceeded / privacy mode — resuming is a nice-to-have, never worth crashing the session over.
  }
}

function clearSavedSession(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Same as above — best-effort only.
  }
}

async function fetchPool(): Promise<
  | { ok: true; items: FlashcardPoolItem[]; activeModuleCount: number; activeModuleIds: number[]; activeCourseIds: number[] }
  | { ok: false; status: number; error?: string }
> {
  const res = await fetch("/api/flashcards/pool").catch(() => null);
  if (!res) return { ok: false, status: 0 };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, error: body?.error };
  }
  const body = await res.json().catch(() => ({}));
  return {
    ok: true,
    items: Array.isArray(body.items) ? body.items : [],
    activeModuleCount: body.activeModuleCount ?? 0,
    activeModuleIds: Array.isArray(body.activeModuleIds) ? body.activeModuleIds : [],
    activeCourseIds: Array.isArray(body.activeCourseIds) ? body.activeCourseIds : [],
  };
}

interface RequestMoreCardsResult {
  items: FlashcardPoolItem[];
  /** A 403 specifically means the plan's monthly flashcard quota is exhausted — distinct from every OTHER non-ok status (network error, 429, 500), which just means "try again," not "upgrade your plan." Previously any non-ok response silently became an empty array, indistinguishable from "genuinely no more content" — see the two call sites below for why that was actively misleading. Found during a security/UX audit. */
  quotaExceeded: boolean;
}

/** `sessionCount` lets the backend enforce SESSION_CAP itself rather than trusting the frontend not to ask again. */
async function requestMoreCards(sessionCount: number): Promise<RequestMoreCardsResult> {
  const res = await fetch("/api/flashcards/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionCount }),
  }).catch(() => null);
  if (!res) return { items: [], quotaExceeded: false };
  if (!res.ok) return { items: [], quotaExceeded: res.status === 403 };
  const body = await res.json().catch(() => ({}));
  return { items: Array.isArray(body.items) ? body.items : [], quotaExceeded: false };
}

export function ActiveFlashcardsDeck() {
  // A push notification's deep link (public/sw.js -> /study?tab=flashcards&cardId=...)
  // names the exact card it showed — this card is never removed from its
  // course's flashcard_queue after being served, so it's guaranteed to
  // still be somewhere in the pool fetch below; this just moves it to the
  // front so the student sees the SAME card they clicked the notification
  // for, not a random one. It also takes priority over resuming a saved
  // session (see the load effect below) — the student explicitly asked to
  // see this specific card.
  const searchParams = useSearchParams();
  const deepLinkCardId = searchParams.get("cardId");
  const { language } = useLanguage();

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [deck, setDeck] = useState<FlashcardPoolItem[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [score, setScore] = useState({ correct: 0, incorrect: 0 });
  const [isGeneratingMore, setIsGeneratingMore] = useState(false);
  // Set when a background top-up (not the initial load — see quota-exceeded
  // Status for that) hits the plan's flashcard cap. Read only by the
  // "ran off the end of the deck" render below, to distinguish "you hit
  // your quota" from the genuine completion message.
  const [backgroundQuotaExceeded, setBackgroundQuotaExceeded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Transient post-grade confirmation shown by FlipFlashcard — see
  // GRADE_FEEDBACK_MS. Locked via a ref (not just checking this state) so a
  // rapid double-click on a grade button can't queue two overlapping
  // timers/advances.
  const [gradeFeedback, setGradeFeedback] = useState<GradeFeedback>(null);
  const gradeFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which localStorage slot this session belongs to — derived from the
  // active module ids returned by the pool fetch, so it's only known once
  // that resolves. Persistence (the effect further down) is a no-op until
  // this is set.
  const [storageKey, setStorageKey] = useState<string | null>(null);

  // Refs mirror the state used inside the background top-up's async
  // closure — avoids a stale `deck`/`isGeneratingMore` snapshot from the
  // render that scheduled it.
  const deckRef = useRef<FlashcardPoolItem[]>([]);
  deckRef.current = deck;
  const generatingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      const pool = await fetchPool();
      if (cancelled) return;

      if (!pool.ok) {
        if (pool.status === 401) setStatus("needs-auth");
        else {
          setStatus("error");
          setError(pool.error ?? tStudyTools("serverContactError", language));
        }
        return;
      }

      // Nothing active AT ALL — a whole module, or a specific course picked
      // via FlashcardCoursePicker, either one is enough to leave this state.
      if (pool.activeModuleCount === 0 && pool.activeCourseIds.length === 0) {
        setStatus("no-modules-active");
        return;
      }

      // Resolved from the browser's own session (fetchPool()'s 401 check
      // above already proved a session exists) — never touch storage before
      // knowing WHOSE slot it is. See getStorageKey's own comment.
      const {
        data: { user },
      } = await createClient().auth.getUser();
      if (cancelled) return;
      if (!user) {
        setStatus("needs-auth");
        return;
      }

      const key = getStorageKey(user.id, pool.activeModuleIds, pool.activeCourseIds);
      purgeForeignFlashcardSessions(key);
      setStorageKey(key);

      // Resume where the student left off — skip the fetch/generate flow
      // entirely and restore the exact deck, index, and score. Never when a
      // push notification asked for one specific card instead.
      if (!deepLinkCardId) {
        const saved = loadSavedSession(key);
        if (saved) {
          setDeck(saved.deck);
          setIndex(saved.index);
          setScore(saved.score);
          setFlipped(false);
          setStatus("ready");
          return;
        }
      }

      setScore({ correct: 0, incorrect: 0 });

      let items = pool.items;
      let quotaExceededWithNoCards = false;
      if (items.length < INITIAL_BATCH_TARGET && items.length < SESSION_CAP) {
        // Cached pool didn't already cover a full initial batch — generate
        // just enough to reach the target in this one blocking round-trip.
        const topUp = await requestMoreCards(items.length);
        if (cancelled) return;
        // Re-shuffle the WHOLE combined pool (not just the new portion) so
        // the top-up batch is interleaved throughout the deck instead of
        // landing as one contiguous, unshuffled block at the end — the
        // pool fetch above only shuffled the original `items` on its own.
        // Must happen before deepLinkIndex/orderedItems below, since that
        // logic locates a deep-linked card by its position in the FINAL order.
        if (topUp.items.length > 0) items = shuffle([...items, ...topUp.items]);
        else if (topUp.quotaExceeded) quotaExceededWithNoCards = true;
      }

      if (items.length === 0) {
        // Distinct from "empty-pool" — the student's plan cap is the reason
        // there's nothing to show, not "no content exists yet." Showing the
        // generic empty-pool message here would send them to go generate an
        // Explication that would ALSO immediately fail on the same cap.
        setStatus(quotaExceededWithNoCards ? "quota-exceeded" : "empty-pool");
        return;
      }

      const deepLinkIndex = deepLinkCardId ? items.findIndex((item) => item.id === deepLinkCardId) : -1;
      const orderedItems =
        deepLinkIndex > 0 ? [items[deepLinkIndex], ...items.slice(0, deepLinkIndex), ...items.slice(deepLinkIndex + 1)] : items;

      setDeck(orderedItems);
      setIndex(0);
      setFlipped(false);
      setStatus("ready");
    }

    load();
    return () => {
      cancelled = true;
    };
    // `language` is read for its value at the moment an error/status string
    // is produced, not a reason to re-run the whole load/generate flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, deepLinkCardId]);

  // Mirrors the live session into localStorage on every change, so leaving
  // the tab/app and coming back resumes exactly here. Runs after the load
  // effect above sets `storageKey` and status becomes "ready" — never fires
  // while a fetch/generate/restore is still in flight.
  useEffect(() => {
    if (status !== "ready" || !storageKey) return;
    saveSession(storageKey, { deck, index, score });
  }, [storageKey, status, deck, index, score]);

  // Cross-tab sync: the native `storage` event fires in every OTHER tab
  // sharing this origin when localStorage changes — never in the tab that
  // made the change itself, so this can't loop with the persist effect
  // above. Two tabs studying the same active-course set used to silently
  // clobber each other's progress (whichever saved last, won); this instead
  // pulls the other tab's card/score into THIS tab's state the moment it
  // changes, so both stay on the same card with the same score. Deliberately
  // scoped to in-place updates only — a "Recommencer" in another tab (which
  // REMOVES the key, `e.newValue === null`) does not reset this tab out from
  // under a student who might be mid-card; it'll simply pick up the fresh
  // session next time IT reloads (a manual reload here won't need to).
  useEffect(() => {
    const key = storageKey;
    if (!key) return;
    function handleStorageChange(e: StorageEvent) {
      // Re-checking `!key` here (already guarded above) is what lets
      // TypeScript narrow it to `string` inside this nested function —
      // narrowing from an outer scope's early return doesn't carry into a
      // function declaration that could in principle be called later.
      if (!key || e.key !== key || e.newValue === null || status !== "ready") return;
      const saved = loadSavedSession(key);
      if (!saved) return;
      setDeck(saved.deck);
      setIndex(saved.index);
      setScore(saved.score);
      setFlipped(false);
    }
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [storageKey, status]);

  // Belt-and-suspenders cleanup: if the student navigates away mid-flash
  // (e.g. switches tabs) the pending advance is cancelled rather than
  // firing setState on an unmounted component.
  useEffect(() => {
    return () => {
      if (gradeFeedbackTimeoutRef.current) clearTimeout(gradeFeedbackTimeoutRef.current);
    };
  }, []);

  function handleRestart() {
    if (storageKey) clearSavedSession(storageKey);
    setReloadKey((k) => k + 1);
  }

  /** FlashcardCoursePicker just changed profiles.flashcard_active_course_ids — reload the pool so the new selection takes effect. No explicit clearSavedSession: the new selection resolves to a DIFFERENT composite storageKey (see getStorageKey), so the old session simply isn't read; purgeForeignFlashcardSessions cleans it up on the next load. */
  function handleSelectionChanged() {
    setReloadKey((k) => k + 1);
  }

  function maybeTriggerBackgroundGeneration(nextIndex: number) {
    const remainingAhead = deckRef.current.length - nextIndex;
    if (remainingAhead > LOW_WATER_MARK || deckRef.current.length >= SESSION_CAP || generatingRef.current) return;

    generatingRef.current = true;
    setIsGeneratingMore(true);
    requestMoreCards(deckRef.current.length)
      .then((result) => {
        // Appends only — index is never touched, so the student's current
        // card and scroll position never jump when a background batch lands.
        if (result.items.length > 0) {
          setDeck((prev) => [...prev, ...result.items].slice(0, SESSION_CAP));
        } else if (result.quotaExceeded) {
          setBackgroundQuotaExceeded(true);
        }
      })
      .finally(() => {
        generatingRef.current = false;
        setIsGeneratingMore(false);
      });
  }

  function handleNext() {
    const nextIndex = index + 1;
    setFlipped(false);
    setIndex(nextIndex);
    maybeTriggerBackgroundGeneration(nextIndex);
  }

  function handlePrev() {
    if (index === 0) return;
    setFlipped(false);
    setIndex(index - 1);
  }

  function handleGrade(isCorrect: boolean) {
    if (gradeFeedbackTimeoutRef.current) return; // already mid-flash — ignore a double click
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
          <p className="max-w-sm text-xs text-muted-foreground">
            {tStudyTools("noActiveModulesFlashcardsSubtitle", language)}
          </p>
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
          <p className="max-w-sm text-xs text-muted-foreground">
            {tStudyTools("emptyPoolSubtitle", language)}
          </p>
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

  if (!current) {
    // Ran off the end of the loaded deck — only reachable if the student
    // blitzed through faster than the background top-up could keep up, or
    // the session hit SESSION_CAP.
    return (
      <Card className="glass-card animate-in fade-in-0 shadow-soft duration-300">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          {isGeneratingMore ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{tStudyTools("generatingNewFlashcards", language)}</p>
            </>
          ) : backgroundQuotaExceeded && deck.length < SESSION_CAP ? (
            // Distinct from the completion message below — the reason no
            // more cards arrived is the plan's monthly cap, not "genuinely
            // no more content exists." Previously this branch was
            // unreachable — a quota-exceeded background top-up silently
            // returned an empty array, indistinguishable from real
            // completion, so a student who hit their cap was told "Bravo !"
            // instead of being told to upgrade. Found during a security/UX
            // audit. Guarded by `deck.length < SESSION_CAP` — if the
            // session cap was ALSO reached, that's a genuine, unrelated
            // completion and gets the normal message instead.
            <>
              <Lock className="h-8 w-8 text-amber-500" />
              <p className="text-sm font-semibold text-foreground">{tStudyTools("flashcardQuotaTitle", language)}</p>
              <p className="max-w-sm text-xs text-muted-foreground">{tStudyTools("flashcardQuotaSubtitle", language)}</p>
            </>
          ) : (
            <>
              {/* This is always a completion, never an error — whether the
                  session hit the hard 60-card cap or genuinely ran out of
                  generatable content first, the student made it through
                  every card that was available. A neutral/empty-looking
                  message here (as this used to say) reads as something
                  broke; it didn't. */}
              <PartyPopper className="h-8 w-8 text-emerald-500" />
              <p className="text-sm font-semibold text-foreground">
                {deck.length >= SESSION_CAP
                  ? tStudyTools("sessionCompleteStreak", language)
                  : tStudyTools("deckExhausted", language)}
              </p>
              <Button variant="secondary" size="sm" onClick={handleRestart}>
                <RotateCcw className="h-3.5 w-3.5" />
                {tStudyTools("restartSession", language)}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card animate-in fade-in-0 shadow-soft duration-300">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          <Layers className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle>{tStudyTools("flashcardsActiveModulesTitle", language)}</CardTitle>
          <p className="truncate text-sm text-muted-foreground">{current.courseTitle}</p>
        </div>
        <FlashcardCoursePicker onSelectionChanged={handleSelectionChanged} />
      </CardHeader>
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
        {isGeneratingMore && (
          <div className="mx-auto flex w-fit items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {tStudyTools("preparingMoreInBackground", language)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
