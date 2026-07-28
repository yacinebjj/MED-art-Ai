"use client";

import { useEffect, useRef } from "react";
import { X, Send, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

/**
 * "overlay" = narrow slide-over from the right (workspace course page).
 * "split"   = fills its parent column for a true 50/50 split-screen (demo).
 * `dark` swaps the light frosted-glass look for the "Clinical Midnight
 * Aurora" glass variant — opt-in, defaults to false so the course workspace
 * (which always passes "overlay" and never sets `dark`) is unaffected.
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
  dark = false,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  isTyping: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  variant?: "overlay" | "split";
  dark?: boolean;
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

  const glass = dark
    ? "flex flex-col border-l border-white/10 bg-slate-900/40 backdrop-blur-2xl shadow-[0_0_60px_-15px_rgba(6,182,212,0.25)]"
    : "flex flex-col border-l border-white/60 bg-white/40 backdrop-blur-xl shadow-[0_0_40px_-10px_rgba(0,0,0,0.1)]";
  const rootClass =
    variant === "split"
      ? cn("relative z-10 h-full w-1/2 shrink-0 animate-fade-in", glass)
      : cn("fixed inset-y-0 right-0 z-50 w-full max-w-sm animate-fade-in", glass);

  return (
    <div className={rootClass}>
      <div
        className={cn(
          "flex items-center justify-between border-b p-4",
          dark ? "border-white/10 bg-white/[0.02]" : "border-white/40 bg-white/30"
        )}
      >
        <h2 className={cn("flex items-center gap-2 text-sm font-semibold", dark ? "text-white" : "text-gray-900")}>
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-lg text-white",
              dark ? "bg-gradient-to-br from-cyan-500 to-blue-600" : "bg-blue-600"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          MedArt Assistant
        </h2>
        <button
          onClick={onClose}
          className={cn(
            "rounded-lg p-1 transition-colors",
            dark ? "text-slate-400 hover:bg-white/10 hover:text-white" : "text-gray-500 hover:bg-white/60 hover:text-gray-800"
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className={cn("flex-1 space-y-3 overflow-y-auto p-4", dark && "custom-scrollbar")}>
        {messages.length === 0 && (
          <p className={cn("mt-8 text-center text-sm", dark ? "text-slate-500" : "text-gray-500")}>
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
                  ? dark
                    ? "bg-gradient-to-br from-cyan-600 to-blue-600 text-white"
                    : "bg-blue-600 text-white"
                  : dark
                    ? "bg-white/5 text-slate-100 ring-1 ring-white/10"
                    : "bg-white/80 text-gray-900 ring-1 ring-white/60"
              )}
            >
              {message.content}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div
              className={cn(
                "flex items-center gap-1 rounded-2xl px-4 py-3",
                dark ? "bg-white/5 text-slate-400 ring-1 ring-white/10" : "bg-white/80 text-gray-500 ring-1 ring-white/60"
              )}
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs">MedArt écrit…</span>
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className={cn("flex gap-2 border-t p-3", dark ? "border-white/10 bg-white/[0.02]" : "border-white/40 bg-white/30")}
      >
        <input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Pose ta question…"
          className={cn(
            "flex-1 rounded-lg border px-3 py-2 text-sm outline-none transition-colors",
            dark
              ? "border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:bg-white/10"
              : "border-white/60 bg-white/70 focus:border-blue-400 focus:bg-white"
          )}
        />
        <button
          type="submit"
          disabled={input.trim().length === 0 || isTyping}
          className={cn(
            "flex items-center justify-center rounded-lg px-3 py-2 text-white transition-all duration-300 disabled:opacity-40",
            dark
              ? "bg-gradient-to-r from-cyan-600 to-blue-600 hover:shadow-[0_0_15px_rgba(6,182,212,0.5)]"
              : "bg-blue-600 hover:bg-blue-700"
          )}
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
