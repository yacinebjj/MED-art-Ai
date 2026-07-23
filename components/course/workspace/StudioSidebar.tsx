"use client";

import { Loader2, MessageCircle, Mic } from "lucide-react";
import { STUDIO_CONTENT_TYPES, type ContentType } from "@/lib/types";

export function StudioSidebar({
  activeContentType,
  loadingContentType,
  onSelect,
  onOpenChat,
}: {
  activeContentType: ContentType;
  loadingContentType: ContentType | null;
  onSelect: (type: ContentType) => void;
  onOpenChat: () => void;
}) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-gray-50 p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Studio</h2>

      <button
        onClick={() => onSelect("cours_oral")}
        className={`mb-3 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
          activeContentType === "cours_oral"
            ? "border-blue-200 bg-blue-50 text-blue-700"
            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-100"
        }`}
      >
        <Mic className="h-4 w-4 shrink-0" />
        <span className="flex-1">Cours Oral</span>
        {loadingContentType === "cours_oral" && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        )}
      </button>

      <div className="mb-2 h-px bg-gray-200" />

      <div className="flex flex-col gap-2">
        {STUDIO_CONTENT_TYPES.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
              activeContentType === id
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-100"
            }`}
          >
            <span className="flex-1">{label}</span>
            {loadingContentType === id && (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            )}
          </button>
        ))}
      </div>

      <button
        onClick={onOpenChat}
        className="mt-auto flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800"
      >
        <MessageCircle className="h-4 w-4" />
        Discuter avec MedArt
      </button>
    </aside>
  );
}
