"use client";

/**
 * Workspace "Lab" flashcards — an active-recall deck scoped to ONE course,
 * with real Leitner spaced repetition (5 boxes, intervals from lib/srs.ts).
 *
 * Cards come from app/api/studio/flashcards — the course's cross-student
 * "definitive set" (the same cache entry the Study page's deck uses), so
 * opening this costs nothing once any student has generated that course's
 * set. Scheduling state is purely client-side and per device: one
 * {box, dueAt, reviews, lapses, lastRating} record per card, persisted in
 * localStorage under a user-namespaced key (never shared between two
 * accounts on the same browser), memory-only when no user is known. The UI
 * says so honestly ("Progression enregistrée sur cet appareil").
 *
 * Card ids are derived from a hash of the normalized question, so progress
 * survives reloads and re-fetches as long as the set itself is unchanged.
 *
 * Three views: "Réviser" (the SRS session: due cards first, then new ones,
 * optionally everything + shuffle), "Parcourir" (free flip-through, ←/→),
 * "Liste" (searchable list with each card's box). Keyboard shortcuts only act
 * once the student last clicked/focused inside the deck, and are ignored
 * while a text field, a menu or a foreign dialog has focus.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Download,
  Eye,
  FileDown,
  HardDrive,
  Info,
  Layers,
  List,
  Loader2,
  Lock,
  LogIn,
  MessageSquareText,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  Shuffle,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/providers/AuthProvider";
import { buildRateLimitMessage } from "@/lib/rate-limit-message";
import { LEITNER_INTERVAL_DAYS, MAX_LEITNER_BOX } from "@/lib/srs";
import { cn } from "@/lib/utils";

export interface FlashcardsLabProps {
  courseId: number;
  courseTitle: string;
  /** True when the course already has its Explication generated (otherwise show the requirement and a hint instead of calling the API). */
  hasExplication: boolean;
  onAskInChat?: (prompt: string) => void;
}

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface LabCard {
  id: string;
  question: string;
  answer: string;
}

type Rating = "again" | "hard" | "good" | "easy";

interface CardProgress {
  box: number;
  /** Epoch ms — always a local midnight, see scheduleRating. */
  dueAt: number;
  reviews: number;
  lapses: number;
  lastRating: Rating | null;
  lastReviewedAt: number;
}

type ProgressMap = Record<string, CardProgress>;

type View = "review" | "browse" | "list";

type LoadState =
  | { status: "requirement" }
  | { status: "loading" }
  | { status: "ready"; cards: LabCard[] }
  | { status: "error"; kind: "quota" | "rate-limit" | "auth" | "generic"; message: string };

interface SessionOptions {
  includeAll: boolean;
  shuffled: boolean;
}

interface Session {
  queue: string[];
  index: number;
  log: { cardId: string; rating: Rating }[];
  masteryAtStart: number;
}

interface DeckStats {
  total: number;
  fresh: number;
  /** Index 0 = box 1 … index 4 = box 5. */
  boxes: number[];
  due: number;
  mastery: number;
  nextDueAt: number | null;
}

const STORAGE_PREFIX = "medart:lab-flashcards:";
const STORAGE_VERSION = 1;

const EXPLICATION_REQUIRED_MESSAGE =
  "Génère d'abord l'Explication Ultra-Détaillée de ce cours : les flashcards en sont extraites.";

/** A cache hit answers in well under a second; past this, the student is almost certainly waiting on a first-ever generation and deserves to know why. */
const SLOW_GENERATION_HINT_MS = 4000;

const DAY_MS = 24 * 60 * 60 * 1000;

const RATINGS: { rating: Rating; label: string; shortcut: string; className: string }[] = [
  {
    rating: "again",
    label: "À revoir",
    shortcut: "1",
    className:
      "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20",
  },
  {
    rating: "hard",
    label: "Difficile",
    shortcut: "2",
    className:
      "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20",
  },
  {
    rating: "good",
    label: "Bien",
    shortcut: "3",
    className:
      "border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-300 dark:hover:bg-primary-500/20",
  },
  {
    rating: "easy",
    label: "Facile",
    shortcut: "4",
    className:
      "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20",
  },
];

/**
 * Matched on the PHYSICAL key first: on an AZERTY keyboard (most of this
 * app's students) the unshifted digit row types & é " ' — `event.key` would
 * never be "1"–"4". `event.key` stays as a fallback for layouts/devices that
 * report no usable `code`.
 */
const RATING_BY_CODE: Record<string, Rating> = {
  Digit1: "again",
  Numpad1: "again",
  Digit2: "hard",
  Numpad2: "hard",
  Digit3: "good",
  Numpad3: "good",
  Digit4: "easy",
  Numpad4: "easy",
};
const RATING_BY_KEY: Record<string, Rating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };

function ratingForKeyEvent(event: KeyboardEvent): Rating | undefined {
  return RATING_BY_CODE[event.code] ?? RATING_BY_KEY[event.key];
}

/** Red → green progression, so the distribution bar reads as "how mastered" at a glance. */
const BOX_STYLES: Record<number, { bar: string; chip: string }> = {
  1: { bar: "bg-rose-500", chip: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
  2: { bar: "bg-orange-400", chip: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300" },
  3: { bar: "bg-amber-400", chip: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  4: { bar: "bg-lime-500", chip: "bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300" },
  5: { bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
};
const NEW_CARD_STYLE = {
  bar: "bg-slate-300 dark:bg-slate-600",
  chip: "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300",
};

const EMPTY_CARDS: LabCard[] = [];

/**
 * Per-page-lifetime memo of each course's deck. The workspace can unmount
 * and remount the Lab every time the student switches tools; without this,
 * each switch would re-hit the API (cheap on a cache hit, but still a round
 * trip and a slot in the AI rate-limit window). A course's set only changes
 * if its explication does, which never happens mid-session.
 */
const deckCache = new Map<number, LabCard[]>();

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** cyrb53 — fast, well-distributed, non-cryptographic 53-bit string hash. */
function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Accent/case-insensitive form — used for search and for stable card ids. */
function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Validates the API payload and assigns each card a stable id from its question (suffixed if two questions are identical). */
function toLabCards(raw: unknown[]): LabCard[] {
  const seen = new Map<string, number>();
  const cards: LabCard[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { question, answer } = item as Record<string, unknown>;
    if (typeof question !== "string" || typeof answer !== "string") continue;
    const q = question.trim();
    const a = answer.trim();
    if (!q || !a) continue;
    const base = `fc-${hashString(foldText(q))}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    cards.push({ id: occurrence === 1 ? base : `${base}-${occurrence}`, question: q, answer: a });
  }
  return cards;
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Calendar-day arithmetic (DST-safe), not `+ n * DAY_MS`. */
function addLocalDays(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/** Whole calendar days between two timestamps — rounded so a 23h/25h DST day still counts as one. */
function calendarDaysBetween(from: number, to: number): number {
  return Math.round((startOfLocalDay(to) - startOfLocalDay(from)) / DAY_MS);
}

function nextBoxFor(currentBox: number, rating: Rating): number {
  switch (rating) {
    case "again":
      return 1;
    case "hard":
      return currentBox;
    case "good":
      return Math.min(currentBox + 1, MAX_LEITNER_BOX);
    case "easy":
      return Math.min(currentBox + 2, MAX_LEITNER_BOX);
  }
}

function intervalDaysForBox(box: number): number {
  return LEITNER_INTERVAL_DAYS[box] ?? 1;
}

/**
 * Leitner step. A never-seen card starts in box 1. Due dates land on a local
 * midnight (unlike lib/srs.ts's exact `now + interval`, built for a server
 * table): a card rated at 22:00 is "due tomorrow" for the whole of
 * tomorrow, not only from 22:00 — what a student actually expects.
 *
 * `lapsedThisSession`: the card was rated "À revoir" earlier in the SAME
 * session. Recalling it on the end-of-session retry only proves it was
 * relearned minutes ago, so it must not jump to box 2/3 and erase the lapse:
 * it stays in box 1 (due tomorrow) and only the review itself is counted.
 */
function scheduleRating(previous: CardProgress | undefined, rating: Rating, now: number, lapsedThisSession = false): CardProgress {
  if (lapsedThisSession && rating !== "again") {
    return {
      box: 1,
      dueAt: addLocalDays(startOfLocalDay(now), intervalDaysForBox(1)),
      reviews: (previous?.reviews ?? 0) + 1,
      lapses: previous?.lapses ?? 0,
      lastRating: rating,
      lastReviewedAt: now,
    };
  }
  const box = nextBoxFor(previous?.box ?? 1, rating);
  return {
    box,
    dueAt: addLocalDays(startOfLocalDay(now), intervalDaysForBox(box)),
    reviews: (previous?.reviews ?? 0) + 1,
    lapses: (previous?.lapses ?? 0) + (rating === "again" ? 1 : 0),
    lastRating: rating,
    lastReviewedAt: now,
  };
}

/** Fisher-Yates (a `.sort(() => Math.random() - 0.5)` shuffle is biased). */
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Due cards first (most overdue first), then new cards, then — only with "Réviser tout" — not-yet-due ones. Shuffling happens WITHIN each group so due cards keep their priority. */
function buildQueue(cards: LabCard[], progress: ProgressMap, options: SessionOptions, now: number): string[] {
  const due: LabCard[] = [];
  const fresh: LabCard[] = [];
  const later: LabCard[] = [];
  for (const card of cards) {
    const state = progress[card.id];
    if (!state) fresh.push(card);
    else if (state.dueAt <= now) due.push(card);
    else later.push(card);
  }
  const byDueAt = (a: LabCard, b: LabCard) => progress[a.id].dueAt - progress[b.id].dueAt;
  due.sort(byDueAt);
  later.sort(byDueAt);
  const groups = options.includeAll ? [due, fresh, later] : [due, fresh];
  return groups.flatMap((group) => (options.shuffled ? shuffle(group) : group)).map((card) => card.id);
}

function computeMastery(cards: LabCard[], progress: ProgressMap): number {
  if (cards.length === 0) return 0;
  let sum = 0;
  for (const card of cards) {
    const state = progress[card.id];
    if (state) sum += (state.box - 1) / (MAX_LEITNER_BOX - 1);
  }
  return sum / cards.length;
}

function computeDeckStats(cards: LabCard[], progress: ProgressMap, now: number): DeckStats {
  const boxes = Array.from({ length: MAX_LEITNER_BOX }, () => 0);
  let fresh = 0;
  let due = 0;
  let nextDueAt: number | null = null;
  for (const card of cards) {
    const state = progress[card.id];
    if (!state) {
      fresh++;
      continue;
    }
    boxes[state.box - 1]++;
    if (state.dueAt <= now) due++;
    else if (nextDueAt === null || state.dueAt < nextDueAt) nextDueAt = state.dueAt;
  }
  return { total: cards.length, fresh, boxes, due, mastery: computeMastery(cards, progress), nextDueAt };
}

function createSession(cards: LabCard[], progress: ProgressMap, options: SessionOptions, now: number): Session {
  return { queue: buildQueue(cards, progress, options, now), index: 0, log: [], masteryAtStart: computeMastery(cards, progress) };
}

/** True when this card was already rated "À revoir" earlier in the session — see scheduleRating. */
function lapsedInSession(session: Session, cardId: string): boolean {
  return session.log.some((entry) => entry.cardId === cardId && entry.rating === "again");
}

function formatDueRelative(dueAt: number, now: number): string {
  const days = calendarDaysBetween(now, dueAt);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "demain";
  if (days < 7) return `dans ${days} jours`;
  return `le ${new Date(dueAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`;
}

function formatInterval(days: number): string {
  return days >= 30 ? "1 mois" : `${days} j`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

function buildChatPrompt(card: LabCard, courseTitle: string): string {
  return [
    `Explique-moi cette flashcard du cours « ${courseTitle} » :`,
    "",
    `Question : ${card.question}`,
    `Réponse : ${card.answer}`,
    "",
    "Détaille le raisonnement (mécanisme, pièges fréquents à l'examen) et donne-moi une astuce pour bien la retenir.",
  ].join("\n");
}

// --- Persistence ------------------------------------------------------------

const VALID_RATINGS = new Set<Rating>(["again", "hard", "good", "easy"]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Defensive about shape — an entry written by a since-changed app version is dropped, never allowed to crash the deck. */
function parseStoredProgress(raw: string | null): ProgressMap | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; cards?: unknown };
    if (!parsed || parsed.v !== STORAGE_VERSION || !parsed.cards || typeof parsed.cards !== "object") return null;
    const result: ProgressMap = {};
    for (const [id, value] of Object.entries(parsed.cards as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      const box = entry.box;
      if (!isFiniteNumber(box) || !Number.isInteger(box) || box < 1 || box > MAX_LEITNER_BOX) continue;
      if (!isFiniteNumber(entry.dueAt)) continue;
      const lastRating = typeof entry.lastRating === "string" && VALID_RATINGS.has(entry.lastRating as Rating) ? (entry.lastRating as Rating) : null;
      result[id] = {
        box,
        dueAt: entry.dueAt,
        reviews: isFiniteNumber(entry.reviews) && entry.reviews >= 0 ? Math.floor(entry.reviews) : 0,
        lapses: isFiniteNumber(entry.lapses) && entry.lapses >= 0 ? Math.floor(entry.lapses) : 0,
        lastRating,
        lastReviewedAt: isFiniteNumber(entry.lastReviewedAt) ? entry.lastReviewedAt : 0,
      };
    }
    return result;
  } catch {
    return null;
  }
}

function readStoredProgress(key: string): ProgressMap {
  try {
    return parseStoredProgress(window.localStorage.getItem(key)) ?? {};
  } catch {
    return {};
  }
}

/** Returns false when storage is unavailable (privacy mode, quota) so the UI can stop claiming progress is saved. Prunes entries for cards no longer in the deck once the deck is known. */
function writeStoredProgress(key: string, progress: ProgressMap, deck: LabCard[] | null): boolean {
  try {
    let entries: ProgressMap = progress;
    if (deck) {
      entries = {};
      for (const card of deck) {
        const state = progress[card.id];
        if (state) entries[card.id] = state;
      }
    }
    const existing = window.localStorage.getItem(key);
    if (Object.keys(entries).length === 0 && existing === null) return true; // nothing to save yet — don't create an empty key
    const serialized = JSON.stringify({ v: STORAGE_VERSION, cards: entries });
    // Skipping identical writes also keeps the cross-tab `storage` sync below from ping-ponging.
    if (serialized !== existing) window.localStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

/** Keeps whichever record of each card was reviewed most recently. */
function mergeProgress(base: ProgressMap, overlay: ProgressMap): ProgressMap {
  const merged: ProgressMap = { ...base };
  for (const [id, state] of Object.entries(overlay)) {
    const existing = merged[id];
    if (!existing || state.lastReviewedAt > existing.lastReviewedAt) merged[id] = state;
  }
  return merged;
}

// --- Export -----------------------------------------------------------------

/** Anki's importer is told the fields are HTML (`#html:true`), so markup characters are escaped and newlines become <br>; a tab would split the field, so it becomes a space. */
function escapeAnkiField(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, " ")
    .replace(/\r\n|\r|\n/g, "<br>");
}

function fileSlug(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return slug || "cours";
}

function buildAnkiTsv(cards: LabCard[], courseTitle: string): string {
  const deckName = courseTitle.replace(/[\t\r\n]+/g, " ").replace(/::/g, " - ").trim() || "Cours";
  const header = ["#separator:tab", "#html:true", `#deck:MedArt AI::${deckName}`, `#tags:MedArtAI ${fileSlug(courseTitle)}`];
  const rows = cards.map((card) => `${escapeAnkiField(card.question)}\t${escapeAnkiField(card.answer)}`);
  return `${[...header, ...rows].join("\n")}\n`;
}

function buildMarkdown(cards: LabCard[], courseTitle: string): string {
  const lines = [`# Flashcards — ${courseTitle}`, ""];
  cards.forEach((card, i) => {
    lines.push(`## ${i + 1}. ${card.question.replace(/\s*\n\s*/g, " ")}`, "", card.answer, "");
  });
  return lines.join("\n").trimEnd() + "\n";
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied / insecure context — fall through to the legacy path.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

// --- Keyboard guards --------------------------------------------------------

function isEditableTarget(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Elements whose own Space/Enter activation must win over the deck's flip shortcut. */
function isActivatableTarget(target: Element | null): boolean {
  if (!target) return false;
  return !!target.closest('button, a[href], summary, [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="checkbox"], [role="switch"]');
}

/** Widgets that use the arrow keys themselves. */
function usesArrowKeys(target: Element | null): boolean {
  if (!target) return false;
  return !!target.closest('[role="slider"], [role="tab"], [role="radio"], [role="menuitem"], [role="option"], [role="listbox"], [role="combobox"], [role="tree"], [role="grid"]');
}

/** A control focused by a mouse click (no visible focus ring) — e.g. the "Mélanger" chip just clicked — shouldn't swallow the flip shortcut. Keyboard focus keeps native activation. */
function isKeyboardFocused(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true; // selector unsupported — keep native behaviour
  }
}

/** True when focus sits in a menu/dialog that does NOT contain the deck (e.g. the export menu, or an unrelated modal). A fullscreen dialog wrapping the deck itself still lets shortcuts through. */
function isInForeignOverlay(target: Element | null, root: HTMLElement): boolean {
  if (!target) return false;
  const overlay = target.closest('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]');
  return !!overlay && !overlay.contains(root);
}

// --- Network ----------------------------------------------------------------

/** Never aborted on purpose — see `inFlight` below. */
async function fetchDeck(courseId: number): Promise<LoadState> {
  let res: Response;
  try {
    res = await fetch("/api/studio/flashcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId }),
    });
  } catch {
    return { status: "error", kind: "generic", message: "Impossible de contacter le serveur. Vérifie ta connexion puis réessaie." };
  }

  const data = (await res.json().catch(() => ({}))) as { success?: boolean; code?: string; error?: string; cards?: unknown };

  if (res.status === 409 && data.code === "explication_required") return { status: "requirement" };
  if (res.status === 429) return { status: "error", kind: "rate-limit", message: buildRateLimitMessage(res) };
  if (res.status === 403) {
    return { status: "error", kind: "quota", message: data.error ?? "Tu as atteint la limite de générations de ta formule ce mois-ci." };
  }
  if (res.status === 401) return { status: "error", kind: "auth", message: data.error ?? "Tu dois être connecté(e)." };
  if (!res.ok || !data.success || !Array.isArray(data.cards)) {
    return { status: "error", kind: "generic", message: data.error ?? "La génération des flashcards a échoué. Réessaie dans un instant." };
  }
  return { status: "ready", cards: toLabCards(data.cards) };
}

/**
 * Deck requests in flight, keyed `${userId ?? "anon"}:${courseId}`.
 * Module-level on purpose (same idea as ClinicalCaseSimulator's store): the
 * Lab remounts when the Studio pane is expanded/collapsed, the Lab tool
 * changes, or the course changes and back. A first-ever generation can take
 * a minute; if a remount aborted it and fired a fresh request, the student
 * would be charged twice for the same set. So the request outlives the
 * instance that started it, fills `deckCache` itself, and whichever instance
 * is mounted for that key when it settles adopts the result.
 */
const inFlight = new Map<string, Promise<LoadState>>();

function inFlightKey(userId: string | null, courseId: number): string {
  return `${userId ?? "anon"}:${courseId}`;
}

/** Returns the request already in flight for this key, or starts one — never two at once. */
function loadDeck(userId: string | null, courseId: number): Promise<LoadState> {
  const key = inFlightKey(userId, courseId);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise: Promise<LoadState> = fetchDeck(courseId)
    .catch((): LoadState => ({ status: "error", kind: "generic", message: "La génération des flashcards a échoué. Réessaie dans un instant." }))
    .then((next) => {
      // Written by the request itself, so a result landing while no instance is mounted is still there on the next open.
      if (next.status === "ready" && next.cards.length > 0) deckCache.set(courseId, next.cards);
      return next;
    })
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-[color-mix(in_oklab,var(--background)_70%,transparent)] px-1 font-sans text-[10px] font-semibold leading-none opacity-80 shadow-[inset_0_-1px_0_0_rgb(0_0_0/0.08)] [@media(hover:none)]:hidden",
        className
      )}
    >
      {children}
    </kbd>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          type="button"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          whileTap={disabled ? undefined : { scale: 0.9 }}
          className={cn(
            "touch-target relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
            className
          )}
        >
          {children}
        </motion.button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function BoxChip({ state }: { state: CardProgress | undefined }) {
  const style = state ? BOX_STYLES[state.box] : NEW_CARD_STYLE;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold", style.chip)}>
      {state ? `Boîte ${state.box}` : "Nouvelle"}
    </span>
  );
}

function StatePanel({
  icon: Icon,
  tone = "muted",
  title,
  message,
  children,
}: {
  icon: LucideIcon;
  tone?: "muted" | "amber" | "primary";
  title: string;
  message?: string;
  children?: ReactNode;
}) {
  return (
    <div className="glass-card flex flex-col items-center gap-3 rounded-3xl px-6 py-12 text-center shadow-glass animate-in fade-in-0 duration-300 dark:shadow-glass-dark">
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-2xl",
          tone === "amber" && "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
          tone === "primary" && "bg-primary-100 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300",
          tone === "muted" && "bg-muted text-muted-foreground"
        )}
      >
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {message && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{message}</p>}
      {children}
    </div>
  );
}

function PillButton({
  onClick,
  children,
  variant = "secondary",
  className,
  ariaKeyShortcuts,
}: {
  onClick: () => void;
  children: ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
  ariaKeyShortcuts?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      aria-keyshortcuts={ariaKeyShortcuts}
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        variant === "primary"
          ? "bg-primary-600 text-white shadow-soft hover:bg-primary-500 hover:shadow-glow dark:bg-primary-500 dark:hover:bg-primary-400"
          : "border border-border bg-card text-foreground hover:bg-accent",
        className
      )}
    >
      {children}
    </motion.button>
  );
}

function ToggleChip({
  pressed,
  onClick,
  icon: Icon,
  label,
  tooltip,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          type="button"
          aria-pressed={pressed}
          onClick={onClick}
          whileTap={{ scale: 0.95 }}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pressed
              ? "border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-500/40 dark:bg-primary-500/15 dark:text-primary-300"
              : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </motion.button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[16rem]">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-primary-500 to-secondary-500"
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      />
    </div>
  );
}

function MasteryMeter({ stats }: { stats: DeckStats }) {
  const pct = Math.round(stats.mastery * 100);
  const segments = [
    { key: "new", label: "Nouvelles", fullLabel: "Nouvelles", title: "Jamais révisées", count: stats.fresh, bar: NEW_CARD_STYLE.bar },
    ...stats.boxes.map((count, i) => ({
      key: `box-${i + 1}`,
      label: `B${i + 1}`,
      fullLabel: `Boîte ${i + 1}`,
      title: `Boîte ${i + 1} — révision tous les ${plural(intervalDaysForBox(i + 1), "jour")}`,
      count,
      bar: BOX_STYLES[i + 1].bar,
    })),
  ];
  const ariaLabel = `Maîtrise ${pct} %. ${segments.map((s) => `${s.fullLabel} : ${s.count}`).join(", ")}.`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          Maîtrise
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Comment la maîtrise est calculée"
                className="touch-target relative inline-flex h-4 w-4 items-center justify-center rounded-full text-[color-mix(in_oklab,var(--muted-foreground)_70%,transparent)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[17rem]">
              Moyenne de la position de chaque carte dans les 5 boîtes de Leitner : une carte nouvelle ou en boîte 1 compte 0 %, une carte en boîte 5 compte 100 %.
            </TooltipContent>
          </Tooltip>
        </span>
        <span className="text-sm font-bold tabular-nums text-foreground">{pct} %</span>
      </div>
      <div role="img" aria-label={ariaLabel} className="mt-1.5 flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-muted">
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <motion.span
              key={segment.key}
              className={cn("h-full first:rounded-l-full last:rounded-r-full", segment.bar)}
              initial={false}
              animate={{ width: `${(segment.count / Math.max(stats.total, 1)) * 100}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-hidden>
        {segments.map((segment) => (
          <li key={segment.key} title={segment.title} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className={cn("h-2 w-2 rounded-full", segment.bar)} />
            {segment.label}
            <span className="font-semibold tabular-nums text-foreground">{segment.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardFace({ side, hidden, text }: { side: "front" | "back"; hidden: boolean; text: string }) {
  const isFront = side === "front";
  return (
    <span
      aria-hidden={hidden}
      style={{
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        transform: isFront ? undefined : "rotateY(180deg)",
      }}
      className={cn(
        "flex min-h-[15rem] flex-col rounded-3xl border p-5 shadow-soft [grid-area:1/1]",
        isFront
          ? "border-border bg-card"
          : "border-primary-300/70 bg-gradient-to-br from-primary-50 via-card to-card dark:border-primary-500/40 dark:from-primary-950/70"
      )}
    >
      <span
        className={cn(
          "text-[10px] font-black uppercase tracking-wider",
          isFront ? "text-muted-foreground" : "text-primary-700 dark:text-primary-300"
        )}
      >
        {isFront ? "Question" : "Réponse"}
      </span>
      <span className="flex flex-1 items-center justify-center py-4">
        <span
          className={cn(
            "block whitespace-pre-line break-words text-center leading-relaxed text-card-foreground",
            isFront ? "text-base font-semibold" : "text-[15px] font-medium"
          )}
        >
          {text}
        </span>
      </span>
      <span className="text-center text-[11px] text-[color-mix(in_oklab,var(--muted-foreground)_80%,transparent)]">
        <span className="[@media(hover:none)]:hidden">{isFront ? "Clique ou appuie sur Espace pour révéler" : "Clique ou appuie sur Espace pour revoir la question"}</span>
        <span className="hidden [@media(hover:none)]:inline">{isFront ? "Touche la carte pour révéler" : "Touche la carte pour revoir la question"}</span>
      </span>
    </span>
  );
}

/** Real 3D flip: framer-motion animates rotateY on a preserve-3d container; each face hides its own backface. Both faces share one grid cell so the card is always as tall as its longer side. */
function FlipCard({ card, flipped, onToggle, reduceMotion }: { card: LabCard; flipped: boolean; onToggle: () => void; reduceMotion: boolean }) {
  return (
    <motion.div whileHover={reduceMotion ? undefined : { y: -2 }} transition={{ duration: 0.2 }} className="[perspective:1400px]">
      <motion.button
        type="button"
        onClick={onToggle}
        initial={false}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 26, mass: 0.9 }}
        style={{ transformStyle: "preserve-3d" }}
        className="relative grid w-full cursor-pointer rounded-3xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <CardFace side="front" hidden={flipped} text={card.question} />
        <CardFace side="back" hidden={!flipped} text={card.answer} />
        <span className="sr-only">{flipped ? "Activer pour revoir la question." : "Activer pour révéler la réponse."}</span>
      </motion.button>
      <p className="sr-only" aria-live="polite">
        {flipped ? `Réponse : ${card.answer}` : ""}
      </p>
    </motion.div>
  );
}

function RatingBar({
  currentBox,
  lapsedThisSession,
  onRate,
  reduceMotion,
}: {
  currentBox: number;
  /** Retry of a card forgotten earlier in this session — every rating but "À revoir" keeps it in box 1 (see scheduleRating), so the previews say so. */
  lapsedThisSession: boolean;
  onRate: (rating: Rating) => void;
  reduceMotion: boolean;
}) {
  // Two pairs that sit side by side (1 row of 4) when the panel is wide and
  // stack (2×2) when narrow — never an awkward 3+1. Done with the
  // "flex-basis albatross" trick so it follows the PANEL width, not the
  // viewport (the Lab often lives in a ~380px side panel on a wide screen).
  const pairs = [RATINGS.slice(0, 2), RATINGS.slice(2)];
  return (
    <motion.div
      role="group"
      aria-label="Évalue ta réponse"
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="flex flex-wrap gap-2"
    >
      {pairs.map((pair, pairIndex) => (
        <div key={pairIndex} className="grid min-w-0 grid-cols-2 gap-2" style={{ flex: "1 1 calc((34rem - 100%) * 999)" }}>
          {pair.map((option) => {
            const days = intervalDaysForBox(lapsedThisSession ? 1 : nextBoxFor(currentBox, option.rating));
            return (
              <motion.button
                key={option.rating}
                type="button"
                onClick={() => onRate(option.rating)}
                whileTap={{ scale: 0.95 }}
                aria-keyshortcuts={option.shortcut}
                aria-label={`${option.label} — prochaine révision dans ${plural(days, "jour")}`}
                className={cn(
                  "flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 rounded-2xl border px-2 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  option.className
                )}
              >
                <span className="flex items-center gap-1.5">
                  {option.label}
                  <Kbd>{option.shortcut}</Kbd>
                </span>
                <span className="text-[11px] font-medium opacity-75">{formatInterval(days)}</span>
              </motion.button>
            );
          })}
        </div>
      ))}
    </motion.div>
  );
}

function AskInChatButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-primary-300 dark:hover:bg-primary-500/10"
    >
      <MessageSquareText className="h-3.5 w-3.5" />
      Expliquer dans le chat
    </motion.button>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-[color-mix(in_oklab,var(--card)_70%,transparent)] px-3 py-2.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FlashcardsLab({ courseId, courseTitle, hasExplication, onAskInChat }: FlashcardsLabProps) {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const reduceMotion = useReducedMotion() ?? false;
  const layoutGroupId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const [load, setLoad] = useState<LoadState>(() => {
    if (!hasExplication) return { status: "requirement" };
    const memo = deckCache.get(courseId);
    return memo ? { status: "ready", cards: memo } : { status: "loading" };
  });
  const [reloadNonce, setReloadNonce] = useState(0);
  const [showSlowHint, setShowSlowHint] = useState(false);

  const userId = user?.id ?? null;
  const storageKey = userId ? `${STORAGE_PREFIX}${userId}:${courseId}` : null;
  const [progress, setProgress] = useState<ProgressMap>({});
  // undefined = not hydrated yet; null = hydrated in memory-only mode.
  const [hydratedKey, setHydratedKey] = useState<string | null | undefined>(undefined);
  const hydratedKeyRef = useRef<string | null | undefined>(undefined);
  const [storageFailed, setStorageFailed] = useState(false);

  const [view, setView] = useState<View>("review");
  const [flipped, setFlipped] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [includeAll, setIncludeAll] = useState(false);
  const [shuffled, setShuffled] = useState(false);
  const [browseIndex, setBrowseIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const cards = load.status === "ready" ? load.cards : EMPTY_CARDS;

  // Latest-value refs — read by stable callbacks (rating, the window key
  // listener) so a fast double input can never act on a stale snapshot.
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const flippedRef = useRef(flipped);
  flippedRef.current = flipped;
  const optionsRef = useRef<SessionOptions>({ includeAll, shuffled });
  optionsRef.current = { includeAll, shuffled };

  // --- Deck loading ---------------------------------------------------------

  useEffect(() => {
    if (!hasExplication) {
      setLoad({ status: "requirement" });
      return;
    }
    const memo = deckCache.get(courseId);
    if (memo) {
      setLoad({ status: "ready", cards: memo });
      return;
    }
    setLoad({ status: "loading" });
    // The in-flight key includes the user, so wait for auth to settle:
    // starting under "anon" and again under the real id once it resolves
    // would be exactly the double request the registry exists to prevent.
    // (The review UI waits for auth anyway, to hydrate the progress.)
    if (authLoading) return;
    // Adopts the request a previous mount left running, if any. The request
    // itself is never aborted: unmounting (or switching course) only stops
    // THIS instance from applying its result.
    let active = true;
    void loadDeck(userId, courseId).then((next) => {
      if (active) setLoad(next);
    });
    return () => {
      active = false;
    };
  }, [courseId, hasExplication, reloadNonce, authLoading, userId]);

  useEffect(() => {
    if (load.status !== "loading") {
      setShowSlowHint(false);
      return;
    }
    const timer = window.setTimeout(() => setShowSlowHint(true), SLOW_GENERATION_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [load.status]);

  // --- Progress hydration / persistence --------------------------------------

  useEffect(() => {
    if (authLoading) return;
    const stored = storageKey ? readStoredProgress(storageKey) : {};
    const previousKey = hydratedKeyRef.current;
    // Memory-only progress (no user yet) is carried into the user's slot;
    // switching between two DIFFERENT users never mixes their progress.
    const carryOver = previousKey === undefined || previousKey === null;
    hydratedKeyRef.current = storageKey;
    setProgress((current) => (carryOver ? mergeProgress(stored, current) : stored));
    setHydratedKey(storageKey);
  }, [authLoading, storageKey]);

  useEffect(() => {
    if (!storageKey || hydratedKey !== storageKey) return;
    setStorageFailed(!writeStoredProgress(storageKey, progress, cards.length > 0 ? cards : null));
  }, [progress, storageKey, hydratedKey, cards]);

  // Cross-tab sync: the `storage` event only fires in OTHER tabs, and
  // identical writes are skipped, so this can't loop.
  useEffect(() => {
    if (!storageKey) return;
    const key = storageKey;
    function handleStorage(event: StorageEvent) {
      if (event.key !== key || event.newValue === null) return;
      const next = parseStoredProgress(event.newValue);
      if (next) setProgress(next);
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [storageKey]);

  // Due-ness changes with the clock (a card becomes due at midnight).
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // --- Session lifecycle ------------------------------------------------------

  // A fresh session once both the deck and the progress are known, and again
  // whenever either source changes identity (new deck, different user).
  useEffect(() => {
    if (cards.length === 0 || hydratedKey === undefined) {
      setSession(null);
      return;
    }
    setSession(createSession(cards, progressRef.current, optionsRef.current, Date.now()));
    setFlipped(false);
  }, [cards, hydratedKey]);

  useEffect(() => {
    setBrowseIndex(0);
    setExpandedId(null);
  }, [cards]);

  const restartSession = useCallback(
    (options: SessionOptions) => {
      const timestamp = Date.now();
      setSession(createSession(cards, progressRef.current, options, timestamp));
      setFlipped(false);
      setNow(timestamp);
    },
    [cards]
  );

  const toggleFlip = useCallback(() => setFlipped((value) => !value), []);

  const rate = useCallback((rating: Rating) => {
    const current = sessionRef.current;
    if (!current || !flippedRef.current) return;
    const cardId = current.queue[current.index];
    if (!cardId) return;
    flippedRef.current = false; // blocks a second rating before the next render

    const timestamp = Date.now();
    const lapsed = lapsedInSession(current, cardId);
    setProgress((previous) => ({ ...previous, [cardId]: scheduleRating(previous[cardId], rating, timestamp, lapsed) }));

    // "À revoir" re-queues the card once at the end of this session (unless
    // it's already pending there) — real active recall, not just a reschedule.
    const queue =
      rating === "again" && current.queue.indexOf(cardId, current.index + 1) === -1 ? [...current.queue, cardId] : current.queue;
    const next: Session = { ...current, queue, index: current.index + 1, log: [...current.log, { cardId, rating }] };
    sessionRef.current = next;
    setSession(next);
    setFlipped(false);
    setNow(timestamp);
  }, []);

  const endSessionEarly = useCallback(() => {
    setSession((current) => (current ? { ...current, queue: current.queue.slice(0, current.index) } : current));
    setFlipped(false);
  }, []);

  const goBrowse = useCallback(
    (delta: number) => {
      setBrowseIndex((index) => Math.min(Math.max(index + delta, 0), Math.max(cards.length - 1, 0)));
      setFlipped(false);
    },
    [cards.length]
  );

  function changeView(next: View) {
    setView(next);
    setFlipped(false);
  }

  function openInBrowse(cardId: string) {
    const index = cards.findIndex((card) => card.id === cardId);
    if (index >= 0) setBrowseIndex(index);
    changeView("browse");
  }

  function askInChat(card: LabCard) {
    onAskInChat?.(buildChatPrompt(card, courseTitle));
  }

  // --- Export -------------------------------------------------------------------

  const pendingDownloadsRef = useRef<{ url: string; timer: number }[]>([]);
  useEffect(() => {
    const pending = pendingDownloadsRef.current;
    return () => {
      for (const entry of pending) {
        window.clearTimeout(entry.timer);
        URL.revokeObjectURL(entry.url);
      }
      pending.length = 0;
    };
  }, []);

  function exportForAnki() {
    if (cards.length === 0) return;
    const blob = new Blob([buildAnkiTsv(cards, courseTitle)], { type: "text/tab-separated-values;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `flashcards-${fileSlug(courseTitle)}-anki.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoked later, not synchronously: some browsers start reading the
    // blob asynchronously after click() and would get a dead URL.
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      // Mutated in place: the unmount cleanup above holds this same array.
      const pending = pendingDownloadsRef.current;
      const index = pending.findIndex((entry) => entry.url === url);
      if (index >= 0) pending.splice(index, 1);
    }, 30_000);
    pendingDownloadsRef.current.push({ url, timer });
    toast({
      variant: "success",
      title: "Fichier Anki téléchargé",
      description: "Dans Anki : Fichier › Importer, puis choisis ce fichier — le paquet et les champs sont détectés automatiquement.",
    });
  }

  async function copyMarkdown() {
    if (cards.length === 0) return;
    const ok = await copyToClipboard(buildMarkdown(cards, courseTitle));
    toast(
      ok
        ? { variant: "success", title: "Flashcards copiées en Markdown" }
        : { variant: "error", title: "Copie impossible", description: "Ton navigateur a bloqué l'accès au presse-papiers." }
    );
  }

  // --- Derived ------------------------------------------------------------------

  const stats = useMemo(() => computeDeckStats(cards, progress, now), [cards, progress, now]);
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const searchIndex = useMemo(() => cards.map((card) => ({ card, haystack: foldText(`${card.question}\n${card.answer}`) })), [cards]);
  const foldedQuery = foldText(query);
  const filteredCards = useMemo(
    () => (foldedQuery ? searchIndex.filter((entry) => entry.haystack.includes(foldedQuery)).map((entry) => entry.card) : cards),
    [searchIndex, foldedQuery, cards]
  );

  const reviewCardId = session && session.index < session.queue.length ? session.queue[session.index] : null;
  const reviewCard = reviewCardId ? cardsById.get(reviewCardId) ?? null : null;
  const sessionFinished = !!session && session.queue.length > 0 && session.index >= session.queue.length;
  const safeBrowseIndex = Math.min(browseIndex, Math.max(cards.length - 1, 0));
  const browseCard = cards[safeBrowseIndex] ?? null;

  // --- Keyboard -----------------------------------------------------------------

  // The shortcuts listen on window, so without this they'd act on keys
  // pressed anywhere on the page whenever focus sits on <body> or another
  // scroll container (Space scrolling the chat would flip the card, a digit
  // would rate it). They only act once the student has last clicked or
  // focused INSIDE the deck; a click or focus anywhere else disengages them.
  const isEngagedRef = useRef(false);
  useEffect(() => {
    const track = (event: Event) => {
      const root = rootRef.current;
      isEngagedRef.current = !!root && event.target instanceof Node && root.contains(event.target);
    };
    document.addEventListener("pointerdown", track, true);
    document.addEventListener("focusin", track, true);
    return () => {
      document.removeEventListener("pointerdown", track, true);
      document.removeEventListener("focusin", track, true);
    };
  }, []);

  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (event: KeyboardEvent) => {
    if (!isEngagedRef.current) return;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const root = rootRef.current;
    if (!root || root.getClientRects().length === 0) return; // unmounted-from-layout / hidden tab
    const target = event.target instanceof Element ? event.target : null;
    if (isEditableTarget(target) || isInForeignOverlay(target, root)) return;
    if (load.status !== "ready" || cards.length === 0 || view === "list") return;

    const activeCard = view === "review" ? reviewCard : browseCard;

    if (event.key === " " || event.key === "Enter") {
      if (!activeCard) return;
      // A keyboard-focused button (or any control outside the deck) handles its own activation.
      if (target && isActivatableTarget(target) && (!root.contains(target) || isKeyboardFocused(target))) return;
      event.preventDefault();
      if (!event.repeat) toggleFlip();
      return;
    }

    if (view === "review") {
      const rating = ratingForKeyEvent(event);
      if (rating && reviewCard && flippedRef.current && !event.repeat) {
        event.preventDefault();
        rate(rating);
      }
      return;
    }

    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !usesArrowKeys(target)) {
      event.preventDefault();
      goBrowse(event.key === "ArrowLeft" ? -1 : 1);
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // --- Render helpers -----------------------------------------------------------

  function renderReview(): ReactNode {
    if (!session) {
      return (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement de ta progression…
        </div>
      );
    }

    const optionsRow = (
      <div className="flex flex-wrap items-center gap-2">
        <ToggleChip
          pressed={includeAll}
          onClick={() => {
            const next = !includeAll;
            setIncludeAll(next);
            restartSession({ includeAll: next, shuffled });
          }}
          icon={Repeat}
          label="Réviser tout"
          tooltip="Inclut aussi les cartes pas encore dues. Redémarre la session (ta progression est conservée)."
        />
        <ToggleChip
          pressed={shuffled}
          onClick={() => {
            const next = !shuffled;
            setShuffled(next);
            restartSession({ includeAll, shuffled: next });
          }}
          icon={Shuffle}
          label="Mélanger"
          tooltip="Ordre aléatoire — les cartes dues restent en premier. Redémarre la session."
        />
      </div>
    );

    if (session.queue.length === 0) {
      return (
        <div className="flex flex-col gap-3">
          {optionsRow}
          <StatePanel
            icon={CalendarClock}
            tone="primary"
            title="Tout est à jour !"
            message={
              stats.nextDueAt !== null
                ? `Aucune carte à réviser pour l'instant. Prochaine révision ${formatDueRelative(stats.nextDueAt, now)}.`
                : "Aucune carte à réviser pour l'instant."
            }
          >
            <div className="flex flex-wrap justify-center gap-2">
              <PillButton
                variant="primary"
                onClick={() => {
                  setIncludeAll(true);
                  restartSession({ includeAll: true, shuffled });
                }}
              >
                <Repeat className="h-4 w-4" />
                Réviser tout quand même
              </PillButton>
              <PillButton onClick={() => changeView("browse")}>
                <Layers className="h-4 w-4" />
                Parcourir
              </PillButton>
            </div>
          </StatePanel>
        </div>
      );
    }

    if (sessionFinished) return renderSummary(session);
    if (!reviewCard) return null;

    const state = progress[reviewCard.id];
    const isRetry = session.log.some((entry) => entry.cardId === reviewCard.id);
    const remaining = session.queue.length - session.index;

    return (
      <section className="flex flex-col gap-3" aria-label="Session de révision">
        {optionsRow}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
            <span className="tabular-nums">
              Carte {session.index + 1} / {session.queue.length}
            </span>
            <span>{remaining > 1 ? `${remaining - 1} restante${remaining - 1 > 1 ? "s" : ""}` : "Dernière carte"}</span>
          </div>
          <ProgressBar value={session.index / session.queue.length} label="Progression de la session" />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <BoxChip state={state} />
          {state && (
            <span className="text-[11px] text-muted-foreground">
              {plural(state.reviews, "révision")}
              {state.lapses > 0 ? ` · ${plural(state.lapses, "oubli")}` : ""}
            </span>
          )}
          {isRetry && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
              <RotateCcw className="h-3 w-3" />
              Rattrapage
            </span>
          )}
        </div>

        <motion.div
          key={`${session.index}:${reviewCard.id}`}
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          <FlipCard card={reviewCard} flipped={flipped} onToggle={toggleFlip} reduceMotion={reduceMotion} />
        </motion.div>

        {flipped ? (
          <RatingBar
            currentBox={state?.box ?? 1}
            lapsedThisSession={lapsedInSession(session, reviewCard.id)}
            onRate={rate}
            reduceMotion={reduceMotion}
          />
        ) : (
          <PillButton variant="primary" onClick={toggleFlip} className="min-h-[3.5rem] w-full rounded-2xl" ariaKeyShortcuts="Space">
            <Eye className="h-4 w-4" />
            Voir la réponse
            <Kbd className="border-white/40 bg-white/15 text-white">Espace</Kbd>
          </PillButton>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {onAskInChat ? <AskInChatButton onClick={() => askInChat(reviewCard)} /> : <span />}
          {session.log.length > 0 && (
            <button
              type="button"
              onClick={endSessionEarly}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" />
              Terminer la session
            </button>
          )}
        </div>

        <p className="text-center text-[11px] text-muted-foreground [@media(hover:none)]:hidden">
          Espace : retourner · 1 à 4 : évaluer la réponse
        </p>
      </section>
    );
  }

  function renderSummary(finished: Session): ReactNode {
    const counts: Record<Rating, number> = { again: 0, hard: 0, good: 0, easy: 0 };
    for (const entry of finished.log) counts[entry.rating]++;
    const totalRatings = finished.log.length;
    const reviewed = new Set(finished.log.map((entry) => entry.cardId)).size;
    const successPct = totalRatings > 0 ? Math.round(((counts.good + counts.easy) / totalRatings) * 100) : 0;
    const masteryBefore = Math.round(finished.masteryAtStart * 100);
    const masteryAfter = Math.round(stats.mastery * 100);
    const nextDue =
      stats.due > 0 ? "maintenant" : stats.nextDueAt !== null ? formatDueRelative(stats.nextDueAt, now) : "—";

    return (
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25 }}
        className="glass-card flex flex-col gap-4 rounded-3xl p-5 shadow-glass dark:shadow-glass-dark"
        aria-label="Bilan de la session"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
            <Trophy className="h-6 w-6" />
          </div>
          <p className="text-base font-bold text-foreground">Session terminée</p>
          <p className="text-xs text-muted-foreground">
            Maîtrise : {masteryBefore} % → <span className="font-semibold text-foreground">{masteryAfter} %</span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Cartes révisées" value={String(reviewed)} />
          <StatTile label="Bien / Facile" value={`${successPct} %`} />
          <StatTile label="Oublis" value={String(counts.again)} />
          <StatTile label="Prochaine révision" value={nextDue} />
        </div>

        {totalRatings > 0 && (
          <div>
            <div className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted" role="img" aria-label={RATINGS.map((r) => `${r.label} : ${counts[r.rating]}`).join(", ")}>
              {RATINGS.filter((r) => counts[r.rating] > 0).map((r) => (
                <span
                  key={r.rating}
                  style={{ width: `${(counts[r.rating] / totalRatings) * 100}%` }}
                  className={cn(
                    "h-full",
                    r.rating === "again" && "bg-rose-500",
                    r.rating === "hard" && "bg-amber-400",
                    r.rating === "good" && "bg-primary-500",
                    r.rating === "easy" && "bg-sky-500"
                  )}
                />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1" aria-hidden>
              {RATINGS.map((r) => (
                <li key={r.rating} className="text-[11px] text-muted-foreground">
                  {r.label} <span className="font-semibold tabular-nums text-foreground">{counts[r.rating]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-2">
          <PillButton variant="primary" onClick={() => restartSession({ includeAll, shuffled })}>
            <RotateCcw className="h-4 w-4" />
            Nouvelle session
          </PillButton>
          <PillButton onClick={() => changeView("list")}>
            <List className="h-4 w-4" />
            Voir toutes les cartes
          </PillButton>
        </div>
      </motion.section>
    );
  }

  function renderBrowse(card: LabCard): ReactNode {
    return (
      <section className="flex flex-col gap-3" aria-label="Parcourir les cartes">
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
          <span className="tabular-nums">
            Carte {safeBrowseIndex + 1} / {cards.length}
          </span>
          <BoxChip state={progress[card.id]} />
        </div>

        <motion.div
          key={card.id}
          initial={reduceMotion ? false : { opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <FlipCard card={card} flipped={flipped} onToggle={toggleFlip} reduceMotion={reduceMotion} />
        </motion.div>

        <div className="flex items-center justify-between gap-2">
          <IconButton label="Carte précédente (←)" onClick={() => goBrowse(-1)} disabled={safeBrowseIndex === 0} className="h-10 w-10 border border-border bg-card">
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <PillButton onClick={toggleFlip} ariaKeyShortcuts="Space">
            <RotateCcw className="h-4 w-4" />
            Retourner
            <Kbd>Espace</Kbd>
          </PillButton>
          <IconButton
            label="Carte suivante (→)"
            onClick={() => goBrowse(1)}
            disabled={safeBrowseIndex >= cards.length - 1}
            className="h-10 w-10 border border-border bg-card"
          >
            <ChevronRight className="h-4 w-4" />
          </IconButton>
        </div>

        {onAskInChat && (
          <div className="flex justify-center">
            <AskInChatButton onClick={() => askInChat(card)} />
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground [@media(hover:none)]:hidden">
          Espace : retourner · ← / → : carte précédente / suivante
        </p>
      </section>
    );
  }

  function renderList(): ReactNode {
    return (
      <section className="flex flex-col gap-3" aria-label="Liste des cartes">
        <label className="relative block">
          <span className="sr-only">Rechercher dans les flashcards</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher une notion, un mot-clé…"
            className="h-10 w-full rounded-xl border border-border bg-[color-mix(in_oklab,var(--background)_70%,transparent)] pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {foldedQuery ? `${filteredCards.length} / ${plural(cards.length, "carte")}` : plural(cards.length, "carte")}
        </p>

        {filteredCards.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
            Aucune carte ne correspond à « {query.trim()} ».
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filteredCards.map((card) => {
              const state = progress[card.id];
              const expanded = expandedId === card.id;
              const dueLabel = !state
                ? "Jamais révisée"
                : state.dueAt <= now
                  ? "À réviser maintenant"
                  : `Prochaine révision ${formatDueRelative(state.dueAt, now)}`;
              return (
                <li key={card.id} className="rounded-2xl border border-border bg-[color-mix(in_oklab,var(--card)_70%,transparent)] p-3 shadow-soft">
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : card.id)}
                      className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block text-sm font-semibold leading-snug text-foreground">{card.question}</span>
                      <span className={cn("mt-1 block whitespace-pre-line text-xs leading-relaxed text-muted-foreground", !expanded && "line-clamp-2")}>
                        {card.answer}
                      </span>
                    </button>
                    <BoxChip state={state} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "text-[11px]",
                        state && state.dueAt <= now ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground"
                      )}
                    >
                      {dueLabel}
                    </span>
                    <div className="flex items-center gap-1">
                      <IconButton label="Ouvrir en mode Parcourir" onClick={() => openInBrowse(card.id)}>
                        <Eye className="h-4 w-4" />
                      </IconButton>
                      {onAskInChat && (
                        <IconButton label="Expliquer dans le chat" onClick={() => askInChat(card)}>
                          <MessageSquareText className="h-4 w-4" />
                        </IconButton>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  // --- Render: non-ready states ---------------------------------------------------

  let body: ReactNode;

  if (load.status === "requirement") {
    body = (
      <StatePanel icon={BookOpen} tone="primary" title="Explication requise" message={EXPLICATION_REQUIRED_MESSAGE}>
        <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
          Ouvre « Explication » dans le Studio et lance sa génération, puis reviens ici : tes flashcards seront construites à partir d&apos;elle.
        </p>
      </StatePanel>
    );
  } else if (load.status === "loading") {
    body = (
      <div className="glass-card flex flex-col gap-4 rounded-3xl p-5 shadow-glass dark:shadow-glass-dark" aria-busy="true">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary-600 dark:text-primary-400" />
          Préparation de tes flashcards…
        </div>
        <div className="h-2.5 w-full animate-pulse rounded-full bg-muted" />
        <div className="min-h-[15rem] animate-pulse rounded-3xl border border-border bg-[color-mix(in_oklab,var(--muted)_50%,transparent)]" />
        {showSlowHint && (
          <motion.p
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-xs leading-relaxed text-muted-foreground"
          >
            Première génération pour ce cours : cela peut prendre jusqu&apos;à une minute. Ensuite, elles s&apos;ouvriront instantanément.
          </motion.p>
        )}
      </div>
    );
  } else if (load.status === "error") {
    const retry = (
      <PillButton onClick={() => setReloadNonce((n) => n + 1)}>
        <RefreshCw className="h-4 w-4" />
        Réessayer
      </PillButton>
    );
    if (load.kind === "quota") {
      body = (
        <StatePanel icon={Lock} tone="amber" title="Limite de ta formule atteinte" message={load.message}>
          <Link
            href="/dashboard/billing"
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary-500 hover:shadow-glow dark:bg-primary-500 dark:hover:bg-primary-400"
          >
            Voir les formules
          </Link>
        </StatePanel>
      );
    } else if (load.kind === "auth") {
      body = <StatePanel icon={LogIn} title="Connecte-toi pour réviser tes flashcards" message={load.message} />;
    } else {
      body = (
        <StatePanel icon={AlertTriangle} tone="amber" title={load.kind === "rate-limit" ? "Un peu de patience" : "Flashcards indisponibles"} message={load.message}>
          {retry}
        </StatePanel>
      );
    }
  } else if (cards.length === 0) {
    body = (
      <StatePanel icon={Layers} title="Aucune flashcard exploitable" message="Aucune carte valide n'a pu être extraite de l'Explication de ce cours.">
        <PillButton
          onClick={() => {
            deckCache.delete(courseId);
            setReloadNonce((n) => n + 1);
          }}
        >
          <RefreshCw className="h-4 w-4" />
          Réessayer
        </PillButton>
      </StatePanel>
    );
  } else {
    body = (
      <>
        {/* Header: course, counts, export, mastery */}
        <section className="glass-card rounded-3xl p-4 shadow-glass dark:shadow-glass-dark">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300">
              <Layers className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-primary-700 dark:text-primary-300">Flashcards</p>
              <h3 className="truncate text-sm font-semibold text-foreground" title={courseTitle}>
                {courseTitle}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {plural(stats.total, "carte")} · {stats.due} à réviser · {plural(stats.fresh, "nouvelle")}
              </p>
            </div>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <motion.button
                      type="button"
                      aria-label="Exporter les flashcards"
                      whileTap={{ scale: 0.92 }}
                      className="touch-target relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-soft transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Download className="h-4 w-4" />
                    </motion.button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Exporter</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Exporter {plural(cards.length, "carte")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={exportForAnki}>
                  <FileDown className="h-4 w-4 text-muted-foreground" />
                  Exporter pour Anki
                  <span className="ml-auto text-[10px] font-semibold text-muted-foreground">TSV</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copyMarkdown()}>
                  <ClipboardCopy className="h-4 w-4 text-muted-foreground" />
                  Copier en Markdown
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="mt-4">
            <MasteryMeter stats={stats} />
          </div>
        </section>

        {/* View switcher */}
        <div role="group" aria-label="Mode d'affichage" className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-[color-mix(in_oklab,var(--muted)_50%,transparent)] p-1">
          {(
            [
              { id: "review", label: "Réviser", icon: Brain },
              { id: "browse", label: "Parcourir", icon: Layers },
              { id: "list", label: "Liste", icon: List },
            ] as const
          ).map((option) => {
            const active = view === option.id;
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => changeView(option.id)}
                className={cn(
                  "relative flex min-h-9 items-center justify-center rounded-xl px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active && (
                  <motion.span
                    layoutId={`${layoutGroupId}-view`}
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 34 }}
                    className="absolute inset-0 rounded-xl bg-card shadow-soft"
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>

        {view === "review" && renderReview()}
        {view === "browse" && browseCard && renderBrowse(browseCard)}
        {view === "list" && renderList()}

        <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
          <HardDrive className="h-3 w-3 shrink-0" />
          {!storageKey
            ? "Progression non enregistrée : connecte-toi pour la conserver."
            : storageFailed
              ? "Stockage indisponible : ta progression ne sera pas conservée sur cet appareil."
              : "Progression enregistrée sur cet appareil"}
        </p>
      </>
    );
  }

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {body}
    </div>
  );
}
