"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import { BrainCircuit, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";

/**
 * The Copilot's look, shared by the MedArt Copilot
 * (app/dashboard/(shell)/assistant/page.tsx) and the module workspace's
 * Co-pilot (components/course/workspace/ChatDocumentPanel.tsx), so the two
 * read as one assistant: same welcome, same living light, same orb, same
 * avatar, same "thinking" line, same composer hub, suggestions and bubbles.
 */

/**
 * The floating composer hub: frosted, 36 px corners, deep in dark and clean
 * white in light, with a faint blue glow rising off its top edge (the
 * ambience's aurora seems to come from the bar itself); brighter while focused.
 */
export const COPILOT_HUB_CLASSES =
  "relative flex w-full flex-col rounded-[36px] border border-black/[0.06] bg-white/90 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_44px_-18px_rgba(15,23,42,0.24),0_-10px_40px_-26px_rgba(14,165,233,0.45)] backdrop-blur-2xl transition-[box-shadow,border-color] duration-300 focus-within:border-sky-500/30 focus-within:shadow-[0_0_0_1px_rgba(14,165,233,0.2),0_16px_48px_-16px_rgba(14,165,233,0.38),0_-12px_44px_-24px_rgba(14,165,233,0.5)] dark:border-white/[0.09] dark:bg-[#0a0c10]/80 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_64px_-20px_rgba(0,0,0,0.9),0_-12px_48px_-26px_rgba(56,189,248,0.5)] dark:focus-within:border-sky-400/25 dark:focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_0_1px_rgba(56,189,248,0.16),0_24px_64px_-20px_rgba(14,165,233,0.32),0_-14px_52px_-24px_rgba(56,189,248,0.6)]";

/**
 * A welcome-screen suggestion: a slim floating pill (no box, no hard border —
 * a hairline ring and a soft blue-tinted lift), on every screen. It never
 * moves on hover (a hovered box that shifts flickers at its edge); a press
 * sinks it a touch.
 */
export const COPILOT_SUGGESTION_CLASSES =
  "inline-flex h-10 min-w-0 max-w-full shrink-0 items-center gap-2 rounded-full bg-white/80 px-4 text-[13px] font-medium leading-none text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_10px_24px_-16px_rgba(14,165,233,0.5)] ring-1 ring-inset ring-black/[0.05] transition-[background-color,color,box-shadow,transform] duration-200 hover:bg-white hover:text-slate-950 hover:shadow-[0_1px_2px_rgba(15,23,42,0.05),0_14px_30px_-16px_rgba(14,165,233,0.6)] hover:ring-sky-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 dark:bg-white/[0.06] dark:text-white/85 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:ring-white/[0.08] dark:hover:bg-white/[0.1] dark:hover:text-white dark:hover:ring-sky-400/30 sm:h-11 sm:px-[18px] sm:text-[13.5px]";

/**
 * The student's own message: a sky bubble on the right (white glass in dark).
 * 17 px on every screen (product order 2026-11-10: was 15 px on phones, 16 px
 * from sm) — a step under the replies' 18 px from sm, so the answer still
 * leads. rem, so app/globals.css's phone type scale leaves it alone.
 */
export const COPILOT_USER_BUBBLE_CLASSES =
  "max-w-full whitespace-pre-wrap break-words rounded-3xl rounded-br-lg border border-sky-100 bg-sky-50 px-4 py-2.5 text-[1.0625rem] leading-[1.5] text-slate-800 dark:border-white/[0.06] dark:bg-white/[0.07] dark:text-white/90";

/**
 * A reply's action button: clear at a glance, 40 px discs with 20 px glyphs on
 * every screen, solid white in dark mode (near-black in light), a soft disc on
 * hover. Their row's negative margin (-ml-2.5) lines the first glyph up with
 * the reply's text.
 */
export const COPILOT_ACTION_BUTTON_CLASSES =
  "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-800 outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-black/[0.06] hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-sky-500/40 active:scale-[0.92] active:bg-black/[0.08] disabled:pointer-events-none disabled:opacity-40 dark:text-white dark:hover:bg-white/[0.1] dark:active:bg-white/[0.14]";

/**
 * The welcome's emblem: the brain in the logo's gradient on a glow that
 * breathes, with two thin rings pulsing softly out of it (app/globals.css,
 * "Copilot ambience"). The glyph itself stays still — a slow float shimmers
 * on 1x screens — and every light is a gradient, never a blur filter.
 */
export function NovaOrb() {
  return (
    <div className="relative flex h-20 w-20 shrink-0 items-center justify-center sm:h-24 sm:w-24" aria-hidden="true">
      <svg width="0" height="0" className="absolute">
        <defs>
          <linearGradient id="copilot-orb-stroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="50%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
        </defs>
      </svg>
      <span className="copilot-emblem-glow" />
      <span className="copilot-emblem-ring" />
      <span className="copilot-emblem-ring" />
      <BrainCircuit color="url(#copilot-orb-stroke)" strokeWidth={1.5} className="relative h-12 w-12 sm:h-14 sm:w-14" />
    </div>
  );
}

/**
 * The living light behind a Copilot, mounted once per chat column (behind
 * its thread, welcome and composer) so it carries across the welcome ⇄
 * conversation swap instead of remounting.
 *
 * - "welcome": a tall blue aurora breathing up from the composer, two
 *   coloured currents drifting through it and a halftone dot-matrix wave.
 * - "thread": the same aurora, lower and calmer, hugging the composer; the
 *   welcome's extra layers fade out and pause. `active` (a reply is on its
 *   way) brightens it.
 *
 * Every loop is compositor-only (opacity + the standalone translate / scale
 * properties), so a main thread busy streaming a reply never costs it a frame.
 */
export function CopilotAmbience({ variant, active = false }: { variant: "welcome" | "thread"; active?: boolean }) {
  return (
    <div aria-hidden className="copilot-ambience" data-variant={variant} data-active={active ? "" : undefined}>
      <span className="copilot-aurora-core" />
      <span className="copilot-ambience-welcome">
        <span className="copilot-aurora-cyan" />
        <span className="copilot-aurora-indigo" />
        <span className="copilot-halftone" />
        <span className="copilot-halftone copilot-halftone-fine" />
      </span>
    </div>
  );
}

/** A welcome-screen suggestion. */
export interface CopilotSuggestion {
  icon: LucideIcon;
  /** The pill's words from sm. */
  label: string;
  /** The pill's words on phones, short enough for two pills to share a row. */
  short: string;
  /** The request it sends. */
  text: string;
}

/** Staggered entrance step (app/globals.css `.copilot-rise`, 75 ms apart). */
function riseStep(step: number): CSSProperties {
  return { "--rise": step } as CSSProperties;
}

/**
 * The welcome screen both Copilots open on: emblem, greeting, one line of
 * context and the suggestion pills, rising in one after another. It clears the
 * floating header and composer (their measured heights) and dissolves before
 * reaching them (.copilot-thread-fade).
 *
 * `size`: "page" (the full Copilot page, 44 px headline from lg) or "pane" (the
 * workspace's narrower chat pane, 44 px only from 2xl).
 */
export function CopilotWelcome({
  firstName,
  subtitle,
  notice,
  suggestions,
  onSuggestion,
  disabled = false,
  size = "page",
  suggestionsTourId,
}: {
  firstName: string;
  subtitle: ReactNode;
  /** Optional extra line under the subtitle (e.g. a very long course). */
  notice?: ReactNode;
  suggestions: readonly CopilotSuggestion[];
  onSuggestion: (text: string) => void;
  disabled?: boolean;
  size?: "page" | "pane";
  /** data-tour anchor for the pills row (guided tours). */
  suggestionsTourId?: string;
}) {
  const { language } = useLanguage();
  return (
    <div className="copilot-thread-fade relative isolate flex w-full min-w-0 max-w-full flex-1 flex-col items-center justify-center overflow-y-auto overflow-x-hidden overscroll-none px-4 pb-[calc(var(--copilot-composer-h,0px)+2rem)] pt-[calc(var(--copilot-header-h,0px)+2rem)] text-center sm:pb-[calc(var(--copilot-composer-h,0px)+2.5rem)] sm:pt-[calc(var(--copilot-header-h,0px)+2.5rem)]">
      <div className="copilot-rise" style={riseStep(0)}>
        <NovaOrb />
      </div>
      <div className="mt-5 w-full max-w-2xl sm:mt-6">
        {/* Two deliberate lines at one size, two tones: the greeting (the name in the logo's blues) over the question. */}
        <h1
          className={cn(
            "text-balance text-[30px] font-medium leading-[1.15] tracking-[-0.022em] sm:text-[38px]",
            size === "page" ? "lg:text-[44px] lg:tracking-[-0.026em]" : "2xl:text-[44px] 2xl:tracking-[-0.026em]"
          )}
        >
          <span className="copilot-rise block text-slate-900 dark:text-white" style={riseStep(1)}>
            {language === "fr" ? "Bonjour" : "Hi"}{" "}
            <span className="bg-gradient-to-r from-sky-600 via-blue-600 to-blue-700 bg-clip-text text-transparent dark:from-cyan-300 dark:via-sky-300 dark:to-blue-400">{firstName}</span>
          </span>{" "}
          <span className="copilot-rise block text-slate-500 dark:text-white/55" style={riseStep(2)}>
            {language === "fr" ? "On révise quoi aujourd'hui ?" : "What's on your mind?"}
          </span>
        </h1>
        <p className="copilot-rise mx-auto mt-4 max-w-md text-balance text-[15px] leading-relaxed text-slate-600 dark:text-white/60" style={riseStep(3)}>
          {subtitle}
        </p>
        {notice}
      </div>

      {suggestions.length > 0 && (
        // Floating pills, centred: short words on phones (two to a row), the full label from sm.
        <div data-tour={suggestionsTourId} className="mt-8 flex w-full max-w-2xl flex-wrap justify-center gap-2 sm:mt-10 sm:gap-2.5">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.text}
              type="button"
              onClick={() => onSuggestion(suggestion.text)}
              disabled={disabled}
              title={suggestion.text}
              className={cn(COPILOT_SUGGESTION_CLASSES, "copilot-rise")}
              style={riseStep(4 + index)}
            >
              <suggestion.icon className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" strokeWidth={1.75} />
              <span className="min-w-0 truncate sm:hidden">{suggestion.short}</span>
              <span className="hidden min-w-0 truncate sm:inline">{suggestion.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** `isPending`: true only while THIS message is actively streaming — the animated ping is a "generating now" signal, not a permanent decoration, so it stops once the reply is complete (a static dot per finished message would just be visual noise on a long scrollback). */
export function AssistantAvatar({ isPending = false }: { isPending?: boolean }) {
  return (
    <div className="relative mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-300">
      {isPending && (
        <span
          aria-hidden
          className="absolute -inset-[3px] animate-[spin_2.2s_linear_infinite] rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgba(56,189,248,0.95)_100deg,rgba(37,99,235,0.6)_160deg,transparent_220deg)] [mask:radial-gradient(farthest-side,transparent_calc(100%-2px),#000_calc(100%-2px))] motion-reduce:animate-[spin_4.4s_linear_infinite]"
        />
      )}
      <BrainCircuit className="h-5 w-5" strokeWidth={1.75} />
      <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
        {isPending && (
          <motion.span
            className="absolute inline-flex h-full w-full rounded-full bg-sky-400"
            initial={{ scale: 1, opacity: 0.55 }}
            animate={{ scale: 2.4, opacity: 0 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <span
          className={cn(
            "relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-400 transition-shadow duration-300",
            isPending && "shadow-[0_0_6px_2px_rgba(56,189,248,0.6)]"
          )}
        />
      </span>
    </div>
  );
}

/** Streaming placeholder shown before the first token arrives — paired with a short reassurance label rather than a bare spinner, so a student watching a blank bubble knows the assistant is working, not stuck. */
export function TypingIndicator({ label = "MedArt réfléchit…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1" role="status">
      <div className="flex items-center gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-400"
            animate={{ opacity: [0.25, 1, 0.25], scale: [0.8, 1.15, 0.8] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
          />
        ))}
      </div>
      <span className="copilot-shimmer bg-[linear-gradient(90deg,rgb(100_116_139)_0%,rgb(14_165_233)_45%,rgb(100_116_139)_90%)] bg-[length:220%_100%] bg-clip-text text-xs font-medium text-transparent dark:bg-[linear-gradient(90deg,rgb(148_163_184)_0%,rgb(125_211_252)_45%,rgb(148_163_184)_90%)]">
        {label}
      </span>
    </div>
  );
}
