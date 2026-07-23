"use client";

import { useEffect, useRef } from "react";
import { X, Send, Loader2 } from "lucide-react";
import type { ChatMessage } from "@/lib/types";

export function ChatPanel({
  open,
  onClose,
  messages,
  isTyping,
  input,
  onInputChange,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  isTyping: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping, open]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input.trim().length === 0) return;
    onSend();
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-sm font-semibold text-gray-900">MedArt Assistant</h2>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-gray-400">
            Sélectionne un passage du cours ou pose une question ici.
          </p>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                message.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-900"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl bg-gray-200 px-4 py-3 text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs">MedArt écrit…</span>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t p-3">
        <input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Pose ta question…"
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
        <button
          type="submit"
          disabled={input.trim().length === 0 || isTyping}
          className="flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
