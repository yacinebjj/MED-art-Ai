"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MailCheck } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { ALGERIAN_FACULTIES, SPECIALTIES, getAcademicYearOptions } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth";

const FACULTY_OPTIONS = ALGERIAN_FACULTIES.map((name) => ({ value: name, label: name }));

interface FormState {
  fullName: string;
  email: string;
  password: string;
  university: string;
  specialty: string;
  academicYear: string;
}

const INITIAL_STATE: FormState = {
  fullName: "",
  email: "",
  password: "",
  university: "",
  specialty: "",
  academicYear: "",
};

export function RegisterForm() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // The available years depend on the specialty — drop a now-invalid
      // selection instead of silently submitting a mismatched year.
      if (key === "specialty") {
        next.academicYear = "";
      }
      return next;
    });
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name: form.fullName,
          university: form.university,
          specialty: form.specialty,
          academic_year: form.academicYear,
        },
      },
    });

    setIsLoading(false);

    if (signUpError) {
      setError(translateAuthError(signUpError.message));
      return;
    }

    if (data.session) {
      // Email confirmation is disabled on this project — the student is
      // already logged in.
      router.push("/dashboard");
      router.refresh();
    } else {
      // Confirmation email sent — no session until they click the link.
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
          options={SPECIALTIES}
          required
          value={form.specialty}
          onValueChange={(value) => update("specialty", value)}
        />

        <Select
          label="Année"
          name="academicYear"
          placeholder="Choisis"
          options={getAcademicYearOptions(form.specialty)}
          required
          value={form.academicYear}
          onValueChange={(value) => update("academicYear", value)}
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
