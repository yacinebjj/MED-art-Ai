"use client";

import { useEffect, useRef, useState } from "react";
import { isQuotedChatMessage } from "@/lib/demo-content";
import { useToast } from "@/components/ui/Toast";
import type { ChatMessage } from "@/lib/types";
import type { ChatMode } from "@/lib/chat-constants";

/**
 * Per-request extras the module workspace sends with EVERY turn (including
 * a "Régénérer") — the composer's answer mode, the extra checked sources,
 * and the structured-format opt-in. Read through a ref at send time, so the
 * value current when the student presses Send is the one used, never a
 * stale closure. Omitted entirely by the demo pages.
 */
export interface CourseChatRequestExtras {
  mode?: ChatMode;
  sourceCourseIds?: number[];
  structured?: boolean;
}

interface UseCourseChatResult {
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  chatMessages: ChatMessage[];
  chatInput: string;
  setChatInput: (value: string) => void;
  isTyping: boolean;
  /** True for the WHOLE request — from send until the stream ends — unlike `isTyping`, which drops as soon as the first chunk arrives (it drives the "MedArt écrit…" indicator). Use this to block a second overlapping send. */
  isStreaming: boolean;
  /** Sends a user message to the MedArt Assistant and streams the reply in progressively. `concise` forces a 2-3 sentence answer server-side — for the "Ask MedArt" text-selection quick action only, never for the free-form chat input, to avoid degrading normal answer quality. `translate` swaps the system prompt entirely for a strict medical-translator persona (arabe + français) — for the "Translate" quick action only, mutually exclusive with `concise`. `sourceText` lets a caller with no matching `courses` table row (e.g. the studio_courses-backed module workspace) supply the course context inline instead of relying on the server's slug lookup — ignored server-side when `selectedText` is set. `selectedText` is the exact highlighted passage: passing it (alongside `concise` or `translate`) puts the server in "highlight isolation" mode — no course text, no history, forced onto the cheap model (see app/api/courses/chat/route.ts's isHighlightMode). `excludeFromHistory` marks BOTH this message and its reply so neither resends in any LATER request's history (see ChatMessage.excludeFromHistory in lib/types.ts) — set for one-off quick actions (Ask MedArt/Translate on a text selection) so they inform only their own exchange. */
  sendChatMessage: (
    userContent: string,
    options?: {
      concise?: boolean;
      translate?: boolean;
      sourceText?: string;
      selectedText?: string;
      excludeFromHistory?: boolean;
    }
  ) => Promise<void>;
  /** Re-runs the user turn that produced `assistantId`, replacing that reply (and dropping anything after it) with a freshly generated one — the "Regenerate" action under each assistant message. Forces `bypassCache` so it's never the same stored answer, and preserves the original turn's excludeFromHistory flag so regenerating an "Ask MedArt" quick action stays out of history exactly as the first attempt did. No-op while a reply is already streaming. */
  regenerateFrom: (assistantId: string) => Promise<void>;
  /** A real reset, not just a local one: wipes this course's `course_chat_history` rows server-side (DELETE /api/courses/chat) and only clears the on-screen conversation once that succeeds — a failed delete leaves the transcript on screen with an error toast instead of silently keeping stale rows the student was told were gone. */
  clearMessages: () => Promise<void>;
}

/**
 * Drives the MedArt Assistant chat panel for a public showcase/demo course
 * (app/dashboard/demo/page.tsx and app/dashboard/demo/[slug]/page.tsx share
 * this exact logic — previously duplicated with a hardcoded static reply in
 * both files, now one real, streaming implementation).
 */
export function useCourseChat(slug?: string, requestExtras?: CourseChatRequestExtras): UseCourseChatResult {
  const { toast } = useToast();
  const requestExtrasRef = useRef<CourseChatRequestExtras | undefined>(requestExtras);
  requestExtrasRef.current = requestExtras;
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  // Guards the streaming loop in sendChatMessage below against setState on an
  // unmounted component — a student can send a message then immediately
  // navigate away (another course, back to the dashboard) while the reply is
  // still streaming in. Found during a memory-leak audit.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load the student's saved history for this course the moment the reader
  // mounts, so the chat opens with their past exchanges instead of blank —
  // no course identity (the plain /dashboard/demo overview) means nothing to
  // fetch or save, which fetch() below skips entirely.
  useEffect(() => {
    // Reset unconditionally, BEFORE the fetch even starts — switching to a
    // module/course with no saved history must never leave the PREVIOUS
    // course's transcript on screen (and in this hook's own `chatMessages`,
    // which is what gets resent as history on the next message) just
    // because the fetch below found nothing to overwrite it with.
    setChatMessages([]);
    if (!slug) return;
    let cancelled = false;

    fetch(`/api/courses/chat?slug=${encodeURIComponent(slug)}`)
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then((data: { messages?: ChatMessage[] }) => {
        if (cancelled || !data.messages?.length) return;
        // Persisted rows have no excludeFromHistory column — heuristically
        // re-flag a citation exchange (the user message and the assistant
        // reply immediately after it) so reopening a saved conversation
        // doesn't reintroduce the same leak on its very next message.
        const restored = data.messages.map((m, i, arr) => {
          const prev = arr[i - 1];
          const isCitation = m.role === "user" && isQuotedChatMessage(m.content);
          const isCitationReply = m.role === "assistant" && prev && prev.role === "user" && isQuotedChatMessage(prev.content);
          return isCitation || isCitationReply ? { ...m, excludeFromHistory: true } : m;
        });
        setChatMessages(restored);
      })
      .catch(() => {
        // No saved history available (not signed in, network hiccup, etc.) —
        // the chat still works, it just starts empty, exactly as before.
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  interface SendOptions {
    concise?: boolean;
    translate?: boolean;
    sourceText?: string;
    selectedText?: string;
    excludeFromHistory?: boolean;
    /** Forces a fresh generation instead of a cached answer (the caching directive's required bypass/regenerate escape hatch) — see app/api/courses/chat/route.ts's own shouldBypassCache. */
    bypassCache?: boolean;
  }

  /**
   * The one place the POST-and-stream loop lives — shared verbatim by
   * sendChatMessage (a brand-new turn) and regenerateFrom (re-running an
   * existing turn). `assistantId` is the id of the already-inserted, empty
   * assistant bubble this stream fills in; `historyForRequest` is the context
   * the caller decided to send (each caller computes its own, since "the
   * history before this turn" differs between a fresh send and a regenerate).
   */
  async function streamReplyInto(
    assistantId: string,
    userContent: string,
    historyForRequest: { role: string; content: string }[],
    options?: SendOptions
  ) {
    setChatOpen(true);
    setIsTyping(true);
    setIsStreaming(true);

    try {
      const res = await fetch("/api/courses/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          message: userContent,
          history: historyForRequest,
          concise: options?.concise === true,
          translate: options?.translate === true,
          sourceText: options?.sourceText,
          selectedText: options?.selectedText,
          ...(options?.bypassCache ? { bypassCache: true } : {}),
          ...(requestExtrasRef.current ?? {}),
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "L'assistant n'a pas pu répondre.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        if (!isMountedRef.current) continue; // keep draining the stream, just stop touching state
        setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: fullText } : m)));
        // The growing bubble itself is the "in progress" signal from here on —
        // clear the separate "MedArt écrit…" indicator the moment real text
        // starts arriving, so the two don't show redundantly at once.
        setIsTyping(false);
      }

      if (!isMountedRef.current) return;

      if (!fullText.trim()) {
        setChatMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: "⚠️ L'assistant n'a rien renvoyé. Réessaie." } : m))
        );
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      const message = err instanceof Error ? err.message : "L'assistant n'a pas pu répondre. Réessaie.";
      setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: `⚠️ ${message}` } : m)));
    } finally {
      if (isMountedRef.current) {
        setIsTyping(false);
        setIsStreaming(false);
      }
    }
  }

  async function sendChatMessage(userContent: string, options?: SendOptions) {
    const exclude = options?.excludeFromHistory === true;
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: userContent, excludeFromHistory: exclude };
    const assistantId = crypto.randomUUID();
    // Past messages flagged excludeFromHistory (a prior quick action's quote
    // AND its reply) are dropped entirely here — not trimmed, not
    // paraphrased, just absent — so nothing about that exchange can anchor
    // this or any later message back onto its topic.
    const historyForRequest = chatMessages.filter((m) => !m.excludeFromHistory).map((m) => ({ role: m.role, content: m.content }));

    setChatMessages((prev) => [...prev, userMessage, { id: assistantId, role: "assistant", content: "", excludeFromHistory: exclude }]);

    await streamReplyInto(assistantId, userContent, historyForRequest, options);
  }

  async function regenerateFrom(assistantId: string) {
    if (isTyping || isStreaming) return;

    // Locate the assistant reply and the user turn that produced it. Computed
    // from the current render's chatMessages (fresh every render) — this is a
    // direct user action, so there's no stale-closure risk worth a ref.
    const idx = chatMessages.findIndex((m) => m.id === assistantId);
    if (idx < 1) return;
    const userMsg = chatMessages[idx - 1];
    if (userMsg.role !== "user") return;

    // History is everything strictly BEFORE that user turn (same
    // excludeFromHistory filtering sendChatMessage applies) — the turn being
    // regenerated is re-sent as `message`, never duplicated into its own
    // history.
    const historyForRequest = chatMessages
      .slice(0, idx - 1)
      .filter((m) => !m.excludeFromHistory)
      .map((m) => ({ role: m.role, content: m.content }));

    const newAssistantId = crypto.randomUUID();
    // Drop the old reply and anything after it (ChatGPT-style: regenerating a
    // turn invalidates everything downstream of it), keep the user message,
    // and append a fresh empty bubble to stream into.
    setChatMessages((prev) => {
      const cut = prev.findIndex((m) => m.id === assistantId);
      if (cut < 1) return prev;
      return [
        ...prev.slice(0, cut),
        { id: newAssistantId, role: "assistant", content: "", excludeFromHistory: userMsg.excludeFromHistory },
      ];
    });

    await streamReplyInto(newAssistantId, userMsg.content, historyForRequest, {
      excludeFromHistory: userMsg.excludeFromHistory,
      bypassCache: true,
    });
  }

  async function clearMessages() {
    // No course identity (the plain /dashboard/demo overview) — nothing
    // persisted for this to wipe, same guard as the load effect above.
    if (!slug) {
      setChatMessages([]);
      return;
    }
    try {
      const res = await fetch(`/api/courses/chat?slug=${encodeURIComponent(slug)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "La suppression a échoué.");
      setChatMessages([]);
    } catch (error) {
      // Deliberately does NOT clear local state on failure — the whole point
      // is that "Nouvelle conversation" must not look reset while the old
      // rows are still sitting in course_chat_history.
      toast({
        variant: "error",
        title: "Échec de la réinitialisation",
        description: error instanceof Error ? error.message : "Impossible de contacter le serveur.",
      });
    }
  }

  return { chatOpen, setChatOpen, chatMessages, chatInput, setChatInput, isTyping, isStreaming, sendChatMessage, regenerateFrom, clearMessages };
}
