import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped channel from callOpenRouter's token stream to the HTTP
 * keep-alive wrapper (lib/http/keep-alive.ts), so any route wrapped by it
 * reports live generation progress without threading a callback through
 * every helper between the route and the model call.
 */
export type GenerationProgressListener = (deltaChars: number) => void;

const storage = new AsyncLocalStorage<GenerationProgressListener>();

export function runWithGenerationProgress<T>(listener: GenerationProgressListener, fn: () => T): T {
  return storage.run(listener, fn);
}

export function reportGenerationProgress(deltaChars: number): void {
  const listener = storage.getStore();
  if (!listener) return;
  try {
    listener(deltaChars);
  } catch {
    // Progress is cosmetic; it must never break a generation.
  }
}
