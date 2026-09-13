import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * 404 page (Next.js App Router convention). Without this file Next.js serves
 * its own unstyled default, which breaks out of the app's visual language
 * entirely — and, worse, gives a student who followed a stale link no way
 * back into the app.
 *
 * A Server Component on purpose: it needs no interactivity, so it costs zero
 * client JS.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Compass className="h-7 w-7" />
      </div>

      <div className="space-y-2">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Page introuvable</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Cette page n&apos;existe pas ou a été déplacée. Vérifie le lien, ou repars du tableau de bord.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href="/dashboard">Tableau de bord</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Accueil</Link>
        </Button>
      </div>
    </div>
  );
}
