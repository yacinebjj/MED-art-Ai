"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Route-segment Error Boundary for the whole app (Next.js App Router
 * convention — a `error.tsx` is automatically wrapped around its segment's
 * children as a React Error Boundary).
 *
 * The app previously shipped with ZERO error boundaries anywhere: an
 * uncaught render/effect error in any of the ~155 client components blanked
 * the page (React unmounts the whole tree on an uncaught error) and, in
 * production, gave the student no message, no recovery and no way back —
 * just a white screen. `reset()` re-renders the segment without a full page
 * reload, which recovers from a transient error (a bad fetch result, a
 * momentarily-undefined field) without losing the session.
 *
 * Deliberately NOT a place to show `error.message`: in production Next.js
 * replaces it with a generic string anyway, and the real detail belongs in
 * the server logs / `error.digest`, not in front of a student.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Kept as console.error (not a toast): this renders INSTEAD of the page,
    // so the app's toast provider may itself be part of what failed.
    console.error("[app/error] Uncaught render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-7 w-7" />
      </div>

      <div className="space-y-2">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Une erreur est survenue</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Quelque chose s&apos;est mal passé de notre côté. Ton travail enregistré n&apos;est pas perdu — réessaie, ou reviens au tableau de bord.
        </p>
        {error.digest && <p className="text-xs text-muted-foreground/70">Code de référence : {error.digest}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" onClick={reset}>
          <RotateCcw className="h-4 w-4" />
          Réessayer
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Retour au tableau de bord</Link>
        </Button>
      </div>
    </div>
  );
}
