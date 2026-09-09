"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAuth } from "@/lib/translations/auth";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { language } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setIsLoading(false);

    if (signInError) {
      setError(translateAuthError(signInError.message));
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

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="animate-in fade-in-0 slide-in-from-top-1 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive duration-200">
          {error}
        </div>
      )}

      <Input
        label="Adresse e-mail"
        name="email"
        type="email"
        placeholder="prenom.nom@etu.univ-dz.org"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <Input
        label={tAuth("passwordLabel", language)}
        name="password"
        type="password"
        placeholder="••••••••"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <div className="flex items-center justify-between text-sm">
        <label className="flex cursor-pointer items-center gap-2 text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer rounded border-slate-300 text-primary-600 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-800"
          />
          Se souvenir de moi
        </label>
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          className="font-medium text-primary-600 transition-colors hover:text-primary-700 hover:underline dark:text-primary-400 dark:hover:text-primary-300"
        >
          Mot de passe oublié ?
        </a>
      </div>

      <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
        Se connecter
      </Button>

      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        Pas encore de compte ?{" "}
        <Link href="/register" className="font-medium text-primary-600 hover:underline dark:text-primary-400">
          Inscris-toi
        </Link>
      </p>
    </form>
  );
}
