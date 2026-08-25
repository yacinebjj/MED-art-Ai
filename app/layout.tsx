import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { LanguageProvider } from "@/providers/LanguageProvider";
import { PomodoroProvider } from "@/providers/PomodoroProvider"; // 👈 استيراد بومودورو
import { TooltipProvider } from "@/components/ui/Tooltip";
import { ToastProvider } from "@/components/ui/Toast";
import { PushClientFallbackProvider } from "@/providers/PushClientFallbackProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Med Art AI — Réussis tes études de santé en Algérie",
  description:
    "Transforme tes cours de Médecine, Pharmacie et Chirurgie Dentaire en explications détaillées, résumés, pièges, mnémotechniques, cas cliniques et QCMs grâce à l'IA.",
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
                  <PushClientFallbackProvider>{children}</PushClientFallbackProvider>
                </ToastProvider>
              </TooltipProvider>
            </PomodoroProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}