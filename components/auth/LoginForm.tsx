"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useAnimationControls } from "framer-motion";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth";
import {
  AUTH_SLOW,
  AuthTimeoutError,
  COOKIES_BLOCKED,
  formChecked,
  formText,
  rememberSession,
  resendConfirmationEmail,
  sessionWasStored,
  withAuthTimeout,
} from "@/lib/auth-client";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { useToast } from "@/components/ui/Toast";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAuth } from "@/lib/translations/auth";
import { AuthField } from "./AuthField";
import { AuthSubmitButton } from "./AuthSubmitButton";
import { EarlySubmitGuard, EarlySubmitStatus, claimEarlySubmit, dropHeldSubmit } from "./EarlySubmitGuard";
import { SocialAuthButtons } from "./SocialAuthButtons";

const SHAKE = { x: [0, -10, 10, -6, 6, 0], transition: { duration: 0.4 } };

/**
 * The query is read from window.location, never useSearchParams(): that hook
 * made Next render this whole form on the client only (the page's HTML had
 * an empty card until the JavaScript ran — a blank second on a slow phone).
 * The form is now in the HTML; `next` is only needed on submit and for the
 * sign-up link, which picks it up right after mount.
 *
 * Because the form is in the HTML, a slow phone shows it seconds before React
 * runs. Hence: method="post" + EarlySubmitGuard (a tap in that gap is held,
 * then sent — never a GET with the password in the URL), the values read from
 * the fields themselves (early typing and autofill never reached React's
 * state), and a 20 s ceiling on the request (AUTH_TIMEOUT_MS).
 */
export function LoginForm() {
  const router = useRouter();
  const { language } = useLanguage();
  const { toast } = useToast();
  const shake = useAnimationControls();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [registerHref, setRegisterHref] = useState("/register");
  const checkedQuery = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);

  // The moment React takes the server-rendered form over. On a slow phone the
  // student may have typed (or the browser autofilled) for seconds already:
  // adopt what the fields hold — React's state never saw it — then send the
  // tap EarlySubmitGuard held in the meantime, if there was one.
  useEffect(() => {
    const formEl = formRef.current;
    if (!formEl) return;
    const typedEmail = formText(formEl, "email");
    const typedPassword = formText(formEl, "password");
    if (typedEmail) setEmail(typedEmail);
    if (typedPassword) setPassword(typedPassword);
    setRemember(formChecked(formEl, "remember", true));
    if (claimEarlySubmit(formEl)) void signIn(formEl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once: the hand-over from the server HTML to React
  }, []);

  useEffect(() => {
    if (checkedQuery.current) return;
    checkedQuery.current = true;
    const params = new URLSearchParams(window.location.search);
    // An invite link (?next=/dashboard/billing/pool/<code>) survives the switch to sign-up.
    if (params.get("next")) setRegisterHref(`/register?next=${encodeURIComponent(sanitizeRedirectPath(params.get("next")))}`);
    // /auth/callback sends a failed or cancelled Google/Apple sign-in (or an expired e-mail link) back here.
    // Cookies switched off: say so before the student types anything (signing in can't hold).
    if (typeof navigator !== "undefined" && navigator.cookieEnabled === false) {
      const text = COOKIES_BLOCKED[language === "fr" ? "fr" : "en"];
      toast({ variant: "warning", title: text.title, description: text.description });
    }
    if (params.get("error") === "auth") {
      const fr = language === "fr";
      const reason = params.get("reason");
      if (reason === "other_browser") {
        // The confirmation link was opened in another browser/device: the address IS confirmed.
        toast({
          variant: "success",
          title: fr ? "E-mail confirmé" : "E-mail confirmed",
          description: fr
            ? "Le lien s'est ouvert dans un autre navigateur que celui de ton inscription : connecte-toi simplement ici avec ton e-mail et ton mot de passe."
            : "The link opened in a different browser from the one you signed up in: just sign in here with your e-mail and password.",
        });
      } else if (reason === "link_expired") {
        toast({
          variant: "info",
          title: fr ? "Lien expiré ou déjà utilisé" : "Link expired or already used",
          description: fr
            ? "Ton e-mail est sans doute déjà confirmé : connecte-toi avec ton e-mail et ton mot de passe."
            : "Your e-mail is most likely confirmed already: sign in with your e-mail and password.",
        });
      } else {
        toast({
          variant: "error",
          title: fr ? "Connexion non aboutie" : "Sign-in didn't go through",
          description: fr ? "Réessaie, ou connecte-toi avec ton e-mail et ton mot de passe." : "Try again, or sign in with your e-mail and password.",
        });
      }
      // Off the address bar, so a refresh doesn't say it again.
      params.delete("error");
      params.delete("reason");
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }, [language, toast]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    dropHeldSubmit(e.currentTarget);
    void signIn(e.currentTarget);
  }

  /** The card's error shake. A late answer (the 20 s ceiling) can come after the student left the page: framer then refuses to animate (it throws), and there is nothing to shake anyway. */
  function shakeCard() {
    try {
      void shake.start(SHAKE);
    } catch {
      // Unmounted.
    }
  }

  async function signIn(formEl: HTMLFormElement) {
    if (submitting.current) return;
    const fr = language === "fr";
    // From the fields, not from React's state: autofill and early typing live there.
    const emailValue = formText(formEl, "email").trim();
    const passwordValue = formText(formEl, "password");
    const keepSession = formChecked(formEl, "remember", remember);
    if (!emailValue || !passwordValue) {
      toast({
        variant: "error",
        title: fr ? "Connexion impossible" : "Couldn't sign in",
        description: translateAuthError(emailValue ? "missing password" : "missing email or phone"),
      });
      shakeCard();
      return;
    }

    submitting.current = true;
    setIsLoading(true);
    try {
      let signInError: { message: string } | null = null;
      try {
        ({ error: signInError } = await withAuthTimeout(createClient().auth.signInWithPassword({ email: emailValue, password: passwordValue })));
      } catch (error) {
        // No answer within AUTH_TIMEOUT_MS, or the client itself threw: the button comes back either way.
        setIsLoading(false);
        if (error instanceof AuthTimeoutError) {
          const text = AUTH_SLOW[fr ? "fr" : "en"];
          toast({ variant: "warning", title: text.title, description: text.description });
        } else {
          toast({
            variant: "error",
            title: fr ? "Connexion impossible" : "Couldn't sign in",
            description: translateAuthError(error instanceof Error ? error.message : "Failed to fetch"),
          });
        }
        shakeCard();
        return;
      }
      await finishSignIn(signInError, emailValue, keepSession, fr);
    } finally {
      submitting.current = false;
    }
  }

  async function finishSignIn(signInError: { message: string } | null, emailValue: string, keepSession: boolean, fr: boolean) {
    if (signInError) {
      setIsLoading(false);
      if (/email not confirmed/i.test(signInError.message)) {
        // The confirmation e-mail was lost or filed as spam: one tap sends it again.
        const target = emailValue;
        toast({
          variant: "warning",
          title: fr ? "Adresse e-mail pas encore confirmée" : "E-mail not confirmed yet",
          description: fr
            ? "Clique sur le lien reçu à l'inscription (regarde aussi dans les spams et « Promotions »). Pas reçu ? Renvoie-le."
            : "Click the link we sent when you signed up (check spam too). Didn't get it? Send it again.",
          action: {
            label: fr ? "Renvoyer l'e-mail" : "Resend e-mail",
            onClick: () => {
              void resendConfirmationEmail(target, sanitizeRedirectPath(new URLSearchParams(window.location.search).get("next"))).then((error) =>
                toast(
                  error
                    ? { variant: "error", title: fr ? "Envoi impossible" : "Couldn't send", description: error }
                    : {
                        variant: "success",
                        title: fr ? "E-mail renvoyé" : "E-mail sent",
                        description: fr ? `Vérifie ${target} (et les spams), puis clique sur le lien.` : `Check ${target} (and spam), then click the link.`,
                      }
                )
              );
            },
          },
        });
      } else {
        toast({ variant: "error", title: fr ? "Connexion impossible" : "Couldn't sign in", description: translateAuthError(signInError.message) });
      }
      shakeCard();
      return;
    }

    // Signed in, but cookies blocked: the dashboard would bounce straight back here. Say why instead.
    if (!(await sessionWasStored())) {
      setIsLoading(false);
      const text = COOKIES_BLOCKED[fr ? "fr" : "en"];
      toast({ variant: "error", title: text.title, description: text.description });
      return;
    }
    // "Se souvenir de moi" unticked (a shared computer): the session ends when the browser closes.
    await rememberSession(keepSession);
    setIsLoading(false);

    // SECURITY: sanitizeRedirectPath forces this to a same-origin relative
    // path — a raw `next` here was a real, confirmed open redirect
    // (router.push on a cross-origin URL performs a genuine hard
    // location.assign in Next's App Router, no trick required beyond a
    // crafted `?next=https://evil.com` link).
    const next = sanitizeRedirectPath(new URLSearchParams(window.location.search).get("next"));
    router.push(next);
    router.refresh();
  }

  // Derived from `password` — always in sync, no extra state needed.
  const hasPassword = password.length > 0;

  return (
    <motion.form ref={formRef} method="post" onSubmit={handleSubmit} animate={shake} className="group/auth space-y-4">
      <SocialAuthButtons mode="login" />

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
          <input type="checkbox" name="remember" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="peer sr-only" />
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
        {/* A tap held by EarlySubmitGuard: the button pulses until React sends it. */}
        <div className="group-data-[early]/auth:pointer-events-none group-data-[early]/auth:animate-pulse">
          <AuthSubmitButton isLoading={isLoading} loadingLabel={language === "fr" ? "Connexion en cours…" : "Signing in…"}>
            Se connecter
          </AuthSubmitButton>
        </div>
        <EarlySubmitStatus
          busyLabel={language === "fr" ? "Connexion en cours…" : "Signing in…"}
          slowLabel={language === "fr" ? "Connexion lente, réessaie." : "Slow connection, try again."}
        />
      </div>

      <p className="pt-2 text-center text-sm text-slate-400">
        Pas encore de compte ?{" "}
        <Link href={registerHref} className="font-semibold text-cyan-300 hover:underline">
          Inscris-toi
        </Link>
      </p>
      {/* Last child on purpose: the guard finds the form as its parent. */}
      <EarlySubmitGuard />
    </motion.form>
  );
}
