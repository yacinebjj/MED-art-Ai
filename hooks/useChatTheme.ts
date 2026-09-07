"use client";

import { useEffect, useState } from "react";
import { DEFAULT_CHAT_THEME_ID, getChatTheme } from "@/lib/chat-themes";

const STORAGE_KEY = "medart_chat_theme";

/** Persists the chosen bubble theme to localStorage — a display preference, never synced server-side. */
export function useChatTheme() {
  const [themeId, setThemeId] = useState(DEFAULT_CHAT_THEME_ID);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setThemeId(saved);
  }, []);

  function selectTheme(id: string) {
    setThemeId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }

  return { theme: getChatTheme(themeId), themeId, selectTheme };
}
