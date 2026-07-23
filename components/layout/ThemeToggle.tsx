"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { motion } from "framer-motion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className={cn("h-8 w-14 rounded-full bg-muted", className)} />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          aria-label="Basculer le thème clair/sombre"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className={cn(
            "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border border-border p-1 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950",
            isDark ? "bg-slate-800" : "bg-slate-200",
            className
          )}
        >
          <motion.span
            animate={{ x: isDark ? 24 : 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-secondary-600 text-white shadow-soft"
          >
            <motion.span
              key={isDark ? "moon" : "sun"}
              initial={{ scale: 0.4, opacity: 0, rotate: -50 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ duration: 0.15 }}
            >
              {isDark ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            </motion.span>
          </motion.span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{isDark ? "Passer en mode clair" : "Passer en mode sombre"}</TooltipContent>
    </Tooltip>
  );
}
