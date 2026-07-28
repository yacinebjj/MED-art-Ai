"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";

interface LazySectionProps<T> {
  dark: boolean;
  /** null/undefined = not generated yet. */
  data: T | null | undefined;
  /** Feminine/masculine article + noun, e.g. "l'Explication", "les QCM". */
  label: string;
  endpoint: string;
  slug: string;
  onGenerated: (data: T) => void;
  children: (data: T) => React.ReactNode;
}

/**
 * Wraps one Studio tab's content with the lazy-generation lifecycle: empty
 * state with a "Générer ..." button, loading state on click, and a toast +
 * inline error on failure — shared across all 5 tabs instead of duplicating
 * this button/spinner/error logic per Studio component.
 */
export function LazySection<T>({ dark, data, label, endpoint, slug, onGenerated, children }: LazySectionProps<T>) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (data !== null && data !== undefined) {
    return <>{children(data)}</>;
  }

  async function handleGenerate() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) {
        const message: string = body?.error ?? "La génération a échoué.";
        setError(message);
        toast({ variant: "error", title: `Échec de la génération`, description: message });
        return;
      }
      onGenerated(body.data as T);
      toast({ variant: "success", title: `Contenu généré`, description: `${label} est prêt(e).` });
    } catch {
      const message = "Impossible de contacter le serveur.";
      setError(message);
      toast({ variant: "error", title: "Échec de la génération", description: message });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 py-20 text-center", dark ? "text-slate-300" : "text-slate-600")}>
      <div
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-2xl",
          error ? "bg-amber-500/10 text-amber-500" : dark ? "bg-cyan-500/10 text-cyan-400" : "bg-cyan-50 text-cyan-600"
        )}
      >
        {error ? <AlertTriangle className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </div>

      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium">{error ?? `Ce contenu n'a pas encore été généré.`}</p>
        {!error && <p className={cn("text-xs", dark ? "text-slate-500" : "text-slate-400")}>Clique pour laisser l'IA préparer {label}.</p>}
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={isLoading}
        className={cn(
          "flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-sm transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-60",
          dark
            ? "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
            : "bg-cyan-600 text-white hover:bg-cyan-500"
        )}
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {isLoading ? "Génération en cours..." : error ? `Réessayer — Générer ${label}` : `Générer ${label}`}
      </button>
    </div>
  );
}
