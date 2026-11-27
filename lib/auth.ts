import type { User } from "@supabase/supabase-js";
import type { Specialty, StudentProfile } from "./types";

function isSpecialty(value: unknown): value is Specialty {
  return value === "medicine" || value === "dentistry" || value === "pharmacy";
}

/**
 * The `action` of every auth form (all method="post"): where the browser posts
 * it when it submits the form itself — before React took a slow phone's page
 * over, or with no JavaScript. Vercel answers a POST to the pre-rendered auth
 * pages with 405; app/api/auth/form-post sends a 303 back to the page instead.
 */
export const AUTH_FORM_POST = "/api/auth/form-post";

/** Student profile fields live in Supabase Auth's user_metadata (set at sign-up). */
export function profileFromUser(user: User): StudentProfile {
  const meta = user.user_metadata ?? {};
  return {
    fullName: typeof meta.full_name === "string" ? meta.full_name : "",
    email: user.email ?? "",
    university: typeof meta.university === "string" ? meta.university : "",
    specialty: isSpecialty(meta.specialty) ? meta.specialty : "medicine",
    academicYear: typeof meta.academic_year === "string" ? meta.academic_year : "",
  };
}

/**
 * Maps a Supabase Auth error message to a French, student-facing one.
 *
 * By pattern, not exact text: Supabase's wording varies between versions and
 * endpoints ("Email rate limit exceeded" / "email rate limit exceeded", "For
 * security purposes, you can only request this after 47 seconds."), and a
 * network failure surfaces as the browser's own message ("Failed to fetch",
 * Safari's "Load failed", Firefox's "NetworkError…"). Those used to reach
 * students raw, in English.
 */
const AUTH_ERRORS: ReadonlyArray<[RegExp, string | ((m: RegExpMatchArray) => string)]> = [
  [/user already registered|already been registered|already exists/i, "Un compte existe déjà avec cette adresse e-mail : connecte-toi, ou utilise « Mot de passe oublié ? »."],
  [/invalid login credentials|invalid credentials/i, "E-mail ou mot de passe incorrect."],
  [/email not confirmed/i, "Confirme d'abord ton adresse e-mail (vérifie ta boîte de réception et tes spams)."],
  [/password should be at least (\d+)/i, (m) => `Le mot de passe doit contenir au moins ${m[1]} caractères.`],
  [/password should contain/i, "Le mot de passe doit mélanger lettres minuscules, majuscules et chiffres."],
  [/weak|easy to guess|pwned|leaked|compromised/i, "Ce mot de passe est trop courant (il apparaît dans des fuites de données) : choisis-en un autre."],
  [/should be different from the old password/i, "Le nouveau mot de passe doit être différent de l'ancien."],
  [/unable to validate email|invalid format|invalid email|email address .* is invalid/i, "Adresse e-mail invalide."],
  [/request this after (\d+) seconds?/i, (m) => `Par sécurité, patiente ${m[1]} secondes avant de réessayer.`],
  [/rate limit|too many requests|over_request_rate_limit|over_email_send_rate_limit/i, "Trop de tentatives depuis ce réseau — patiente quelques minutes puis réessaie (ou passe en 4G)."],
  [/failed to fetch|load failed|networkerror|network request failed|fetch failed|network error/i, "Connexion au serveur impossible — vérifie ta connexion Internet puis réessaie."],
  [/signups? not allowed|signup.*disabled/i, "Les inscriptions sont momentanément fermées. Réessaie un peu plus tard."],
  [/database error saving new user|unexpected_failure/i, "Le compte n'a pas pu être créé (erreur du serveur). Réessaie dans un instant."],
  [/link is invalid or has expired|otp.*expired|token has expired|token is expired/i, "Ce lien a expiré ou a déjà servi : demandes-en un nouveau."],
  [/same_password|same password/i, "Le nouveau mot de passe doit être différent de l'ancien."],
  [/captcha/i, "La vérification anti-robot a échoué — réessaie."],
  [/session.*missing|auth session missing|session_not_found/i, "Ta session a expiré : reconnecte-toi."],
  [/missing email or phone|missing email|email (?:address )?(?:is )?required/i, "Adresse e-mail manquante : saisis ton adresse e-mail, puis réessaie."],
  [/missing password|password (?:is )?required|signup requires a valid password/i, "Mot de passe manquant : saisis ton mot de passe, puis réessaie."],
  [/timed? ?out|timeout/i, "Connexion lente, réessaie."],
];

export function translateAuthError(message: string): string {
  for (const [pattern, text] of AUTH_ERRORS) {
    const match = message.match(pattern);
    if (match) return typeof text === "string" ? text : text(match);
  }
  return message;
}
