"use client";

import { useEffect } from "react";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-recovery";

/**
 * Global safety net for chunk-load failures that never reach a React error
 * boundary (a rejected dynamic import() in an event handler, a failed
 * next/dynamic load, a CSS chunk). See lib/chunk-recovery.ts. Mounted once
 * in app/dashboard/layout.tsx.
 */
export function ChunkErrorRecovery() {
  useEffect(() => {
    function onError(event: ErrorEvent) {
      if (isChunkLoadError(event.error ?? event.message)) recoverFromChunkError();
    }
    function onRejection(event: PromiseRejectionEvent) {
      if (isChunkLoadError(event.reason)) recoverFromChunkError();
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
