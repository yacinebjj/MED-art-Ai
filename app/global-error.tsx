"use client";

import { useEffect } from "react";

/**
 * Last-resort Error Boundary, for an error thrown by the ROOT LAYOUT itself
 * (app/layout.tsx and its providers: ThemeProvider, LanguageProvider,
 * PomodoroProvider, ToastProvider…). app/error.tsx cannot catch those —
 * it renders INSIDE the root layout, so if the layout is what threw, there
 * is no layout left to render it in.
 *
 * Next.js requires this file to render its own <html> and <body>: it
 * REPLACES the root layout entirely rather than nesting inside it. That is
 * also why it uses inline styles and no shared components — every provider,
 * every Tailwind-styled UI primitive, and the font variable all live in the
 * layout that just failed, so depending on any of them here risks throwing a
 * second time inside the very boundary meant to be the safety net.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app/global-error] Root layout crashed:", error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>L&apos;application n&apos;a pas pu démarrer</h1>
        <p style={{ maxWidth: "28rem", fontSize: "0.875rem", color: "#475569", margin: 0 }}>
          Une erreur critique est survenue au chargement. Recharge la page — si le problème persiste, réessaie dans quelques minutes.
        </p>
        {error.digest && <p style={{ fontSize: "0.75rem", color: "#94a3b8", margin: 0 }}>Code de référence : {error.digest}</p>}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "0.5rem",
            cursor: "pointer",
            borderRadius: "0.75rem",
            border: "none",
            background: "#0f172a",
            color: "#ffffff",
            padding: "0.625rem 1.25rem",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          Recharger
        </button>
      </body>
    </html>
  );
}
