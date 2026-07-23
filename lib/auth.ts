import type { User } from "@supabase/supabase-js";
import type { Specialty, StudentProfile } from "./types";

function isSpecialty(value: unknown): value is Specialty {
  return value === "medicine" || value === "dentistry" || value === "pharmacy";
}

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

/** Maps a Supabase Auth error message to a French, student-facing one. */
export function translateAuthError(message: string): string {
  const known: Record<string, string> = {
    "User already registered": "Un compte existe déjà avec cette adresse e-mail.",
    "Invalid login credentials": "E-mail ou mot de passe incorrect.",
    "Email not confirmed": "Confirme d'abord ton adresse e-mail (vérifie ta boîte de réception).",
    "Password should be at least 6 characters": "Le mot de passe doit contenir au moins 6 caractères.",
    "Unable to validate email address: invalid format": "Adresse e-mail invalide.",
    "Email rate limit exceeded": "Trop de tentatives — réessaie dans quelques minutes.",
  };

  return known[message] ?? message;
}
