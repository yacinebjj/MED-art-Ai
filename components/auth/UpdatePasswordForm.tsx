"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAuth } from "@/lib/translations/auth";

/**
 * Turns whatever the recovery link brought into a session cookie, then
 * reports whether a user is signed in. Link shapes handled:
 *  - `#access_token=…&refresh_token=…` — implicit links sent by
 *    ForgotPasswordForm; work on any device. The app's PKCE client refuses
 *    to read these by itself ("Not a valid PKCE flow url"), so they are
 *    installed here with setSession().
 *  - `?token_hash=…&type=recovery` — if the Supabase email template is ever
 *    switched to the token-hash link.
 *  - older PKCE links: already exchanged by /auth/callback, or by the client
 *    itself on load when this browser holds the code verifier.
 *  - `error_code` (expired / already-used link): no session → the page
 *    offers a new link.
 */
async function establishRecoverySession(): Promise<boolean> {
  const supabase = createClient();
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);

  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  const tokenHash = query.get("token_hash");

  try {
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error) console.error("Password recovery: setSession failed", error);
    } else if (tokenHash) {
      const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
      if (error) console.error("Password recovery: verifyOtp failed", error);
    }
  } finally {
    // Never leave tokens in the address bar / history.
    if (window.location.hash || window.location.search) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  }

  const { data } = await supabase.auth.getUser();
  return Boolean(data.user);
}

/**
 * Rendered at /auth/update-password, arrived at via the recovery link's
 * redirect chain (ForgotPasswordForm -> Supabase email -> /auth/callback ->
 * here). `checkingSession` covers the render before establishRecoverySession
 * resolves; `hasSession === false` means an expired/already-used link or a
 * cold visit, and offers a fresh link.
 */
export function UpdatePasswordForm() {
  const router = useRouter();
  const { toast } = useToast();
  const { language } = useLanguage();
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    establishRecoverySession().then((ok) => {
      if (cancelled) return;
      setHasSession(ok);
      setCheckingSession(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setIsLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsLoading(false);

    if (updateError) {
      setError(translateAuthError(updateError.message));
      return;
    }

    toast({ variant: "success", title: tAuth("updatePasswordSuccess", language) });
    router.push("/dashboard");
    router.refresh();
  }

  if (checkingSession) {
    return null;
  }

  if (!hasSession) {
    return (
      <div className="text-center">
        <h2 className="text-lg font-semibold text-foreground">{tAuth("invalidRecoveryLinkTitle", language)}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{tAuth("invalidRecoveryLinkDescription", language)}</p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-block text-sm font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
        >
          {tAuth("forgotPasswordTitle", language)}
        </Link>
      </div>
    );
  }

  const hasPassword = password.length > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="animate-in fade-in-0 slide-in-from-top-1 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive duration-200">
          {error}
        </div>
      )}

      <div className="relative">
        <Input
          icon={<Lock className="h-4 w-4" />}
          label={tAuth("newPasswordLabel", language)}
          name="password"
          type={showPassword ? "text" : "password"}
          placeholder="8 caractères minimum"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="pr-10"
        />

        {hasPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            className="absolute bottom-0 right-3 h-11 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>

      <Input
        icon={<Lock className="h-4 w-4" />}
        label={tAuth("confirmPasswordLabel", language)}
        name="confirmPassword"
        type={showPassword ? "text" : "password"}
        placeholder="8 caractères minimum"
        required
        minLength={8}
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />

      <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
        {tAuth("updatePasswordSubmit", language)}
      </Button>
    </form>
  );
}
