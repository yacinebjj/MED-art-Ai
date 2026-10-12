"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Language = "fr" | "en";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("fr");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedLang = localStorage.getItem("medart-language") as Language;
    if (savedLang === "en" || savedLang === "fr") {
      setLanguageState(savedLang);
    }
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("medart-language", lang);
  };

  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
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