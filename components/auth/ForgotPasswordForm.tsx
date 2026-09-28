"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Mail, MailCheck } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAuth } from "@/lib/translations/auth";

export function ForgotPasswordForm() {
  const { language } = useLanguage();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    // Routed through /auth/callback (not straight to /auth/update-password)
    // so the PKCE `code` this link carries is exchanged for a real session
    // cookie server-side first, exactly like the sign-up confirmation link —
    // see app/auth/callback/route.ts, which already forwards to whatever
    // `next` path is given after a successful exchange.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/auth/update-password")}`,
    });

    setIsLoading(false);

    // Never branch UI on whether resetError means "no such account" — Supabase
    // itself doesn't reveal that distinction to the client for this call, and
    // showing the same success state either way avoids leaking which emails
    // are registered (user enumeration).
    if (resetError) {
      setError(translateAuthError(resetError.message));
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="text-center"
      >
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.35, ease: "easeOut" }}
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400"
        >
          <MailCheck className="h-6 w-6" />
        </motion.div>
        <h2 className="text-lg font-semibold text-foreground">{tAuth("forgotPasswordSentTitle", language)}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{tAuth("forgotPasswordSentDescription", language)}</p>
        <Link
          href="/login"
          className="mt-6 inline-block text-sm font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
        >
          {tAuth("backToLogin", language)}
        </Link>
      </motion.div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="animate-in fade-in-0 slide-in-from-top-1 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive duration-200">
          {error}
        </div>
      )}

      <Input
        icon={<Mail className="h-4 w-4" />}
        label="Adresse e-mail"
        name="email"
        type="email"
        placeholder="prenom.nom@etu.univ-dz.org"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
        {tAuth("forgotPasswordSubmit", language)}
      </Button>

      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        <Link href="/login" className="font-medium text-primary-600 hover:underline dark:text-primary-400">
          {tAuth("backToLogin", language)}
        </Link>
      </p>
    </form>
  );
}
