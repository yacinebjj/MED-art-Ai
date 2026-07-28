"use client";

import { useEffect, useState } from "react";
import type { ChatMessage } from "@/lib/types";

interface UseCourseChatResult {
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  chatMessages: ChatMessage[];
  chatInput: string;
  setChatInput: (value: string) => void;
  isTyping: boolean;
  /** Sends a user message to the MedArt Assistant and streams the reply in progressively. */
  sendChatMessage: (userContent: string) => Promise<void>;
}

/**
 * Drives the MedArt Assistant chat panel for a public showcase/demo course
 * (app/dashboard/demo/page.tsx and app/dashboard/demo/[slug]/page.tsx share
 * this exact logic — previously duplicated with a hardcoded static reply in
 * both files, now one real, streaming implementation).
 */
export function useCourseChat(slug?: string): UseCourseChatResult {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  // Load the student's saved history for this course the moment the reader
  // mounts, so the chat opens with their past exchanges instead of blank —
  // no course identity (the plain /dashboard/demo overview) means nothing to
  // fetch or save, which fetch() below skips entirely.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    fetch(`/api/courses/chat?slug=${encodeURIComponent(slug)}`)
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then((data: { messages?: ChatMessage[] }) => {
        if (!cancelled && data.messages?.length) setChatMessages(data.messages);
      })
      .catch(() => {
        // No saved history available (not signed in, network hiccup, etc.) —
        // the chat still works, it just starts empty, exactly as before.
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function sendChatMessage(userContent: string) {
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: userContent };
    const assistantId = crypto.randomUUID();
    const historyForRequest = chatMessages.map((m) => ({ role: m.role, content: m.content }));

    setChatMessages((prev) => [...prev, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setChatOpen(true);
    setIsTyping(true);

    try {
      const res = await fetch("/api/courses/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, message: userContent, history: historyForRequest }),
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
        setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: fullText } : m)));
        // The growing bubble itself is the "in progress" signal from here on —
        // clear the separate "MedArt écrit…" indicator the moment real text
        // starts arriving, so the two don't show redundantly at once.
        setIsTyping(false);
      }

      if (!fullText.trim()) {
        setChatMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: "⚠️ L'assistant n'a rien renvoyé. Réessaie." } : m))
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "L'assistant n'a pas pu répondre. Réessaie.";
      setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: `⚠️ ${message}` } : m)));
    } finally {
      setIsTyping(false);
    }
  }

  return { chatOpen, setChatOpen, chatMessages, chatInput, setChatInput, isTyping, sendChatMessage };
}
