"use client";

import { ClipboardEvent, useCallback } from "react";
import { useToast } from "@/components/ui/Toast";

/**
 * Blocks pasting into a text field and surfaces why — used on the group
 * chat's message input per the anti-leak brief (students must type, not
 * paste, so copied AI/Studio content can't be dropped straight into a
 * group chat). This is a plain `preventDefault()` on the input's own
 * `onPaste`: real friction against casual paste-and-send, but not a
 * security boundary — anything typed by hand, or pasted through the
 * browser's native context menu on some platforms, still gets through, and
 * that's an accepted limitation, not a gap to "fix" with more JS.
 */
export function useBlockPaste() {
  const { toast } = useToast();

  return useCallback(
    (e: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.preventDefault();
      toast({ variant: "info", title: "Le copier-coller est désactivé pour protéger les droits d'auteur." });
    },
    [toast]
  );
}
