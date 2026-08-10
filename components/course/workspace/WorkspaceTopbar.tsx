"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Copy, Moon, Settings, Share2, Stethoscope, Sun } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Avatar, AvatarFallback } from "@/components/ui/Avatar";

interface WorkspaceTopbarProps {
  title: string;
}

/** NotebookLM-style topbar: logo + course title on the left, action cluster on the right. */
export function WorkspaceTopbar({ title }: WorkspaceTopbarProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  // next-themes only knows the real theme after mount (it reads
  // localStorage client-side) — rendering Sun/Moon from `isDark` before that
  // resolves means the server's default-theme guess can differ from the
  // client's first render, which React flags as a hydration mismatch. Same
  // guard as components/layout/ThemeToggle.tsx.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-2 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-secondary-600 text-white">
            <Stethoscope className="h-4 w-4" />
          </span>
          <span className="hidden text-sm font-bold text-gray-900 dark:text-gray-100 sm:inline">Med Art AI</span>
        </Link>
        <span className="hidden h-6 w-px shrink-0 bg-gray-200 dark:bg-neutral-700 sm:block" />
        <h1 className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
          {title || "Cours"}
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <Button asChild size="sm" className="rounded-full">
          <Link href="/dashboard">Créer des notes</Link>
        </Button>

        <Button variant="ghost" size="icon" aria-label="Copier le lien">
          <Copy className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Partager">
          <Share2 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          aria-label={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {!mounted ? (
            <Moon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          ) : isDark ? (
            <Sun className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          ) : (
            <Moon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Paramètres">
              <Settings className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Paramètres</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Aide</DropdownMenuItem>
            <DropdownMenuItem>Envoyer un avis</DropdownMenuItem>
            <DropdownMenuItem>Langue de sortie</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Paramètres du compte</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Avatar className="h-8 w-8">
          <AvatarFallback className="text-xs">ET</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
