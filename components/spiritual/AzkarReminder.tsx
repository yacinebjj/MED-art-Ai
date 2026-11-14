"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Amiri } from "next/font/google";
import { Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AZKAR_ENABLED } from "@/lib/feature-flags";
import {
  AZKAR_PREF_EVENT,
  AZKAR_RETRY_MS,
  AZKAR_SETTINGS_HREF,
  AZKAR_SHOW_EVENT,
  AZKAR_VISIBLE_MS,
  claimAzkarSlot,
  documentIsBusy,
  isAzkarEnabled,
  isQuietRoute,
  nextDueAt,
  readLastShown,
  takeNextAzkar,
  type AzkarEntry,
} from "@/lib/azkar";
import { useLanguage } from "@/providers/LanguageProvider";
import { usePomodoro } from "@/providers/PomodoroProvider";
import { useOptionalOnboarding, useTourBlocker } from "@/lib/onboarding/onboarding-context";

/**
 * Amiri: a Naskh drawn for the Quran's diacritics. Not preloaded — its file
 * is fetched when the first reminder is about to appear (see `fontReady`),
 * so no page pays for it up front.
 */
const amiri = Amiri({ subsets: ["arabic"], weight: "400", display: "swap", preload: false });

/** Waits (1.5 s at most) for Amiri, so the card never changes font while it slides in. */
async function fontReady(text: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  await Promise.race([
    document.fonts.load(`400 22px ${amiri.style.fontFamily}`, text).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
}

/**
 * Hourly spiritual reminder: a Quranic verse or a dhikr in a quiet glass card
 * that slides in under the top bar, stays 14 s on screen (the clock stops
 * while it is pointed at, touched, focused, or the tab is hidden) and leaves
 * on its own — or with a flick, ✕ or Esc. Never a dialog, never focused,
 * never in the way: it waits while the student types, while a dialog or a
 * guided tour is open, during a Pomodoro focus block (the break is a better
 * moment), on a timed exam or a presentation, and while the tab is hidden;
 * and no guided tour starts while it is on screen. One an hour per device,
 * all tabs together (lib/azkar.ts). Off switch: Paramètres › Rappels; kill
 * switch: NEXT_PUBLIC_FEATURE_AZKAR=false.
 */
export function AzkarReminder() {
  return AZKAR_ENABLED ? <AzkarHost /> : null;
}

interface Shown {
  entry: AzkarEntry;
  key: number;
}

function AzkarHost() {
  const pathname = usePathname() ?? "";
  const { language } = useLanguage();
  const { isActive, currentMode } = usePomodoro();
  const touring = Boolean(useOptionalOnboarding()?.active);
  const [shown, setShown] = useState<Shown | null>(null);
  const [mounted, setMounted] = useState(false);

  useTourBlocker(shown !== null);

  // What only React knows, read by the timers below when they fire.
  const busyRef = useRef({ quiet: false, focusing: false, touring: false });
  busyRef.current = { quiet: isQuietRoute(pathname), focusing: isActive && currentMode === "study", touring };

  const aliveRef = useRef(true);
  const show = useCallback(async (entry: AzkarEntry) => {
    await fontReady(entry.segments.join(" "));
    if (aliveRef.current) setShown({ entry, key: Date.now() });
  }, []);
  const dismiss = useCallback(() => setShown(null), []);

  useEffect(() => {
    aliveRef.current = true;
    setMounted(true);
    const visitStartedAt = Date.now();
    let timer: number | undefined;

    const schedule = (delayMs?: number) => {
      window.clearTimeout(timer);
      if (!isAzkarEnabled()) return;
      const wait = delayMs ?? nextDueAt(readLastShown(), visitStartedAt) - Date.now();
      // At most an hour per timeout; a background tab's timer may fire late — `visibilitychange` looks again.
      timer = window.setTimeout(attempt, Math.min(Math.max(wait, 0), 60 * 60 * 1000));
    };

    function attempt() {
      if (!isAzkarEnabled()) return;
      const now = Date.now();
      if (now < nextDueAt(readLastShown(now), visitStartedAt)) return schedule();
      const busy = busyRef.current;
      if (busy.quiet || busy.focusing || busy.touring || documentIsBusy()) return schedule(AZKAR_RETRY_MS);
      // Not claimed: another tab has just shown one (the next is an hour on), or this browser keeps no
      // storage (then never a reminder) — either way, never sooner than a retry: no loop of instant timers.
      if (!claimAzkarSlot(now)) return schedule(Math.max(AZKAR_RETRY_MS, nextDueAt(readLastShown(), visitStartedAt) - Date.now()));
      void show(takeNextAzkar());
      schedule();
    }

    const recheck = () => {
      if (document.visibilityState === "visible") schedule();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("medart:azkar:")) schedule();
    };
    const onPreview = () => void show(takeNextAzkar());

    schedule();
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("storage", onStorage);
    window.addEventListener(AZKAR_PREF_EVENT, recheck);
    window.addEventListener(AZKAR_SHOW_EVENT, onPreview);
    return () => {
      aliveRef.current = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AZKAR_PREF_EVENT, recheck);
      window.removeEventListener(AZKAR_SHOW_EVENT, onPreview);
    };
  }, [show]);

  if (!mounted) return null;
  const fr = language === "fr";
  return createPortal(
    <>
      {/* Read to screen readers politely, once, in its own language — the card itself never takes focus. */}
      <div role="status" aria-live="polite" className="sr-only">
        {shown && (
          <>
            {shown.entry.kind === "ayah" ? (fr ? "Verset de l'heure : " : "Verse of the hour: ") : fr ? "Dhikr de l'heure : " : "Dhikr of the hour: "}
            <span lang="ar">
              {shown.entry.segments.join(" ")} {shown.entry.source}
            </span>
          </>
        )}
      </div>
      <div className="azkar-host">{shown && <AzkarCard key={shown.key} entry={shown.entry} pathname={pathname} fr={fr} onGone={dismiss} />}</div>
    </>,
    document.body
  );
}

/** How far a finger must carry the card (up, or off to the right) to send it away. */
const FLING_PX = 44;

interface Drag {
  id: number;
  x: number;
  y: number;
  axis: "x" | "y" | null;
  dx: number;
  dy: number;
}

function AzkarCard({ entry, pathname, fr, onGone }: { entry: AzkarEntry; pathname: string; fr: boolean; onGone: () => void }) {
  const cardRef = useRef<HTMLElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [fling, setFling] = useState<"x" | "y" | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const paused = hovered || focused || hidden;
  const remainingRef = useRef(AZKAR_VISIBLE_MS);
  const dragRef = useRef<Drag | null>(null);
  const firstPathname = useRef(pathname);

  const leave = useCallback(() => setLeaving(true), []);

  // On screen for AZKAR_VISIBLE_MS, not counting the pauses.
  useEffect(() => {
    if (leaving || paused) return;
    const startedAt = performance.now();
    const id = window.setTimeout(leave, remainingRef.current);
    return () => {
      window.clearTimeout(id);
      remainingRef.current = Math.max(0, remainingRef.current - (performance.now() - startedAt));
    };
  }, [leaving, paused, leave]);

  // A hidden tab doesn't count as time on screen.
  useEffect(() => {
    const sync = () => setHidden(document.visibilityState !== "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // Gone once its exit has played (onAnimationEnd) — or a moment later anyway, should it not play.
  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(onGone, 700);
    return () => window.clearTimeout(id);
  }, [leaving, onGone]);

  // Opening an exam or a presentation: the card steps aside at once.
  useEffect(() => {
    if (pathname !== firstPathname.current && isQuietRoute(pathname)) leave();
  }, [pathname, leave]);

  // A finger carries the card up (or off to the right, where it sits on wide screens), like a notification.
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch" || leaving) return;
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null, dx: 0, dy: 0 };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const card = cardRef.current;
    if (!drag || !card || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      drag.axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
    }
    // Only up or right; the other way, it resists.
    drag.dx = drag.axis === "x" ? (dx > 0 ? dx : dx / 6) : 0;
    drag.dy = drag.axis === "y" ? (dy < 0 ? dy : dy / 6) : 0;
    card.dataset.gesture = "";
    card.style.translate = `${drag.dx}px ${drag.dy}px`;
  };
  const endDrag = (cancelled: boolean) => {
    const drag = dragRef.current;
    const card = cardRef.current;
    dragRef.current = null;
    if (!drag?.axis || !card) return;
    delete card.dataset.gesture;
    if (!cancelled && (drag.dy < -FLING_PX || drag.dx > FLING_PX)) {
      setFling(drag.axis);
      leave();
    } else {
      card.style.translate = ""; // springs back on the card's translate transition
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      leave();
    }
  };

  const isVerse = entry.kind === "ayah";
  const iconButton =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-900/[0.05] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white";
  return (
    <section
      ref={cardRef}
      aria-label={fr ? "Rappel spirituel" : "Spiritual reminder"}
      data-state={leaving ? "closed" : "open"}
      data-fling={fling ?? undefined}
      data-paused={paused || undefined}
      className="azkar-card"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endDrag(false)}
      onPointerCancel={() => endDrag(true)}
      onKeyDown={onKeyDown}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) onGone();
      }}
    >
      <header className="flex items-center gap-2.5">
        <StarEmblem />
        <p className="min-w-0 flex-1 truncate text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
          {isVerse ? (fr ? "Verset de l'heure" : "Verse of the hour") : fr ? "Dhikr de l'heure" : "Dhikr of the hour"}
        </p>
        <Link href={AZKAR_SETTINGS_HREF} onClick={leave} aria-label={fr ? "Réglages des rappels" : "Reminder settings"} className={iconButton}>
          <Settings2 className="h-4 w-4" />
        </Link>
        <button type="button" onClick={leave} aria-label={fr ? "Fermer" : "Close"} className={cn(iconButton, "-mr-1.5")}>
          <X className="h-4 w-4" />
        </button>
      </header>

      <p lang="ar" dir="rtl" className={cn(amiri.className, "azkar-text")}>
        {isVerse ? (
          <>
            <span className="azkar-bracket" aria-hidden>
              ﴿
            </span>
            {entry.segments.map((segment, index) => (
              <Fragment key={index}>
                {index > 0 && <AyahSeparator />}
                {segment}
              </Fragment>
            ))}
            <span className="azkar-bracket" aria-hidden>
              ﴾
            </span>
          </>
        ) : (
          entry.segments.join(" ")
        )}
      </p>
      <p lang="ar" dir="rtl" className={cn(amiri.className, "azkar-source")}>
        {entry.source}
      </p>

      {/* Time left on screen; it stops with the clock. */}
      <span aria-hidden className="azkar-timer" style={{ animationDuration: `${AZKAR_VISIBLE_MS}ms` }} />
    </section>
  );
}

/** Eight-pointed star (two squares, one turned 45°): the card's emblem. */
function StarEmblem() {
  return (
    <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/15 to-sky-500/15 text-emerald-600 dark:text-emerald-300">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <rect x="6" y="6" width="12" height="12" rx="0.6" />
        <rect x="6" y="6" width="12" height="12" rx="0.6" transform="rotate(45 12 12)" />
        <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

/** Between two ayat: a small star, the mushaf's ayah marker in spirit (decorative, not read aloud). */
function AyahSeparator() {
  return (
    <span aria-hidden className="azkar-ayah-sep">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.5l2.2 4.6 4.9-1.5-1.5 4.9 4.6 2.2-4.6 2.2 1.5 4.9-4.9-1.5L12 23.5l-2.2-4.6-4.9 1.5 1.5-4.9L1.9 13.3l4.6-2.2L5 6.2l4.9 1.5z" />
      </svg>
    </span>
  );
}
