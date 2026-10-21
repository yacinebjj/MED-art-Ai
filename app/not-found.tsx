import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { GlassArt } from "@/components/ui/GlassArt";

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
      {/* A fractured glass bone: the broken link, in a medical student's own vocabulary. */}
      <GlassArt name="fracture" size={160} className="h-32 w-32 animate-float motion-reduce:animate-none sm:h-40 sm:w-40" />

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
