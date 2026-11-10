"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Every notification of the app — errors, warnings, successes, information —
 * as one floating pill at the top centre of the screen (product order
 * 2026-11-10: no boxy banner across the header any more). Frosted glass, a
 * border tinted by the kind of message, one crisp icon. It drops in on the
 * soft spring and leaves lifting and fading while its slot folds shut, so the
 * pills below close the gap without a jump (app/globals.css, NOTIFICATIONS).
 * A pill pauses its clock while it's hovered, touched or focused, and a swipe
 * up sends it away. The API is unchanged: toast({ variant, title,
 * description, action }).
 */

export type ToastVariant = "success" | "error" | "warning" | "info";

interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  variant?: ToastVariant;
  title: string;
  description?: string;
  action?: ToastAction;
}

interface ToastItem {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
  action?: ToastAction;
  /** On its way out: the exit plays, then the pill is removed. */
  leaving: boolean;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * How long each kind stays. Errors and warnings linger: a mistake message
 * that vanishes before it's read is more alarming than one the student can
 * take in calmly. An object, so tests can shorten the waits.
 */
export const TOAST_DURATION_MS: Record<ToastVariant, number> = { success: 4500, info: 5500, warning: 8000, error: 9000 };

/** At most this many at once: a newer one sends the oldest away, so the stack never covers the page. */
const MAX_VISIBLE = 3;
/** The exit's length (.toast-pill[data-leaving]): a pill is removed after it even if no animationend arrives. */
const EXIT_MS = 240;
/** A swipe up this far — or a flick of at least FLICK_MIN_PX — sends a pill away (a tap that rolls a few px never does). */
const SWIPE_DISMISS_PX = 28;
const SWIPE_DISMISS_VELOCITY = 0.45;
const FLICK_MIN_PX = 12;

const VARIANTS: Record<ToastVariant, { icon: LucideIcon; border: string; tint: string }> = {
  success: { icon: CircleCheck, border: "border-emerald-500/20", tint: "text-emerald-500" },
  error: { icon: CircleAlert, border: "border-red-500/20", tint: "text-red-500" },
  warning: { icon: TriangleAlert, border: "border-amber-500/25", tint: "text-amber-500" },
  info: { icon: Info, border: "border-black/[0.08] dark:border-white/10", tint: "text-sky-500" },
};

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.map((item) => (item.id === id && !item.leaving ? { ...item, leaving: true } : item)));
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>(({ variant = "info", title, description, action }) => {
    const id = nextId++;
    setToasts((current) => {
      let shown = 0;
      // Newest on top. The same message again replaces its copy; past the few visible, the oldest leave.
      return [{ id, variant, title, description, action, leaving: false }, ...current].map((item, index) => {
        if (item.leaving) return item;
        const repeated = index > 0 && item.variant === variant && item.title === title && item.description === description;
        shown += repeated ? 0 : 1;
        return repeated || shown > MAX_VISIBLE ? { ...item, leaving: true } : item;
      });
    });
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live="polite" (never "assertive"), errors included: a screen reader
          interrupted mid-sentence is its own small jolt. inset-x-0 + px-3, never a
          `fixed` w-full + right-N, which pushed the left edge off a phone screen. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[9999] flex flex-col items-center px-3"
      >
        {toasts.map((item) => (
          <ToastPill key={item.id} item={item} onDismiss={dismiss} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastPill({ item, onDismiss, onRemove }: { item: ToastItem; onDismiss: (id: number) => void; onRemove: (id: number) => void }) {
  const { icon: Icon, border, tint } = VARIANTS[item.variant];
  const multiline = Boolean(item.description);
  const pillRef = useRef<HTMLDivElement>(null);
  const clock = useRef({ timer: 0, startedAt: 0, remaining: TOAST_DURATION_MS[item.variant] });
  const swipe = useRef<{ pointerId: number; startY: number; lastY: number; lastTime: number; velocity: number } | null>(null);

  const pause = useCallback(() => {
    const state = clock.current;
    if (!state.timer) return;
    window.clearTimeout(state.timer);
    state.timer = 0;
    state.remaining = Math.max(0, state.remaining - (Date.now() - state.startedAt));
  }, []);

  const resume = useCallback(() => {
    const state = clock.current;
    if (state.timer || item.leaving) return;
    state.startedAt = Date.now();
    state.timer = window.setTimeout(() => {
      state.timer = 0;
      onDismiss(item.id);
    }, state.remaining);
  }, [item.id, item.leaving, onDismiss]);

  useEffect(() => {
    resume();
    return pause;
  }, [resume, pause]);

  // Removed once its exit has played (or at the latest just after: no animationend under some settings).
  useEffect(() => {
    if (!item.leaving) return;
    const timer = window.setTimeout(() => onRemove(item.id), EXIT_MS + 80);
    return () => window.clearTimeout(timer);
  }, [item.leaving, item.id, onRemove]);

  function handleBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume();
  }

  // Swipe up to dismiss (a finger or a pen; a mouse keeps its text selection).
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" || item.leaving || swipe.current) return;
    if ((event.target as HTMLElement).closest("button")) return;
    swipe.current = { pointerId: event.pointerId, startY: event.clientY, lastY: event.clientY, lastTime: performance.now(), velocity: 0 };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Already released (a very quick tap): the swipe still works uncaptured.
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = swipe.current;
    const pill = pillRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !pill) return;
    const now = performance.now();
    gesture.velocity = (event.clientY - gesture.lastY) / Math.max(1, now - gesture.lastTime);
    gesture.lastY = event.clientY;
    gesture.lastTime = now;
    const offset = event.clientY - gesture.startY;
    pill.setAttribute("data-gesture", "");
    // Up follows the finger; down resists (there's nowhere to go).
    pill.style.translate = `0 ${offset < 0 ? offset : offset * 0.2}px`;
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = swipe.current;
    const pill = pillRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    swipe.current = null;
    if (!pill) return;
    pill.removeAttribute("data-gesture");
    const offset = gesture.lastY - gesture.startY;
    // A finger that paused before lifting isn't a flick.
    const flick = performance.now() - gesture.lastTime > 100 ? 0 : gesture.velocity;
    if (offset < -SWIPE_DISMISS_PX || (offset < -FLICK_MIN_PX && flick < -SWIPE_DISMISS_VELOCITY)) {
      onDismiss(item.id);
      return;
    }
    pill.style.translate = "";
  }

  return (
    <div className="toast-slot grid w-full" data-leaving={item.leaving ? "" : undefined}>
      <div className="flex min-h-0 justify-center pb-2">
        <div
          ref={pillRef}
          data-variant={item.variant}
          data-leaving={item.leaving ? "" : undefined}
          onPointerEnter={pause}
          onPointerLeave={resume}
          onFocus={pause}
          onBlur={handleBlur}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onAnimationEnd={(event) => {
            if (item.leaving && event.target === event.currentTarget && event.animationName === "toast-lift") onRemove(item.id);
          }}
          className={cn(
            "toast-pill pointer-events-auto flex w-max min-w-0 max-w-[min(28rem,100%)] touch-none gap-2.5 border bg-white/95 shadow-xl backdrop-blur-lg dark:bg-neutral-900/95",
            multiline ? "items-start rounded-[1.375rem] py-2.5 pl-3.5 pr-2" : "items-center rounded-full py-2 pl-3.5 pr-2",
            border
          )}
        >
          <Icon aria-hidden="true" strokeWidth={2.25} className={cn("h-[18px] w-[18px] shrink-0", multiline && "mt-px", tint)} />
          <div className="min-w-0 flex-1">
            <p className="text-[0.9375rem] font-semibold leading-5 text-slate-900 dark:text-white">{item.title}</p>
            {item.description && <p className="mt-0.5 text-[0.875rem] leading-[1.35] text-slate-600 dark:text-neutral-300">{item.description}</p>}
          </div>
          {item.action && (
            <button
              type="button"
              onClick={() => {
                item.action?.onClick();
                onDismiss(item.id);
              }}
              className="touch-target relative shrink-0 self-center rounded-full bg-black/[0.05] px-3 py-1 text-[0.8125rem] font-semibold text-slate-900 transition-colors duration-150 hover:bg-black/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 dark:bg-white/10 dark:text-white dark:hover:bg-white/[0.16]"
            >
              {item.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => onDismiss(item.id)}
            aria-label="Fermer la notification"
            className={cn(
              "touch-target relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors duration-150 hover:bg-black/[0.06] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 dark:text-neutral-500 dark:hover:bg-white/10 dark:hover:text-white",
              multiline && "-mt-0.5"
            )}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast doit être utilisé à l'intérieur de <ToastProvider>.");
  }
  return ctx;
}
