"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-recovery";

interface LocalErrorBoundaryProps {
  children: ReactNode;
  /** Shown in the fallback card. */
  title?: string;
  description?: string;
  /** Called after "Réessayer" — lets the parent reset its own state before the subtree remounts. */
  onReset?: () => void;
  /** Changing this value clears a caught error (e.g. the current step / exam id). */
  resetKey?: string | number;
}

interface LocalErrorBoundaryState {
  error: Error | null;
  attempt: number;
}

/**
 * Error boundary for ONE panel: a crash inside it shows a small recoverable
 * card in place of that panel instead of blanking the page. A stale-deploy
 * chunk error triggers the app's guarded one-time reload instead.
 */
export class LocalErrorBoundary extends Component<LocalErrorBoundaryProps, LocalErrorBoundaryState> {
  state: LocalErrorBoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<LocalErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[LocalErrorBoundary]", error, info.componentStack);
    if (isChunkLoadError(error)) recoverFromChunkError();
  }

  componentDidUpdate(prevProps: LocalErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  private handleRetry = () => {
    this.props.onReset?.();
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  render() {
    if (!this.state.error) return <div key={this.state.attempt} className="contents">{this.props.children}</div>;
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/[0.06] px-6 py-10 text-center">
        <AlertTriangle className="h-7 w-7 text-amber-500" />
        <p className="text-sm font-bold text-foreground">{this.props.title ?? "Cet affichage a rencontré un problème."}</p>
        <p className="max-w-sm text-xs text-muted-foreground">{this.props.description ?? "Tes données sont intactes. Réessaie : la section va se recharger sans recharger la page."}</p>
        <button
          type="button"
          onClick={this.handleRetry}
          className="mt-1 flex min-h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-sky-400 px-5 text-sm font-black text-slate-950 active:scale-95"
        >
          <RotateCcw className="h-4 w-4" />
          Réessayer
        </button>
      </div>
    );
  }
}
