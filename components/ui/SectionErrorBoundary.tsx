"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** What failed, shown to the student ("cette section", "le Lab"…). */
  label?: string;
  /** Changing this value (e.g. the opened section id) clears a previous error. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

/**
 * Local error boundary: a rendering crash inside one panel (a Studio tile
 * fed unexpected AI output, a Lab tool, an audio tab) is contained to that
 * panel with a clear message and a "Réessayer" button — the rest of the
 * page (sources, chat, navigation) keeps working, instead of the whole
 * route falling back to the global error screen.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[SectionErrorBoundary:${this.props.label ?? "section"}]`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-6 py-10 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-300">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-bold text-foreground">Impossible d&apos;afficher {this.props.label ?? "cette section"}</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">Le reste de la page fonctionne normalement. Réessaie ; si le problème persiste, régénère ce contenu.</p>
        </div>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-foreground px-4 text-xs font-bold text-background transition hover:opacity-90"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Réessayer
        </button>
      </div>
    );
  }
}
