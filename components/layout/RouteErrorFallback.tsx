"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, LoaderCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-recovery";

/**
 * Shared body of the dashboard route error boundaries
 * (app/dashboard/error.tsx, app/dashboard/(shell)/error.tsx).
 *
 * - A ChunkLoadError (stale build after a deploy — see lib/chunk-recovery.ts)
 *   is recovered silently with one reload; the student sees "updating" for a
 *   split second instead of a white screen.
 * - Anything else: "Réessayer" re-fetches the route's server payload
 *   (router.refresh) AND re-renders the segment (reset), so a transient
 *   network failure mid-navigation recovers without a full reload.
 */
export function RouteErrorFallback({ error, reset, fullHeight = false }: { error: Error & { digest?: string }; reset: () => void; fullHeight?: boolean }) {
  const router = useRouter();
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (isChunkLoadError(error) && recoverFromChunkError()) {
      setRecovering(true);
      return;
    }
    console.error("[dashboard/error] Route error:", error);
  }, [error]);

  const wrapper = fullHeight ? "min-h-[100dvh]" : "min-h-[50vh]";

  if (recovering) {
    return (
      <div className={`flex ${wrapper} flex-col items-center justify-center gap-3 px-6 text-center`} role="status">
        <LoaderCircle className="h-7 w-7 animate-spin text-primary-500" />
        <p className="text-sm text-muted-foreground">Mise à jour de l&apos;application…</p>
      </div>
    );
  }

  return (
    <div className={`flex ${wrapper} flex-col items-center justify-center gap-5 px-6 text-center`}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Cette page n&apos;a pas pu s&apos;afficher</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Souvent une connexion instable. Ton travail enregistré n&apos;est pas perdu — réessaie, ou reviens au tableau de bord.
        </p>
        {error.digest && <p className="text-xs text-muted-foreground/70">Code de référence : {error.digest}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          onClick={() => {
            router.refresh();
            reset();
          }}
        >
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
