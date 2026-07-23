"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
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

    const next = searchParams.get("next") ?? "/dashboard";
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
        label="Mot de passe"
        name="password"
        type="password"
        placeholder="••••••••"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <div className="flex items-center justify-between text-sm">
        <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
          />
          Se souvenir de moi
        </label>
        <a href="#" className="font-medium text-primary-600 hover:underline dark:text-primary-400">
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
