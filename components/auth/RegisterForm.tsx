"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MailCheck } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ALGERIAN_FACULTIES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth";
import { isLockedInternYear, INTERN_YEAR_LOCKED_MESSAGE } from "@/lib/academic-year-locks";
import type { AcademicYear, Specialty } from "@/types/academic";

const FACULTY_OPTIONS = ALGERIAN_FACULTIES.map((name) => ({ value: name, label: name }));

/**
 * Maps a curriculum_specialties.name (the real, DB-backed row picked below)
 * to the narrow enum StudentProfile.specialty still expects in
 * auth.user_metadata (see lib/auth.ts) — kept in sync with the exact 3 rows
 * seeded in supabase/schema.sql. Only used for that legacy metadata field;
 * the real linkage that drives the Dashboard's "Mon Programme" is
 * specialtyId/academicYearId, PATCHed straight to `profiles` below.
 */
const SPECIALTY_NAME_TO_ENUM: Record<string, "medicine" | "dentistry" | "pharmacy"> = {
  Médecine: "medicine",
  Pharmacie: "pharmacy",
  Dentaire: "dentistry",
};

interface FormState {
  fullName: string;
  email: string;
  password: string;
  university: string;
}

const INITIAL_STATE: FormState = {
  fullName: "",
  email: "",
  password: "",
  university: "",
};

/**
 * Spécialité + Année are sourced live from Supabase (curriculum_specialties /
 * curriculum_academic_years), exactly like the Settings page's own picker —
 * and PATCHed to profiles.specialty_id/academic_year_id the moment sign-up
 * succeeds, not left for the student to set later. Before this, registration
 * only ever wrote a specialty/année STRING into auth.user_metadata, which
 * `/api/profile` (and therefore the Dashboard's "Mon Programme" section)
 * never reads — a brand-new student always landed on "Choisis ta spécialité
 * dans les Paramètres" with no indication anything was actually missing,
 * since they'd just filled in a specialty/année field one screen earlier.
 */
export function RegisterForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [specialtyId, setSpecialtyId] = useState<number | null>(null);
  const [academicYearId, setAcademicYearId] = useState<number | null>(null);
  const [yearsLoading, setYearsLoading] = useState(false);

  useEffect(() => {
    fetch("/api/curriculum/specialties")
      .then((res) => res.json())
      .then((data) => setSpecialties(data.specialties ?? []))
      .catch(() => setSpecialties([]));
  }, []);

  useEffect(() => {
    if (specialtyId == null) {
      setYears([]);
      return;
    }
    let cancelled = false;
    setYearsLoading(true);
    setAcademicYearId(null);

    fetch(`/api/curriculum/years?specialtyId=${specialtyId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setYears(data.years ?? []);
      })
      .catch(() => {
        if (!cancelled) setYears([]);
      })
      .finally(() => {
        if (!cancelled) setYearsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [specialtyId]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }

  function handleSpecialtyChange(value: string) {
    setSpecialtyId(Number(value));
    setError(null);
  }

  function handleYearChange(value: string) {
    setAcademicYearId(Number(value));
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (specialtyId == null || academicYearId == null) {
      setError("Choisis ta spécialité et ton année.");
      return;
    }

    setIsLoading(true);
    setError(null);

    const specialtyName = specialties.find((s) => s.id === specialtyId)?.name ?? "";
    const yearName = years.find((y) => y.id === academicYearId)?.name ?? "";

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name: form.fullName,
          university: form.university,
          specialty: SPECIALTY_NAME_TO_ENUM[specialtyName] ?? "medicine",
          academic_year: yearName,
        },
      },
    });

    if (signUpError) {
      setIsLoading(false);
      setError(translateAuthError(signUpError.message));
      return;
    }

    if (data.session) {
      // Real curriculum linkage — this is what makes "Mon Programme" render
      // on the very first Dashboard load, with zero extra trip to Settings.
      // Awaited before navigating (not fire-and-forget, not refreshed via
      // AuthProvider — this page renders outside its tree, under
      // app/(auth)/, so there's no useAuth() to call here): the fresh
      // AuthProvider instance that mounts under app/dashboard/layout.tsx
      // right after navigation runs its own bootstrap fetch of
      // GET /api/profile, which only sees this row if the PATCH below has
      // already landed by then.
      await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specialtyId, academicYearId }),
      });
      setIsLoading(false);
      router.push("/dashboard");
      router.refresh();
    } else {
      // Confirmation email sent — no session until they click the link, so
      // there's no authenticated PATCH /api/profile to make yet. They'll
      // land on the same "Choisis ta spécialité" prompt once, on Settings,
      // after confirming — a real gap, but a rare one (this project's own
      // signUp call currently disables email confirmation in practice).
      setIsLoading(false);
      setAwaitingConfirmation(true);
    }
  }

  if (awaitingConfirmation) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
          <MailCheck className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">Vérifie ta boîte mail</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          On a envoyé un lien de confirmation à <strong>{form.email}</strong>. Clique dessus pour
          activer ton compte, puis connecte-toi.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
        >
          Retour à la connexion
        </Link>
      </div>
    );
  }

  const specialtyOptions = specialties.map((s) => ({ value: String(s.id), label: s.name }));
  const selectedSpecialtyName = specialties.find((s) => s.id === specialtyId)?.name;
  const yearOptions = years.map((y) => ({
    value: String(y.id),
    label: y.name,
    disabled: isLockedInternYear(selectedSpecialtyName, y),
  }));

  function handleDisabledYearClick() {
    toast({ variant: "info", title: INTERN_YEAR_LOCKED_MESSAGE });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Input
        label="Nom complet"
        name="fullName"
        placeholder="Ex : Amine Belkacem"
        required
        value={form.fullName}
        onChange={(e) => update("fullName", e.target.value)}
      />

      <Input
        label="Adresse e-mail"
        name="email"
        type="email"
        placeholder="prenom.nom@etu.univ-dz.org"
        required
        value={form.email}
        onChange={(e) => update("email", e.target.value)}
      />

      <Input
        label="Mot de passe"
        name="password"
        type="password"
        placeholder="8 caractères minimum"
        required
        minLength={8}
        value={form.password}
        onChange={(e) => update("password", e.target.value)}
      />

      <Select
        label="Faculté (Algérie)"
        name="university"
        placeholder="Choisis ta faculté"
        options={FACULTY_OPTIONS}
        required
        value={form.university}
        onValueChange={(value) => update("university", value)}
      />

      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Spécialité"
          name="specialty"
          placeholder="Choisis"
          options={specialtyOptions}
          required
          value={specialtyId != null ? String(specialtyId) : ""}
          onValueChange={handleSpecialtyChange}
        />

        <Select
          label="Année"
          name="academicYear"
          placeholder={specialtyId == null ? "Choisis d'abord" : yearsLoading ? "Chargement..." : "Choisis"}
          options={yearOptions}
          required
          disabled={specialtyId == null || yearsLoading}
          value={academicYearId != null ? String(academicYearId) : ""}
          onValueChange={handleYearChange}
          onDisabledOptionClick={handleDisabledYearClick}
        />
      </div>

      <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
        Créer mon compte
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Déjà inscrit ?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Connecte-toi
        </Link>
      </p>
    </form>
  );
}
