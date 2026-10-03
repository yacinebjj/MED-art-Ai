"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Language of AI-GENERATED CONTENT (Studio tiles, MedArt Lab, flashcards) —
 * one global, persisted choice shared by every tool, instead of a per-popover
 * local state that silently fell back to French on a plain tile click.
 *
 * Deliberately separate from providers/LanguageProvider.tsx (the INTERFACE
 * language): a student can keep the app's UI in French while generating
 * course material in English for an exam abroad, or the reverse.
 *
 * Persisted in localStorage ("medart-ai-language"). `skipHydration` keeps the
 * server render and the first client render identical (both "fr"); the
 * stored value is applied right after mount by `useHydrateLanguageStore`,
 * mounted once in app/dashboard/layout.tsx — never during render, so no
 * hydration mismatch.
 */
export type ContentLanguage = "fr" | "en";

interface LanguageState {
  language: ContentLanguage;
  setLanguage: (language: ContentLanguage) => void;
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      language: "fr",
      setLanguage: (language) => set({ language: language === "en" ? "en" : "fr" }),
    }),
    {
      name: "medart-ai-language",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({ language: state.language }),
    }
  )
);

/** Applies the persisted choice once, after mount. Safe to call from several components — rehydrate is idempotent. */
export function useHydrateLanguageStore(): void {
  useEffect(() => {
    void useLanguageStore.persist.rehydrate();
  }, []);
}

/** Non-hook read for code that runs outside React render (event handlers, fetch helpers). */
export function getContentLanguage(): ContentLanguage {
  return useLanguageStore.getState().language;
}
