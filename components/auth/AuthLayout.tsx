"use client";

import { useLanguage } from "@/providers/LanguageProvider";
import { tAuth } from "@/lib/translations/auth";
import { AuthShell, useInAuthShell } from "./AuthShell";

const TITLE_KEY_BY_VARIANT = {
  login: "loginTitle",
  register: "registerTitle",
  "forgot-password": "forgotPasswordTitle",
  "update-password": "updatePasswordTitle",
} as const;

const SUBTITLE_KEY_BY_VARIANT = {
  login: "loginSubtitle",
  register: "registerSubtitle",
  "forgot-password": "forgotPasswordSubtitle",
  "update-password": "updatePasswordSubtitle",
} as const;

/**
 * Title + subtitle + form for one auth page. Inside the persistent shell
 * (app/(auth)/layout.tsx) it renders only that content, so the shell's
 * background/card never remount between Connexion and Inscription. Outside
 * it (app/auth/update-password, reached from an e-mail link) it brings its
 * own shell. Same `variant` API as before — no page needed to change.
 */
export function AuthLayout({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: "login" | "register" | "forgot-password" | "update-password";
}) {
  const { language } = useLanguage();
  const inShell = useInAuthShell();

  const content = (
    <>
      <h1 className="bg-gradient-to-r from-white via-cyan-100 to-cyan-300 bg-clip-text text-2xl font-black tracking-tight text-transparent sm:text-[1.7rem]">
        {tAuth(TITLE_KEY_BY_VARIANT[variant], language)}
      </h1>
      <p className="mt-2 text-sm text-slate-400">{tAuth(SUBTITLE_KEY_BY_VARIANT[variant], language)}</p>
      <div className="mt-7">{children}</div>
    </>
  );

  return inShell ? content : <AuthShell>{content}</AuthShell>;
}
