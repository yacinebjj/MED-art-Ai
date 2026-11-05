"use client";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { BellRing, Check, Cpu, GraduationCap, Palette, Smartphone, UserRound, type LucideIcon } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { AvatarUpload } from "@/components/settings/AvatarUpload";
import { LockedBadge, LockedValue, SettingsCard, SettingsCardSkeleton, SettingsRow, SettingsRows, SettingsSectionHeader } from "@/components/settings/SettingsUI";
import { ALGERIAN_FACULTIES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import { isLockedInternYear, INTERN_YEAR_LOCKED_MESSAGE } from "@/lib/academic-year-locks";
import type { StudentProfile } from "@/lib/types";
import type { AcademicYear, Specialty } from "@/types/academic";
import { useLanguage } from "@/providers/LanguageProvider";
import { tSettings } from "@/lib/translations/settings";

const FACULTY_OPTIONS = ALGERIAN_FACULTIES.map((name) => ({ value: name, label: name }));

// Every section but "Profil & Cursus" is its own lazily-loaded chunk.
const sectionLoading = () => <SettingsCardSkeleton rows={2} />;
const RemindersSection = dynamic(() => import("@/components/settings/SettingsSections").then((m) => m.RemindersSection), { ssr: false, loading: sectionLoading });
const AiEngineSection = dynamic(() => import("@/components/settings/SettingsSections").then((m) => m.AiEngineSection), { ssr: false, loading: sectionLoading });
const AppearanceSection = dynamic(() => import("@/components/settings/SettingsSections").then((m) => m.AppearanceSection), { ssr: false, loading: sectionLoading });
const DevicesSection = dynamic(() => import("@/components/settings/SettingsSections").then((m) => m.DevicesSection), { ssr: false, loading: sectionLoading });

const SECTIONS = ["profile", "ai", "reminders", "appearance", "devices"] as const;
type SettingsSection = (typeof SECTIONS)[number];

function isSettingsSection(value: string | null): value is SettingsSection {
  return value !== null && (SECTIONS as readonly string[]).includes(value);
}

/** The settings menu: label, a hint under it (desktop), and the section's own title and one-line description. */
const SECTION_META: Record<SettingsSection, { icon: LucideIcon; label: [string, string]; hint: [string, string]; title: [string, string]; description: [string, string] }> = {
  profile: {
    icon: GraduationCap,
    label: ["Profil & Cursus", "Profile"],
    hint: ["Compte, faculté, année", "Account, faculty, year"],
    title: ["Profil & Cursus", "Profile & curriculum"],
    description: ["Ton identité sur MedArt et le cursus qui adapte tes modules.", "Your identity on MedArt and the curriculum your modules follow."],
  },
  ai: {
    icon: Cpu,
    label: ["Moteur IA", "AI engine"],
    hint: ["Langue des contenus", "Content language"],
    title: ["Moteur IA", "AI engine"],
    description: ["La langue des contenus générés et les modèles qui les produisent.", "The language of generated content and the models behind it."],
  },
  reminders: {
    icon: BellRing,
    label: ["Rappels", "Reminders"],
    hint: ["Flashcards en notification", "Flashcards as notifications"],
    title: ["Rappels", "Reminders"],
    description: ["Des flashcards qui viennent à toi, au rythme que tu choisis.", "Flashcards that come to you, at the pace you choose."],
  },
  appearance: {
    icon: Palette,
    label: ["Apparence", "Appearance"],
    hint: ["Thème et langue", "Theme and language"],
    title: ["Apparence", "Appearance"],
    description: ["Thème, langue de l'interface et visite guidée.", "Theme, interface language and guided tour."],
  },
  devices: {
    icon: Smartphone,
    label: ["Appareils", "Devices"],
    hint: ["Sessions et sécurité", "Sessions and security"],
    title: ["Appareils", "Devices"],
    description: ["Les navigateurs liés à ton compte, et ta sécurité.", "The browsers linked to your account, and your security."],
  },
};

const EMPTY_FORM: StudentProfile = {
  fullName: "",
  email: "",
  university: "",
  specialty: "medicine",
  academicYear: "",
};

/** The premium blue call to action (the MedArt Copilot's send button). */
const SAVE_BUTTON_CLASS =
  "w-full bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_8px_20px_-8px_rgba(14,165,233,0.75)] hover:brightness-110 hover:shadow-[0_10px_24px_-8px_rgba(14,165,233,0.85)] sm:w-auto";

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
 *
 * Layout (2026-11-05): grouped cards in the Apple / Stripe manner
 * (components/settings/SettingsUI.tsx) — a menu on the left from lg (a strip
 * of pills above the content below it), each section a title, a line of
 * context and its cards.
 */
function SettingsHub() {
  const { profile, refreshUser, refreshCurriculumProfile } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();
  const fr = language === "fr";
  const pick = (pair: [string, string]) => (fr ? pair[0] : pair[1]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const sectionParam = searchParams.get("section");
  const section: SettingsSection = isSettingsSection(sectionParam) ? sectionParam : "profile";

  function openSection(next: SettingsSection) {
    router.replace(next === "profile" ? "/dashboard/settings" : `/dashboard/settings?section=${next}`, { scroll: false });
  }
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
  // Spécialité stays permanently locked once ever set — locking it
  // unconditionally from the start would strand every new student with no
  // way to ever choose one (registration doesn't collect it; this settings
  // page is the only place that does), so it can only lock in AFTER a first
  // real choice. Année locks together with it (product decision,
  // 2026-10-10): registration saves both, so once the pair exists neither
  // can be changed here.
  const [specialtyLocked, setSpecialtyLocked] = useState(false);
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

      if (savedSpecialtyId != null) setSpecialtyLocked(true);
      if (savedSpecialtyId != null && savedAcademicYearId != null) setYearLocked(true);
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
  const selectedYearName = years.find((y) => y.id === academicYearId)?.name;
  const yearOptions = years.map((y) => ({
    value: String(y.id),
    label: y.name,
    disabled: isLockedInternYear(selectedSpecialtyName, y),
  }));

  function handleDisabledYearClick() {
    toast({ variant: "info", title: INTERN_YEAR_LOCKED_MESSAGE });
  }

  const lockedLabel = tSettings("lockedPill", language);
  const identityChips = ready ? [form.university, selectedSpecialtyName, selectedYearName].filter((value): value is string => Boolean(value)) : [];

  const profileSection = (
    <div data-tour="settings-profile" className="space-y-5">
      {/* Who you are on MedArt: the photo (its own upload, outside the form), the name, the e-mail and the curriculum at a glance. */}
      <SettingsCard>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-6">
          <AvatarUpload size={20} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[1.125rem] font-semibold tracking-[-0.01em] text-slate-900 dark:text-white">{form.fullName || (fr ? "Ton profil" : "Your profile")}</p>
            {form.email && <p className="truncate text-[0.875rem] text-slate-500 dark:text-white/50">{form.email}</p>}
            {identityChips.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {identityChips.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex max-w-full items-center truncate rounded-full bg-sky-500/10 px-2.5 py-1 text-[0.75rem] font-semibold text-sky-700 ring-1 ring-inset ring-sky-500/15 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-400/20"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            )}
          </div>
          <p className="text-[0.75rem] leading-relaxed text-slate-400 dark:text-white/40 sm:max-w-[13rem] sm:text-right">
            {fr ? "Visibles par toi seul(e) · Photo : JPG, PNG, WEBP ou GIF, 5 Mo max." : "Visible only to you · Photo: JPG, PNG, WEBP or GIF, 5 MB max."}
          </p>
        </div>
      </SettingsCard>

      {/* The loader only shows after a beat (route-pending); the form settles in (motion-swap) — app/globals.css. */}
      {!ready ? (
        <div className="route-pending space-y-5" aria-busy="true">
          <span className="sr-only">Chargement de ton profil...</span>
          <SettingsCardSkeleton rows={2} />
          <SettingsCardSkeleton rows={3} />
        </div>
      ) : (
        <form className="motion-swap space-y-5" onSubmit={handleSubmit}>
          {error && (
            <div role="alert" className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-4 py-3 text-[0.875rem] text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/[0.08] dark:text-rose-300">
              {error}
            </div>
          )}

          <SettingsCard
            icon={UserRound}
            title={tSettings("accountInfoTitle", language)}
            description={fr ? "Liées à ta connexion : elles ne se modifient pas ici." : "Tied to your sign-in: they can't be changed here."}
          >
            <SettingsRows>
              <SettingsRow label={fr ? "Adresse e-mail" : "Email address"} aside={<LockedBadge label={lockedLabel} />}>
                <LockedValue value={form.email ?? ""} />
              </SettingsRow>
              <SettingsRow
                label={tSettings("fullNameLabel", language)}
                aside={<LockedBadge label={lockedLabel} />}
                description={fr ? "Le nom associé à ton compte ne peut pas être modifié ici." : "The name on your account can't be changed here."}
              >
                <LockedValue value={form.fullName} />
              </SettingsRow>
            </SettingsRows>
          </SettingsCard>

          <SettingsCard
            icon={GraduationCap}
            title={fr ? "Cursus" : "Curriculum"}
            description={
              fr
                ? "Ta faculté, ta spécialité et ton année adaptent tes modules. Vérifie-les bien : la spécialité et l'année se verrouillent une fois enregistrées."
                : "Your faculty, specialty and year shape your modules. Check them carefully: specialty and year lock once saved."
            }
            footer={
              <Button type="submit" isLoading={isSaving} disabled={isSaving} className={SAVE_BUTTON_CLASS}>
                {saved && !isSaving && <Check className="h-4 w-4" />}
                {saved && !isSaving ? tSettings("saved", language) : tSettings("saveChanges", language)}
              </Button>
            }
          >
            <SettingsRows>
              <SettingsRow label={fr ? "Faculté (Algérie)" : "Faculty (Algeria)"} htmlFor="university">
                <Select name="university" options={FACULTY_OPTIONS} value={form.university} onValueChange={(value) => update("university", value)} />
              </SettingsRow>

              <SettingsRow
                label={fr ? "Spécialité" : "Specialty"}
                htmlFor={specialtyLocked ? undefined : "specialty"}
                aside={specialtyLocked ? <LockedBadge label={lockedLabel} /> : undefined}
                description={specialtyLocked ? (fr ? "La spécialité ne peut pas être modifiée après l'inscription." : "Your specialty can't be changed after sign-up.") : undefined}
              >
                {specialtyLocked ? (
                  <LockedValue value={selectedSpecialtyName ?? ""} />
                ) : (
                  <Select
                    name="specialty"
                    placeholder={tSettings("choosePlaceholder", language)}
                    options={specialtyOptions}
                    value={specialtyId != null ? String(specialtyId) : ""}
                    onValueChange={handleSpecialtyChange}
                  />
                )}
              </SettingsRow>

              <SettingsRow
                label={fr ? "Année" : "Year"}
                htmlFor={yearLocked ? undefined : "academicYear"}
                aside={yearLocked ? <LockedBadge label={lockedLabel} /> : undefined}
                description={yearLocked ? (fr ? "L'année ne peut pas être modifiée après l'inscription." : "Your year can't be changed after sign-up.") : undefined}
              >
                {yearLocked ? (
                  <LockedValue value={selectedYearName ?? ""} />
                ) : (
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
                    disabled={specialtyId == null || yearsLoading}
                    onDisabledOptionClick={handleDisabledYearClick}
                  />
                )}
              </SettingsRow>
            </SettingsRows>
          </SettingsCard>
        </form>
      )}
    </div>
  );

  const meta = SECTION_META[section];

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      {/* Phones: the shell's Topbar already names the page. */}
      <header className="mb-8 max-md:hidden">
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em] text-slate-900 dark:text-white">{fr ? "Paramètres" : "Settings"}</h1>
        <p className="mt-1 text-[0.9375rem] text-slate-500 dark:text-white/50">
          {fr ? "Profil, moteur IA, rappels, apparence et appareils — tout au même endroit." : "Profile, AI engine, reminders, appearance and devices — all in one place."}
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <aside className="mb-6 min-w-0 lg:mb-0">
          {/* Phones and tablets: a strip of pills that scrolls sideways; from lg, a menu that stays in view. */}
          <nav
            data-tour="settings-tabs"
            aria-label={fr ? "Sections des paramètres" : "Settings sections"}
            className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-4 sm:px-4 lg:sticky lg:top-[calc(var(--topbar-clearance)+0.75rem)] lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden"
          >
            {SECTIONS.map((value) => {
              const item = SECTION_META[value];
              const Icon = item.icon;
              const active = value === section;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => openSection(value)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-[0.875rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 lg:w-full lg:gap-3 lg:rounded-xl lg:px-2.5 lg:py-2 lg:text-left",
                    active
                      ? "bg-sky-600 text-white shadow-[0_6px_16px_-8px_rgba(2,132,199,0.7)] lg:bg-transparent lg:text-slate-900 lg:shadow-none lg:dark:text-white"
                      : "bg-white/80 text-slate-600 ring-1 ring-black/[0.06] hover:text-slate-900 dark:bg-white/[0.05] dark:text-white/60 dark:ring-white/[0.08] dark:hover:text-white lg:bg-transparent lg:ring-0 lg:hover:bg-black/[0.03] lg:dark:bg-transparent lg:dark:hover:bg-white/[0.04]"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="settings-nav-active"
                      aria-hidden
                      className="absolute inset-0 hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06),0_8px_20px_-12px_rgba(15,23,42,0.3)] ring-1 ring-black/[0.05] dark:bg-white/[0.07] dark:shadow-none dark:ring-white/[0.08] lg:block"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <span
                    className={cn(
                      "relative flex shrink-0 items-center justify-center lg:h-8 lg:w-8 lg:rounded-lg",
                      active
                        ? "lg:bg-gradient-to-br lg:from-sky-500 lg:to-blue-600 lg:text-white lg:shadow-[0_6px_14px_-6px_rgba(14,165,233,0.7)]"
                        : "lg:bg-slate-100 lg:text-slate-500 lg:dark:bg-white/[0.06] lg:dark:text-white/60"
                    )}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <span className="relative min-w-0">
                    <span className="block truncate">{pick(item.label)}</span>
                    <span className={cn("hidden truncate text-[0.75rem] font-medium lg:block", active ? "text-slate-500 dark:text-white/50" : "text-slate-400 dark:text-white/35")}>
                      {pick(item.hint)}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* motion-swap: each section settles in where the last one was. */}
        <div key={section} className="motion-swap min-w-0">
          <SettingsSectionHeader title={pick(meta.title)} description={pick(meta.description)} />
          {section === "profile" && profileSection}
          {section === "ai" && <AiEngineSection />}
          {section === "reminders" && <RemindersSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "devices" && <DevicesSection />}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="mx-auto h-40 max-w-5xl animate-pulse rounded-2xl bg-muted" />}>
      <SettingsHub />
    </Suspense>
  );
}
