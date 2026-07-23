"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { ALGERIAN_FACULTIES, SPECIALTIES, getAcademicYearOptions } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import type { Specialty, StudentProfile } from "@/lib/types";

const FACULTY_OPTIONS = ALGERIAN_FACULTIES.map((name) => ({ value: name, label: name }));

const EMPTY_FORM: StudentProfile = {
  fullName: "",
  email: "",
  university: "",
  specialty: "medicine",
  academicYear: "",
};

export default function SettingsPage() {
  const { profile, refreshUser } = useAuth();
  const [form, setForm] = useState<StudentProfile>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) setForm(profile);
  }, [profile]);

  function update<K extends keyof StudentProfile>(key: K, value: StudentProfile[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "specialty") {
        next.academicYear = "";
      }
      return next;
    });
    setSaved(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        full_name: form.fullName,
        university: form.university,
        specialty: form.specialty,
        academic_year: form.academicYear,
      },
    });

    setIsSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await refreshUser();
    setSaved(true);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Paramètres du profil</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Ces informations personnalisent le contenu généré par l'IA à ton parcours.
      </p>

      <Card className="mt-6 p-6">
        <form className="space-y-5" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <Input label="Adresse e-mail" name="email" value={form.email ?? ""} disabled />

          <Input
            label="Nom complet"
            name="fullName"
            value={form.fullName}
            onChange={(e) => update("fullName", e.target.value)}
          />
          <Select
            label="Faculté (Algérie)"
            name="university"
            options={FACULTY_OPTIONS}
            value={form.university}
            onValueChange={(value) => update("university", value)}
          />
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Spécialité"
              name="specialty"
              options={SPECIALTIES}
              value={form.specialty}
              onValueChange={(value) => update("specialty", value as Specialty)}
            />
            <Select
              label="Année"
              name="academicYear"
              options={getAcademicYearOptions(form.specialty)}
              value={form.academicYear}
              onValueChange={(value) => update("academicYear", value)}
            />
          </div>
          <Button type="submit" isLoading={isSaving} disabled={isSaving}>
            {saved && !isSaving && <Check className="h-4 w-4" />}
            {saved && !isSaving ? "Enregistré" : "Enregistrer les modifications"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
