"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { ALGERIAN_FACULTIES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import { isLockedInternYear, INTERN_YEAR_LOCKED_MESSAGE } from "@/lib/academic-year-locks";
import { PushOptInButton } from "@/components/push/PushOptInButton";
import type { StudentProfile } from "@/lib/types";
import type { AcademicYear, Specialty } from "@/types/academic";

const FACULTY_OPTIONS = ALGERIAN_FACULTIES.map((name) => ({ value: name, label: name }));

const EMPTY_FORM: StudentProfile = {
  fullName: "",
  email: "",
  university: "",
  specialty: "medicine",
  academicYear: "",
};

/**
 * Spécialité + Année are sourced live from Supabase (curriculum_specialties /
 * curriculum_academic_years) and saved to profiles.specialty_id /
 * profiles.academic_year_id via PATCH /api/profile — see
 * app/api/profile/route.ts. fullName/university stay in auth
 * user_metadata via auth.updateUser, unrelated fields.
 *
 * Bootstrap fix (F5 used to reset the fields to empty): the previous version
 * set `specialtyId` as soon as the profile arrived and only THEN fetched the
 * matching years, so the "Année" <Select> could mount with a `value` that
 * had no corresponding <SelectItem> registered yet (its options list was
 * still empty) — Radix has no item to resolve that value's label against,
 * so it rendered blank even though the state was technically correct. The
 * fix: fetch specialties + profile + (if a specialty was saved) its years
 * ALL BEFORE the form's first render, gated by `ready` below — so every
 * <Select>'s `options` and `value` are correct from the very first paint.
 */
export default function SettingsPage() {
  const { profile, refreshUser, refreshCurriculumProfile } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState<StudentProfile>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ready, setReady] = useState(false);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [specialtyId, setSpecialtyId] = useState<number | null>(null);
  const [academicYearId, setAcademicYearId] = useState<number | null>(null);
  const [yearsLoading, setYearsLoading] = useState(false);
  // Once a student has registered with a year, it's permanent — set from the
  // bootstrap fetch below the moment a saved academicYearId is found, never
  // cleared afterward (even if academicYearId itself later changes for some
  // other reason, this stays true — the rule is "was it EVER set", not "is
  // it currently set").
  const [yearLocked, setYearLocked] = useState(false);

  // Set by the bootstrap effect right after it fetches years for the saved
  // specialty — tells the live "specialty changed" effect below to skip its
  // very first run instead of re-fetching the same years a second time.
  const skipNextYearsFetchRef = useRef(false);

  useEffect(() => {
    if (profile) setForm(profile);
  }, [profile]);

  // One-time bootstrap: specialties + saved profile + (if any) its years,
  // all resolved before the form is allowed to render.
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const [specialtiesBody, profileBody] = await Promise.all([
        fetch("/api/curriculum/specialties")
          .then((res) => res.json())
          .catch(() => ({ specialties: [] })),
        fetch("/api/profile")
          .then((res) => res.json())
          .catch(() => ({ profile: null })),
      ]);
      if (cancelled) return;

      setSpecialties(specialtiesBody.specialties ?? []);

      const savedSpecialtyId: number | null = profileBody.profile?.specialtyId ?? null;
      const savedAcademicYearId: number | null = profileBody.profile?.academicYearId ?? null;

      if (savedSpecialtyId != null) {
        const yearsBody = await fetch(`/api/curriculum/years?specialtyId=${savedSpecialtyId}`)
          .then((res) => res.json())
          .catch(() => ({ years: [] }));
        if (cancelled) return;

        setYears(yearsBody.years ?? []);
        skipNextYearsFetchRef.current = true;
        setSpecialtyId(savedSpecialtyId);
        setAcademicYearId(savedAcademicYearId);
      }

      if (savedAcademicYearId != null) setYearLocked(true);
      setReady(true);
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live reload of "Année" options whenever the user manually changes
  // "Spécialité" — skipped exactly once right after bootstrap sets the
  // saved specialtyId, since bootstrap already fetched that specialty's
  // years itself.
  useEffect(() => {
    if (specialtyId == null) {
      setYears([]);
      return;
    }
    if (skipNextYearsFetchRef.current) {
      skipNextYearsFetchRef.current = false;
      return;
    }

    let cancelled = false;
    setYearsLoading(true);
    fetch(`/api/curriculum/years?specialtyId=${specialtyId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const fetchedYears: AcademicYear[] = data.years ?? [];
        setYears(fetchedYears);
        setAcademicYearId((prev) => (prev != null && fetchedYears.some((y) => y.id === prev) ? prev : null));
      })
      .catch(() => setYears([]))
      .finally(() => !cancelled && setYearsLoading(false));

    return () => {
      cancelled = true;
    };
  }, [specialtyId]);

  function update<K extends keyof StudentProfile>(key: K, value: StudentProfile[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function handleSpecialtyChange(value: string) {
    setSpecialtyId(Number(value));
    setSaved(false);
  }

  function handleYearChange(value: string) {
    setAcademicYearId(Number(value));
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
      },
    });

    if (updateError) {
      setIsSaving(false);
      setError(updateError.message);
      return;
    }

    if (specialtyId != null && academicYearId != null) {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specialtyId, academicYearId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIsSaving(false);
        setError(body?.error ?? "L'enregistrement de la spécialité/année a échoué.");
        return;
      }
      await refreshCurriculumProfile();
    }

    setIsSaving(false);
    await refreshUser();
    setSaved(true);
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
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Paramètres du profil</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Ces informations personnalisent le contenu généré par l'IA à ton parcours.
      </p>

      <Card className="mt-6 p-6">
        {!ready ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <BrandLoader className="h-6 w-6" />
            Chargement de ton profil...
          </div>
        ) : (
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
                placeholder="Choisis"
                options={specialtyOptions}
                value={specialtyId != null ? String(specialtyId) : ""}
                onValueChange={handleSpecialtyChange}
              />
              <div>
                <Select
                  label="Année"
                  name="academicYear"
                  placeholder={specialtyId == null ? "Choisis d'abord une spécialité" : yearsLoading ? "Chargement..." : "Choisis"}
                  options={yearOptions}
                  value={academicYearId != null ? String(academicYearId) : ""}
                  onValueChange={handleYearChange}
                  disabled={specialtyId == null || yearsLoading || yearLocked}
                  onDisabledOptionClick={handleDisabledYearClick}
                />
                {yearLocked && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    L&apos;année d&apos;étude ne peut pas être modifiée après l&apos;inscription.
                  </p>
                )}
              </div>
            </div>
            <Button type="submit" isLoading={isSaving} disabled={isSaving}>
              {saved && !isSaving && <Check className="h-4 w-4" />}
              {saved && !isSaving ? "Enregistré" : "Enregistrer les modifications"}
            </Button>
          </form>
        )}
      </Card>

      <Card className="mt-6 p-6">
        <h2 className="text-sm font-bold text-foreground">Rappels flash</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Reçois de temps en temps une notification de ton navigateur avec une flashcard de tes modules actifs — même
          quand l&apos;onglet n&apos;est pas ouvert.
        </p>
        <div className="mt-4">
          <PushOptInButton />
        </div>
      </Card>
    </div>
  );
}
