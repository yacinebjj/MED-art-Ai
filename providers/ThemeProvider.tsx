"use client";

// App-wide: real colors for theme-token opacity classes (bg-popover/95, border-border/60…) — see the file header.
import "@/components/ui/token-alpha.css";

import { useEffect, type ComponentProps } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";

type ThemeProviderProps = ComponentProps<typeof NextThemesProvider>;

// .aurora-canvas-bg's base colors (app/globals.css) — the page background actually visible behind the top bar.
const BROWSER_CHROME_COLORS = { light: "#f8fafc", dark: "#030712" } as const;

// Tints the iOS Safari / Android Chrome status and address bars to match the
// current theme. Needed at runtime because dark mode is class-based, so a
// prefers-color-scheme media query in the viewport export would mismatch.
function BrowserChromeColor() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = resolvedTheme === "dark" ? BROWSER_CHROME_COLORS.dark : BROWSER_CHROME_COLORS.light;
  }, [resolvedTheme]);

  return null;
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      <BrowserChromeColor />
      {children}
    </NextThemesProvider>
  );
}
