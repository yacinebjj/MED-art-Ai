"use client";

import { useEffect, useRef } from "react";
import { X, Send, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

/**
 * "overlay" = narrow slide-over from the right (workspace course page).
 * "split"   = fills its parent column for a true 50/50 split-screen (demo).
 * Both share the same frosted-glass (glassmorphism) styling.
 */
export function ChatPanel({
  open,
  onClose,
  messages,
  isTyping,
  input,
  onInputChange,
  onSend,
  variant = "overlay",
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  isTyping: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  variant?: "overlay" | "split";
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

  const glass =
    "flex flex-col border-l border-white/60 bg-white/40 backdrop-blur-xl shadow-[0_0_40px_-10px_rgba(0,0,0,0.1)]";
  const rootClass =
    variant === "split"
      ? cn("relative z-10 h-full w-1/2 shrink-0 animate-fade-in", glass)
      : cn("fixed inset-y-0 right-0 z-50 w-full max-w-sm animate-fade-in", glass);

  return (
    <div className={rootClass}>
      <div className="flex items-center justify-between border-b border-white/40 bg-white/30 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          MedArt Assistant
        </h2>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-gray-500 transition-colors hover:bg-white/60 hover:text-gray-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-gray-500">
            Sélectionne un passage du cours ou pose une question ici.
          </p>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm shadow-sm",
                message.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-white/80 text-gray-900 ring-1 ring-white/60"
              )}
            >
              {message.content}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl bg-white/80 px-4 py-3 text-gray-500 ring-1 ring-white/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs">MedArt écrit…</span>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-white/40 bg-white/30 p-3">
        <input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Pose ta question…"
          className="flex-1 rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 focus:bg-white"
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
