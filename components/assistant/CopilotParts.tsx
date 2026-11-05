"use client";

import { motion } from "framer-motion";
import { BrainCircuit } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The Copilot's look, shared by the MedArt Copilot
 * (app/dashboard/(shell)/assistant/page.tsx) and the module workspace's
 * Co-pilot (components/course/workspace/ChatDocumentPanel.tsx), so the two
 * read as one assistant: same orb, same avatar, same "thinking" line, same
 * composer hub, suggestions and bubbles.
 */

/** The floating composer hub: frosted, 36 px corners, a soft sky glow while focused. */
export const COPILOT_HUB_CLASSES =
  "relative flex w-full flex-col rounded-[36px] border border-black/[0.06] bg-white/85 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_44px_-18px_rgba(15,23,42,0.28)] backdrop-blur-2xl transition-[box-shadow,border-color] duration-300 focus-within:border-sky-500/30 focus-within:shadow-[0_0_0_1px_rgba(14,165,233,0.2),0_16px_48px_-16px_rgba(14,165,233,0.38)] dark:border-white/[0.09] dark:bg-[#0e1115]/80 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_64px_-20px_rgba(0,0,0,0.9)] dark:focus-within:border-sky-400/25 dark:focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_0_1px_rgba(56,189,248,0.16),0_24px_64px_-20px_rgba(14,165,233,0.32)]";

/** A welcome-screen suggestion: a compact tile in the phones' 2-column grid, a pill from sm. */
export const COPILOT_SUGGESTION_CLASSES =
  "flex min-h-[52px] min-w-0 items-center gap-2.5 rounded-2xl border border-black/[0.06] bg-white/70 px-3.5 py-2 text-left text-[13px] font-medium leading-snug text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors duration-200 hover:bg-white hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white/75 dark:shadow-none dark:hover:bg-white/[0.08] dark:hover:text-white sm:min-h-11 sm:gap-2 sm:rounded-full sm:px-4 sm:py-0";

/** The student's own message: a sky bubble on the right (white glass in dark). */
export const COPILOT_USER_BUBBLE_CLASSES =
  "max-w-full whitespace-pre-wrap break-words rounded-3xl rounded-br-lg border border-sky-100 bg-sky-50 px-4 py-2.5 text-[0.9375rem] leading-[1.5] text-slate-800 sm:text-[16px] dark:border-white/[0.06] dark:bg-white/[0.07] dark:text-white/90";

/**
 * A reply's action button: clear at a glance, 40 px discs with 20 px glyphs on
 * every screen, solid white in dark mode (near-black in light), a soft disc on
 * hover. Their row's negative margin (-ml-2.5) lines the first glyph up with
 * the reply's text.
 */
export const COPILOT_ACTION_BUTTON_CLASSES =
  "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-800 outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-black/[0.06] hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-sky-500/40 active:scale-[0.92] active:bg-black/[0.08] disabled:pointer-events-none disabled:opacity-40 dark:text-white dark:hover:bg-white/[0.1] dark:active:bg-white/[0.14]";

/** The welcome screen's glowing brain. */
export function NovaOrb() {
  return (
    <div className="relative flex h-20 w-20 shrink-0 items-center justify-center sm:h-24 sm:w-24" aria-hidden="true">
      {/* No tile, no frame: a multi-colour bloom and a gradient-stroked glyph floating on the canvas. */}
      <svg width="0" height="0" className="absolute">
        <defs>
          <linearGradient id="copilot-orb-stroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="50%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-2 rounded-full bg-[conic-gradient(from_200deg,rgba(56,189,248,0.45),rgba(34,211,238,0.4),rgba(37,99,235,0.45),rgba(56,189,248,0.45))] opacity-60 blur-2xl dark:opacity-70" />
      <BrainCircuit color="url(#copilot-orb-stroke)" strokeWidth={1.5} className="relative h-12 w-12 sm:h-14 sm:w-14" />
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
