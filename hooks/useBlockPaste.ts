"use client";

import { ClipboardEvent, useCallback } from "react";
import { useToast } from "@/components/ui/Toast";
import { EXTERNAL_COPY_WARNING, INTERNAL_CLIPBOARD_KEY } from "@/hooks/useSecurityGuard";

const MAX_PASTE_CHARS = 500;

interface UseSmartPasteOptions {
  /** The controlled input/textarea's current value. */
  value: string;
  /** Called with the new value once paste is resolved — this hook never lets the browser's native paste happen, it always resolves the text itself and hands back the full next value. */
  onChange: (next: string) => void;
}

/**
 * Smart paste for the chat input (or any other controlled text field that
 * needs it): resolves what the user is ACTUALLY trying to paste.
 *
 * - If the system clipboard holds exactly EXTERNAL_COPY_WARNING, that means
 *   whatever's on it came from THIS app's own copy/cut handler (see
 *   useSecurityGuard's swapClipboard) — the real text lives in
 *   sessionStorage's internal clipboard instead, so that's what gets
 *   pasted. Copy-paste keeps working seamlessly within the app.
 * - Anything else is a genuine external paste (a phone number, a line from
 *   another app) and goes through as-is.
 *
 * Either way, still capped at MAX_PASTE_CHARS — the anti-spam limit this
 * app already applies to the chat input, unrelated to the internal/
 * external distinction above and enforced on top of it.
 */
export function useSmartPaste({ value, onChange }: UseSmartPasteOptions) {
  const { toast } = useToast();

  return useCallback(
    (e: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.preventDefault();

      const clipboardText = e.clipboardData.getData("text");
      const isInternalCopy = clipboardText === EXTERNAL_COPY_WARNING;
      const resolvedText = isInternalCopy ? sessionStorage.getItem(INTERNAL_CLIPBOARD_KEY) ?? "" : clipboardText;

      if (resolvedText.length > MAX_PASTE_CHARS) {
        toast({ variant: "info", title: "Message trop long. Le collage massif est interdit." });
        return;
      }
      if (!resolvedText) return;

      const input = e.currentTarget;
      const start = input.selectionStart ?? value.length;
      const end = input.selectionEnd ?? value.length;
      onChange(value.slice(0, start) + resolvedText + value.slice(end));
    },
    [value, onChange, toast]
  );
}
