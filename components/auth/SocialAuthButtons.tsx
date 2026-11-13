"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { OAUTH_PROVIDERS, fetchEnabledOAuthProviders, type OAuthProviderId } from "@/lib/oauth-providers";
import { useToast } from "@/components/ui/Toast";
import { useLanguage } from "@/providers/LanguageProvider";
import { cn } from "@/lib/utils";
import { useShellOAuthProviders } from "./AuthShell";

/** Google's own "G" (Sign-In branding guidelines). */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className={className}>
      <path fill="#4285F4" d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.4673-.8059 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.8591-3.0477.8591-2.3441 0-4.3282-1.5832-5.0359-3.7105H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z" />
      <path fill="#FBBC05" d="M3.9641 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.9641 10.71z" />
      <path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z" />
    </svg>
  );
}

/** The Apple mark (Simple Icons, CC0). */
function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
      />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block h-[18px] w-[18px] animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

const LABELS: Record<OAuthProviderId, { fr: string; en: string; name: string }> = {
  google: { fr: "Continuer avec Google", en: "Continue with Google", name: "Google" },
  apple: { fr: "Continuer avec Apple", en: "Continue with Apple", name: "Apple" },
};

/**
 * One-tap sign-in with Google or Apple, above the e-mail form of /login and
 * /register (Supabase OAuth, PKCE): the provider sends the student back to
 * /auth/callback, which opens the session exactly as an e-mail confirmation
 * does — a new account gets its profile and Freemium plan from the
 * handle_new_user trigger and its welcome e-mail from the callback. A
 * `?next=` (an invite link) is carried through, sanitized.
 *
 * Each button shows only once its provider is enabled in Supabase — read by
 * the server for the auth shell, so they are in the first paint
 * (lib/oauth-providers.ts). `?sso=preview` shows both for review and asks
 * Supabase live, so a provider switched on a minute ago can be tried at once.
 */
export function SocialAuthButtons({ mode }: { mode: "login" | "register" }) {
  const { language } = useLanguage();
  const { toast } = useToast();
  const fr = language === "fr";
  const fromShell = useShellOAuthProviders();
  const [enabled, setEnabled] = useState<readonly OAuthProviderId[]>(fromShell ?? []);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<OAuthProviderId | null>(null);

  useEffect(() => {
    const isPreview = new URLSearchParams(window.location.search).get("sso") === "preview";
    setPreview(isPreview);
    // The shell's list is the server's (at most 5 minutes old): students never wait on a second check.
    if (fromShell && !isPreview) return;
    let cancelled = false;
    void fetchEnabledOAuthProviders({ fresh: isPreview }).then((live) => {
      // A failed check (null) changes nothing.
      if (!cancelled && live) setEnabled(live);
    });
    return () => {
      cancelled = true;
    };
  }, [fromShell]);

  // Back from the provider (the browser's back button restores this page from its cache): no spinner left turning.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(null);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const shown = preview ? [...OAUTH_PROVIDERS] : enabled;
  if (shown.length === 0) return null;

  async function continueWith(provider: OAuthProviderId) {
    if (busy) return;
    if (!enabled.includes(provider)) {
      // Preview only: the provider isn't switched on in Supabase yet.
      toast({
        variant: "info",
        title: fr ? `${LABELS[provider].name} n'est pas encore activé` : `${LABELS[provider].name} isn't enabled yet`,
        description: fr ? "Active ce fournisseur dans Supabase → Authentication → Providers." : "Enable this provider in Supabase → Authentication → Providers.",
      });
      return;
    }
    setBusy(provider);
    const next = sanitizeRedirectPath(new URLSearchParams(window.location.search).get("next"));
    const { error } = await createClient().auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        // Google: always let the student pick the account (a shared or family computer).
        ...(provider === "google" ? { queryParams: { prompt: "select_account" } } : {}),
      },
    });
    if (error) {
      setBusy(null);
      toast({
        variant: "error",
        title: fr ? "Connexion impossible" : "Couldn't sign in",
        description: fr ? `${LABELS[provider].name} n'a pas pu être joint — réessaie, ou utilise ton e-mail.` : `${LABELS[provider].name} couldn't be reached — try again, or use your e-mail.`,
      });
    }
    // Otherwise the browser is on its way to the provider: the spinner stays until it leaves.
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-2.5" role="group" aria-label={fr ? (mode === "register" ? "S'inscrire avec" : "Se connecter avec") : mode === "register" ? "Sign up with" : "Sign in with"}>
        {shown.includes("google") && (
          <button
            type="button"
            onClick={() => void continueWith("google")}
            disabled={busy !== null}
            aria-busy={busy === "google"}
            className="relative flex h-12 w-full items-center justify-center gap-3 rounded-2xl bg-white px-4 text-[15px] font-semibold text-slate-900 shadow-[0_1px_2px_rgba(0,0,0,0.35),inset_0_0_0_1px_rgba(15,23,42,0.08)] transition-[background-color,transform,opacity] duration-150 hover:bg-slate-100 active:scale-[0.98] disabled:cursor-default disabled:opacity-70 disabled:active:scale-100"
          >
            {busy === "google" ? <Spinner className="text-slate-500" /> : <GoogleMark className="h-[18px] w-[18px]" />}
            <span>{fr ? LABELS.google.fr : LABELS.google.en}</span>
          </button>
        )}
        {shown.includes("apple") && (
          <button
            type="button"
            onClick={() => void continueWith("apple")}
            disabled={busy !== null}
            aria-busy={busy === "apple"}
            className="relative flex h-12 w-full items-center justify-center gap-3 rounded-2xl bg-black px-4 text-[15px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.16)] transition-[background-color,transform,opacity] duration-150 hover:bg-neutral-900 active:scale-[0.98] disabled:cursor-default disabled:opacity-70 disabled:active:scale-100"
          >
            {busy === "apple" ? <Spinner className="text-white/70" /> : <AppleMark className="h-[19px] w-[19px] -translate-y-px" />}
            <span>{fr ? LABELS.apple.fr : LABELS.apple.en}</span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/15" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{fr ? "ou avec ton e-mail" : "or with your e-mail"}</span>
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/15" />
      </div>
    </div>
  );
}
