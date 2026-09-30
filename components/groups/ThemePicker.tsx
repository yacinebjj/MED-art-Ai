"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHAT_THEMES } from "@/lib/chat-themes";

interface ThemePickerProps {
  themeId: string;
  onSelect: (id: string) => void;
}

/** Discreet palette icon in the chat header — opens a small swatch row to pick the sent-bubble theme. */
export function ThemePicker({ themeId, onSelect }: ThemePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full p-1.5 text-zinc-500 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-100 hover:text-cyan-600 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-cyan-300 dark:hover:shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] active:scale-90"
        aria-label="Choisir un thème de discussion"
      >
        <Palette className="h-4 w-4" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full z-50 mt-2 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-2.5 shadow-xl shadow-zinc-300/40 dark:border-white/5 dark:bg-zinc-900/90 dark:shadow-black/40"
            >
              {CHAT_THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onSelect(t.id);
                    setOpen(false);
                  }}
                  title={t.name}
                  className={cn(
                    "h-7 w-7 shrink-0 rounded-full ring-offset-2 ring-offset-white transition-transform hover:scale-110 dark:ring-offset-zinc-900",
                    t.swatch,
                    themeId === t.id && "ring-2 ring-cyan-500 dark:ring-cyan-400"
                  )}
                  aria-label={t.name}
                />
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
