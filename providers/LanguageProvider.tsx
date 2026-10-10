"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";

export type Language = "fr" | "en";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // "fr" on the server and on the first client render (no hydration
  // mismatch); the saved choice is applied right after mount.
  const [language, setLanguageState] = useState<Language>("fr");

  useEffect(() => {
    const savedLang = localStorage.getItem("medart-language") as Language;
    if (savedLang === "en" || savedLang === "fr") {
      setLanguageState(savedLang);
    }
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("medart-language", lang);
  }, []);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);

  // Always the Provider, from the very first render. This used to return a
  // bare fragment until mounted, then switch to the Provider: a different
  // element type at the same spot, so React threw away and rebuilt the WHOLE
  // app (every provider, layout and page under it, with all their effects
  // and startup fetches) right after hydration, on every launch.
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  
  // الحماية الآمنة: إذا لم يتواجد الـ Provider، يرجع قيم افتراضية بدل تفجير شاشة الهاتف بالخطأ الأحمر
  if (context === undefined) {
    return {
      language: "fr" as Language,
      setLanguage: () => {},
    };
  }
  
  return context;
}