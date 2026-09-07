import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { LanguageProvider } from "@/providers/LanguageProvider";
import { PomodoroProvider } from "@/providers/PomodoroProvider"; // 👈 استيراد بومودورو
import { TooltipProvider } from "@/components/ui/Tooltip";
import { ToastProvider } from "@/components/ui/Toast";
import { PushClientFallbackProvider } from "@/providers/PushClientFallbackProvider";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { SecurityGuard } from "@/components/security/SecurityGuard";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Med Art AI — Réussis tes études de santé en Algérie",
  description:
    "Transforme tes cours de Médecine, Pharmacie et Chirurgie Dentaire en explications détaillées, résumés, pièges, mnémotechniques, cas cliniques et QCMs grâce à l'IA.",
  manifest: "/manifest.json",
  // iOS Safari never reads the web manifest's `icons` for "Add to Home
  // Screen" — it only ever looks for an explicit <link rel="apple-touch-icon">,
  // which this `icons.apple` field renders. Without it, iOS installs with a
  // blank/default icon regardless of what's in manifest.json.
  icons: {
    apple: "/icon-192.png",
  },
};

// interactiveWidget: "resizes-content" makes Android Chrome shrink the layout
// viewport (and therefore h-dvh) when the on-screen keyboard opens, instead
// of leaving it full-height under a keyboard that just overlaps the bottom of
// the page. iOS Safari ignores this property — pages with a fixed action bar
// near a text input still need their own visualViewport listener as a
// fallback there (see e.g. the Notes and Assistant pages).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
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
      </body>
    </html>
  );
}