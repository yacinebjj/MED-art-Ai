"use client";

import { useLanguage } from "@/providers/LanguageProvider";

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex items-center gap-1 rounded-full border border-border/60 bg-background/80 p-1 backdrop-blur-md shadow-sm">
      <button
        onClick={() => setLanguage("fr")}
        className={`px-3 py-1 rounded-full text-xs font-bold transition-all duration-200 ${
          language === "fr"
            ? "bg-primary-600 text-white shadow-md shadow-primary-500/20"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        FR 🇫🇷
      </button>
      <button
        onClick={() => setLanguage("en")}
        className={`px-3 py-1 rounded-full text-xs font-bold transition-all duration-200 ${
          language === "en"
            ? "bg-primary-600 text-white shadow-md shadow-primary-500/20"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        EN 🇬🇧
      </button>
    </div>
  );
}