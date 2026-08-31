"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Bell, Check, Lock } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { RevealSection } from "@/components/ui/RevealSection";
import { useToast } from "@/components/ui/Toast";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { AvatarUpload } from "@/components/settings/AvatarUpload";
import { ALGERIAN_FACULTIES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import { isLockedInternYear, INTERN_YEAR_LOCKED_MESSAGE } from "@/lib/academic-year-locks";
import { PushOptInButton } from "@/components/push/PushOptInButton";
import type { StudentProfile } from "@/lib/types";
import type { AcademicYear, Specialty } from "@/types/academic";
import { useLanguage } from "@/providers/LanguageProvider";
import { tSettings } from "@/lib/translations/settings";

const FACULTY_OPTIONS = ALGERIAN_FACULTIES.map((name) => ({ value: name, label: name }));

const EMPTY_FORM: StudentProfile = {
  fullName: "",
  email: "",
  university: "",
  specialty: "medicine",
  academicYear: "",
};

// Shared visual treatment for the 4 permanently-locked fields (Email, Nom
// complet, Spécialité, Année) — a dashed muted-tint surface instead of a
// flat opacity-50 fade, so the saved value stays legible while the locked
// state stays unambiguous (see task brief: "clairs... sans être moches").
// `disabled:opacity-100` cancels Select's own baked-in `disabled:opacity-60`
// (tailwind-merge resolves the conflict in favor of whichever is passed
// last, i.e. this one) so the text doesn't get double-faded on top of it.
const LOCKED_INPUT_CLASS = "cursor-not-allowed border-dashed bg-muted/50 pr-9 text-foreground/80 shadow-none disabled:opacity-100";
const LOCKED_SELECT_CLASS = "cursor-not-allowed border-dashed bg-muted/50 text-foreground/80 shadow-none disabled:opacity-100";

/** Label row for Spécialité/Année — adds the "Verrouillé" pill once a field has ever been locked, without touching the shared Select/Input components used app-wide. */
function FieldLabelRow({ htmlFor, locked, children }: { htmlFor: string; locked?: boolean; children: string }) {
  const { language } = useLanguage();
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <Label htmlFor={htmlFor} className="mb-0">
        {children}
      </Label>
      {locked && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Lock className="h-2.5 w-2.5" />
          {tSettings("lockedPill", language)}
        </span>
      )}
    </div>
  );
}

/** Same label-row treatment for Email/Nom complet, which are ALWAYS locked (no conditional state to thread through). */
function LockedFieldLabel({ children }: { children: string }) {
  const { language } = useLanguage();
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="text-sm font-medium text-foreground">{children}</span>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Lock className="h-2.5 w-2.5" />
        {tSettings("lockedPill", language)}
      </span>
    </div>
  );
}

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
  const { language } = useLanguage();
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
  // Same "was it EVER set" permanence rule as yearLocked, applied to
  // Spécialité — locking it unconditionally from the start would strand
  // every new student with no way to ever choose one (registration doesn't
  // collect it; this settings page is the only place that does), so it can
  // only lock in AFTER a first real choice, exactly like Année already does.
  const [specialtyLocked, setSpecialtyLocked] = useState(false);

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

      if (savedSpecialtyId != null) setSpecialtyLocked(true);
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
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{tSettings("profileSettingsTitle", language)}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Ces informations personnalisent le contenu généré par l'IA à ton parcours.
      </p>

      <RevealSection>
        <Card className="mt-6 p-6">
          <div className="mb-5 flex items-center gap-3">
            <AvatarUpload />
            <div>
              <h2 className="text-sm font-bold text-foreground">{tSettings("accountInfoTitle", language)}</h2>
              <p className="text-xs text-muted-foreground">
                Visibles par toi seul(e) &middot; JPG, PNG, WEBP ou GIF, 5&nbsp;Mo max pour la photo.
              </p>
            </div>
          </div>

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

              <div>
                <LockedFieldLabel>Adresse e-mail</LockedFieldLabel>
                <div className="relative">
                  <Input name="email" value={form.email ?? ""} disabled className={LOCKED_INPUT_CLASS} />
                  <Lock className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                </div>
              </div>

              <div>
                <LockedFieldLabel>{tSettings("fullNameLabel", language)}</LockedFieldLabel>
                <div className="relative">
                  <Input name="fullName" value={form.fullName} disabled className={LOCKED_INPUT_CLASS} />
                  <Lock className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Le nom associé à ton compte ne peut pas être modifié ici.
                </p>
              </div>

              <Select
                label="Faculté (Algérie)"
                name="university"
                options={FACULTY_OPTIONS}
                value={form.university}
                onValueChange={(value) => update("university", value)}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabelRow htmlFor="specialty" locked={specialtyLocked}>
                    Spécialité
                  </FieldLabelRow>
                  <Select
                    name="specialty"
                    placeholder={tSettings("choosePlaceholder", language)}
                    options={specialtyOptions}
                    value={specialtyId != null ? String(specialtyId) : ""}
                    onValueChange={handleSpecialtyChange}
                    disabled={specialtyLocked}
                    className={specialtyLocked ? LOCKED_SELECT_CLASS : undefined}
                  />
                  {specialtyLocked && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      La spécialité ne peut pas être modifiée après l&apos;inscription.
                    </p>
                  )}
                </div>
                <div>
                  <FieldLabelRow htmlFor="academicYear" locked={yearLocked}>
                    Année
                  </FieldLabelRow>
                  <Select
                    name="academicYear"
                    placeholder={
                      specialtyId == null
                        ? tSettings("chooseSpecialtyFirstPlaceholder", language)
                        : yearsLoading
                          ? tSettings("loadingEllipsis", language)
                          : tSettings("choosePlaceholder", language)
                    }
                    options={yearOptions}
                    value={academicYearId != null ? String(academicYearId) : ""}
                    onValueChange={handleYearChange}
                    disabled={specialtyId == null || yearsLoading || yearLocked}
                    onDisabledOptionClick={handleDisabledYearClick}
                    className={yearLocked ? LOCKED_SELECT_CLASS : undefined}
                  />
                  {yearLocked && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      L&apos;année d&apos;étude ne peut pas être modifiée après l&apos;inscription.
                    </p>
                  )}
                </div>
              </div>

              <Button type="submit" isLoading={isSaving} disabled={isSaving} className="w-full sm:w-auto">
                {saved && !isSaving && <Check className="h-4 w-4" />}
                {saved && !isSaving ? tSettings("saved", language) : tSettings("saveChanges", language)}
              </Button>
            </form>
          )}
        </Card>
      </RevealSection>

      <RevealSection delay={0.08}>
        <Card className="mt-6 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
              <Bell className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-bold text-foreground">{tSettings("flashRemindersTitle", language)}</h2>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Reçois de temps en temps une notification de ton navigateur avec une flashcard de tes modules actifs — même
            quand l&apos;onglet n&apos;est pas ouvert.
          </p>
          {/*
            PushOptInButton renders a fixed-height, single-line (whitespace-nowrap)
            Button and exposes no className passthrough, so its label itself can't
            be made to wrap from here. On the narrowest phones (320-360px), "Désactiver
            les rappels flash" can exceed what's left after the shell's own gutters plus
            this card's padding. overflow-x-auto keeps any overflow contained to this one
            row (a short local swipe) instead of it leaking into a page-wide horizontal
            scroll on <main> — which inherits an effective overflow-x:auto the moment any
            ancestor sets overflow-y:auto — or the label silently bleeding past the
            card's rounded border. p-4 on mobile (vs p-6 from sm: up) also buys back 16px
            of width so the common 375-428px phones fit with no scrolling at all.
          */}
          <div className="mt-4 overflow-x-auto scrollbar-thin">
            <PushOptInButton />
          </div>
        </Card>
      </RevealSection>
    </div>
  );
}
