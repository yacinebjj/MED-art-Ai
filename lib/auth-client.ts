import { createClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth";

/**
 * True when the browser really kept the session it was just given.
 *
 * The session lives in cookies. With cookies blocked (Safari "Block all
 * cookies", strict privacy settings, some in-app browsers) the sign-in itself
 * succeeds, nothing is stored, and the dashboard sends the student straight
 * back to /login — a silent loop. Checked right after signing in, so the
 * student is told why instead.
 */
export async function sessionWasStored(): Promise<boolean> {
  try {
    const { data } = await createClient().auth.getSession();
    return Boolean(data.session);
  } catch {
    return false;
  }
}

/**
 * Slow networks: a sign-in or sign-up call still unanswered after this long is
 * reported as slow and the button comes back, instead of spinning until the
 * student reloads. The request itself may still land afterwards (a session
 * quietly stored, an account created): a second tap then simply finds it.
 */
export const AUTH_TIMEOUT_MS = 20_000;

export class AuthTimeoutError extends Error {
  constructor() {
    super("Auth request timed out");
    this.name = "AuthTimeoutError";
  }
}

/** Settles like `promise`, or rejects with an AuthTimeoutError once `ms` have passed. */
export function withAuthTimeout<T>(promise: Promise<T>, ms: number = AUTH_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AuthTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export const AUTH_SLOW = {
  fr: {
    title: "Connexion lente, réessaie",
    description: "Le serveur n'a pas répondu à temps. Vérifie ton réseau, puis appuie de nouveau sur le bouton.",
  },
  en: {
    title: "Slow connection, try again",
    description: "The server didn't answer in time. Check your network, then tap the button again.",
  },
} as const;

/**
 * A field's value read from the form itself. The browser's value is the truth:
 * autofill, or typing before React took the page over on a slow phone, never
 * reached React's state.
 */
export function formText(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement ? field.value : "";
}

/** A checkbox's state read from the form itself (`fallback` when the form has no such box). */
export function formChecked(form: HTMLFormElement, name: string, fallback: boolean): boolean {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement ? field.checked : fallback;
}

export const COOKIES_BLOCKED = {
  fr: {
    title: "Cookies bloqués",
    description:
      "Ton navigateur bloque les cookies de medartai.com : la connexion ne peut pas tenir. Autorise les cookies pour ce site, ou ouvre MedArt AI dans Chrome ou Safari.",
  },
  en: {
    title: "Cookies are blocked",
    description: "Your browser blocks medartai.com's cookies, so you can't stay signed in. Allow cookies for this site, or open MedArt AI in Chrome or Safari.",
  },
} as const;

/**
 * Sends the sign-up confirmation e-mail again (the first one was lost, filed
 * as spam, or expired). Same PKCE link as at sign-up: it opens straight into
 * /auth/callback. Returns a student-facing error, or null when sent.
 */
export async function resendConfirmationEmail(email: string, next: string): Promise<string | null> {
  try {
    const { error } = await createClient().auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    return error ? translateAuthError(error.message) : null;
  } catch (error) {
    return translateAuthError(error instanceof Error ? error.message : "Failed to fetch");
  }
}

/**
 * "Se souvenir de moi" unticked — a shared computer (university library,
 * cyber café): the session must end when the browser closes. The checkbox
 * used to do nothing, so the next person at that computer found the account
 * open, and it kept one of the student's device slots.
 *
 * The session's own id (the `session_id` claim of its access token) is kept
 * on the device, next to a cookie without expiry that the browser deletes
 * when it closes. When the app starts again with that same session but
 * without the cookie, the browser was closed: the session is ended. Any
 * other sign-in (ticked box, Google, an e-mail link) has another session id,
 * so it is never touched.
 */
const EPHEMERAL_KEY = "medart:ephemeral-session";
const ALIVE_COOKIE = "medart_alive";

function sessionIdOf(accessToken: string | undefined): string | null {
  try {
    const part = (accessToken ?? "").split(".")[1] ?? "";
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { session_id?: unknown };
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

/** Right after a successful e-mail sign-in, with the state of the "Se souvenir de moi" box. */
export async function rememberSession(remember: boolean): Promise<void> {
  document.cookie = `${ALIVE_COOKIE}=1; path=/; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
  try {
    if (remember) {
      localStorage.removeItem(EPHEMERAL_KEY);
      return;
    }
    const { data } = await createClient().auth.getSession();
    const id = sessionIdOf(data.session?.access_token);
    if (id) localStorage.setItem(EPHEMERAL_KEY, id);
  } catch {
    // Storage unavailable: the session simply stays, as before.
  }
}

/** True when this is a "don't remember me" session and the browser has been closed since. */
export function ephemeralSessionEnded(accessToken: string | undefined): boolean {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(EPHEMERAL_KEY);
  } catch {
    return false;
  }
  if (!stored) return false;
  if (sessionIdOf(accessToken) !== stored) {
    forgetEphemeralSession(); // signed in again since: that one is remembered
    return false;
  }
  return !document.cookie.split(";").some((c) => c.trim().startsWith(`${ALIVE_COOKIE}=`));
}

export function forgetEphemeralSession(): void {
  try {
    localStorage.removeItem(EPHEMERAL_KEY);
  } catch {
    // Storage unavailable.
  }
}
