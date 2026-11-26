import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { LanguageProvider } from "@/providers/LanguageProvider";
import { PomodoroProvider } from "@/providers/PomodoroProvider"; // 👈 استيراد بومودورو
import { TooltipProvider } from "@/components/ui/Tooltip";
import { ToastProvider } from "@/components/ui/Toast";
import { PushClientFallbackProvider } from "@/providers/PushClientFallbackProvider";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { SecurityGuard } from "@/components/security/SecurityGuard";
import { SplashScreen } from "@/components/layout/SplashScreen";
import { ZoomLock } from "@/components/pwa/ZoomLock";
import { PERF_TIER_SCRIPT } from "@/lib/perf-tier";
import { STORAGE_SHIM_SCRIPT } from "@/lib/storage-shim";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Med Art AI — Réussis tes études de santé en Algérie",
  description:
    "Transforme tes cours de Médecine, Pharmacie et Chirurgie Dentaire en explications détaillées, résumés, pièges, mnémotechniques, cas cliniques et QCMs grâce à l'IA.",
  manifest: "/manifest.json",
  // Generated from public/logo.png's emblem (the wordmark is unreadable at
  // icon sizes):
  //  - favicon.ico (16/32/48) + a 192px PNG: transparent, square, multiples
  //    of 48px at stable crawlable URLs — what Google Search requires to show
  //    the favicon instead of the generic globe.
  //  - apple-touch-icon: iOS ignores the manifest and fills transparency
  //    with black, so it gets its own opaque, full-bleed 180px icon.
  // The previous icon-192/512.png had a solid white square baked in.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

// interactiveWidget: "resizes-content" makes Android Chrome shrink the layout
// viewport (and therefore h-dvh) when the on-screen keyboard opens, instead
// of leaving it full-height under a keyboard that just overlaps the bottom of
// the page. iOS Safari ignores this property — pages with a fixed action bar
// near a text input still need their own visualViewport listener as a
// fallback there (see e.g. the Notes and Assistant pages).
// viewportFit "cover" is what makes every env(safe-area-inset-*) in this app
// non-zero on iOS — without it they all silently resolve to 0.
// maximumScale/userScalable lock the UI at 1x (native-app feel) and stop
// iOS from zooming into a focused input; iOS pinch is blocked by ZoomLock.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

/**
 * Supabase's origin. The browser talks to it straight away on most pages
 * (session check, then files), and on a slow connection opening that
 * connection — DNS, TCP, TLS — costs several round trips before the first
 * byte; preconnecting starts it while the page itself still loads.
 */
const SUPABASE_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return null;
  }
})();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      {SUPABASE_ORIGIN && (
        <head>
          {/* crossOrigin "anonymous": supabase-js's requests are CORS without credentials, and use that connection pool. */}
          <link rel="preconnect" href={SUPABASE_ORIGIN} crossOrigin="anonymous" />
          <link rel="dns-prefetch" href={SUPABASE_ORIGIN} />
        </head>
      )}
      <body className={`${inter.variable} font-sans antialiased`}>
        {/* Blocked, disabled or full localStorage/sessionStorage can't crash the app (lib/storage-shim.ts). First, before any app code. */}
        <Script id="medart-storage-shim" strategy="beforeInteractive">
          {STORAGE_SHIM_SCRIPT}
        </Script>
        {/* Low-end devices get <html data-perf="lite"> before first paint (lib/perf-tier.ts). */}
        <Script id="medart-perf-tier" strategy="beforeInteractive">
          {PERF_TIER_SCRIPT}
        </Script>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <LanguageProvider>
            <PomodoroProvider> {/* 👈 إحاطة التطبيق بالبومودورو لضمان استمراريته في الخلفية */}
              <TooltipProvider delayDuration={200}>
                <ToastProvider>
                  <ServiceWorkerRegistration />
                  <PushClientFallbackProvider>
                    <SecurityGuard>{children}</SecurityGuard>
                  </PushClientFallbackProvider>
                </ToastProvider>
              </TooltipProvider>
            </PomodoroProvider>
          </LanguageProvider>
        </ThemeProvider>
        <SplashScreen />
        <ZoomLock />
      </body>
    </html>
  );
}