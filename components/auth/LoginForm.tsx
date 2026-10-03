"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useAnimationControls } from "framer-motion";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { useToast } from "@/components/ui/Toast";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAuth } from "@/lib/translations/auth";
import { AuthField } from "./AuthField";
import { AuthSubmitButton } from "./AuthSubmitButton";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { language } = useLanguage();
  const { toast } = useToast();
  const shake = useAnimationControls();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setIsLoading(false);

    if (signInError) {
      toast({ variant: "error", title: language === "fr" ? "Connexion impossible" : "Couldn't sign in", description: translateAuthError(signInError.message) });
      void shake.start({ x: [0, -10, 10, -6, 6, 0], transition: { duration: 0.4 } });
      return;
    }

    // SECURITY: sanitizeRedirectPath forces this to a same-origin relative
    // path — a raw `next` here was a real, confirmed open redirect
    // (router.push on a cross-origin URL performs a genuine hard
    // location.assign in Next's App Router, no trick required beyond a
    // crafted `?next=https://evil.com` link).
    const next = sanitizeRedirectPath(searchParams.get("next"));
    router.push(next);
    router.refresh();
  }

  // Derived from `password` — always in sync, no extra state needed.
  const hasPassword = password.length > 0;

  return (
    <motion.form onSubmit={handleSubmit} animate={shake} className="space-y-4">
      <AuthField
        label="Adresse e-mail"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        icon={<Mail className="h-4 w-4" />}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <AuthField
        label={tAuth("passwordLabel", language)}
        name="password"
        type={showPassword ? "text" : "password"}
        autoComplete="current-password"
        required
        icon={<Lock className="h-4 w-4" />}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        trailing={
          hasPassword ? (
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          ) : null
        }
      />

      <div className="flex items-center justify-between gap-3 pt-1 text-sm">
        <label className="flex cursor-pointer select-none items-center gap-2.5 text-slate-300">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="peer sr-only" />
          <span className="flex h-5 w-5 items-center justify-center rounded-md border border-white/20 bg-slate-900 transition-colors peer-checked:border-cyan-400 peer-checked:bg-cyan-400 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-400/50">
            <svg viewBox="0 0 12 10" className={remember ? "h-3 w-3 text-slate-950" : "hidden"} aria-hidden>
              <path d="M1 5l3.5 3.5L11 1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          Se souvenir de moi
        </label>
        <Link href="/forgot-password" className="font-semibold text-cyan-300 transition-colors hover:text-cyan-200 hover:underline">
          Mot de passe oublié ?
        </Link>
      </div>

      <div className="pt-2">
        <AuthSubmitButton isLoading={isLoading} loadingLabel={language === "fr" ? "Connexion en cours…" : "Signing in…"}>
          Se connecter
        </AuthSubmitButton>
      </div>

      <p className="pt-2 text-center text-sm text-slate-400">
        Pas encore de compte ?{" "}
        <Link href="/register" className="font-semibold text-cyan-300 hover:underline">
          Inscris-toi
        </Link>
      </p>
    </motion.form>
  );
}
