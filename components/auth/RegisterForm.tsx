"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useAnimationControls } from "framer-motion";
import { Eye, EyeOff, GraduationCap, Lock, Mail, MailCheck, User } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { AuthField } from "./AuthField";
import { AuthSubmitButton } from "./AuthSubmitButton";
import { ALGERIAN_FACULTIES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/auth";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { isLockedInternYear, INTERN_YEAR_LOCKED_MESSAGE } from "@/lib/academic-year-locks";
import type { AcademicYear, Specialty } from "@/types/academic";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAuth } from "@/lib/translations/auth";

const FACULTY_OPTIONS = ALGERIAN_FACULTIES.map((name) => ({ value: name, label: name }));

/** Matches AuthField: dark glass, 56px tall, cyan focus. */
const SELECT_CLASSES = "h-14 rounded-2xl border-white/10 bg-slate-900/80 text-[15px] text-white shadow-none hover:border-white/20 focus:border-cyan-400 focus:ring-cyan-400/30";

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
  const { language } = useLanguage();
  const shake = useAnimationControls();
  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
  }

  function handleSpecialtyChange(value: string) {
    setSpecialtyId(Number(value));
  }

  function handleYearChange(value: string) {
    setAcademicYearId(Number(value));
  }

  /** Errors slide in as a toast and the card gives a short shake — no inline alert block. */
  function showError(message: string) {
    toast({ variant: "error", title: language === "fr" ? "Inscription impossible" : "Couldn't sign up", description: message });
    void shake.start({ x: [0, -10, 10, -6, 6, 0], transition: { duration: 0.4 } });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.university) {
      showError("Choisis ta faculté.");
      return;
    }
    if (specialtyId == null || academicYearId == null) {
      showError("Choisis ta spécialité et ton année.");
      return;
    }

    setIsLoading(true);

    const specialtyName = specialties.find((s) => s.id === specialtyId)?.name ?? "";
    const yearName = years.find((y) => y.id === academicYearId)?.name ?? "";

    // Where to land after signing up (e.g. a Promo / Groupe invite link:
    // /register?next=/dashboard/billing/pool/<code>). Sanitized: never an open redirect.
    const next = sanitizeRedirectPath(new URLSearchParams(window.location.search).get("next"));

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
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
      showError(translateAuthError(signUpError.message));
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
      router.push(next);
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
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-6 text-center sm:p-8"
      >
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.35, ease: "easeOut" }}
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 text-white shadow-[0_0_30px_rgba(34,211,238,0.45)]"
        >
          <MailCheck className="h-6 w-6" />
        </motion.div>
        <h2 className="text-lg font-bold text-white">{tAuth("verifyEmailTitle", language)}</h2>
        <p className="mt-2 text-sm text-slate-400">
          On a envoyé un lien de confirmation à <strong className="text-white">{form.email}</strong>. Clique
          dessus pour activer ton compte, puis connecte-toi.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block text-sm font-semibold text-cyan-300 transition-colors hover:text-cyan-200 hover:underline"
        >
          Retour à la connexion
        </Link>
      </motion.div>
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

  // Derived from form.password — always in sync, no duplicate state.
  const hasPassword = form.password.length > 0;

  // Purely cosmetic grouping/stagger — no step logic, every field still
  // submits together in one handleSubmit call above. Splits the previously
  // flat 6-field list into two labeled sections ("Tes informations" / "Ton
  // cursus") so the form reads as structured progress rather than one long
  // undifferentiated stack.
  const sectionVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <motion.form onSubmit={handleSubmit} animate={shake} className="space-y-6">
      <motion.div
        className="space-y-6"
        initial={false}
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
      >

      <motion.div variants={sectionVariants} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="space-y-4">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300/80">
          <User className="h-3.5 w-3.5" />
          {language === "fr" ? "Tes informations" : "Your information"}
        </p>

        <AuthField
          icon={<User className="h-4 w-4" />}
          label={tAuth("fullNameLabel", language)}
          name="fullName"
          autoComplete="name"
          required
          value={form.fullName}
          onChange={(e) => update("fullName", e.target.value)}
        />

        <AuthField
          icon={<Mail className="h-4 w-4" />}
          label="Adresse e-mail"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
        />

        <AuthField
          icon={<Lock className="h-4 w-4" />}
          label={tAuth("passwordLabel", language)}
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          hint="8 caractères minimum"
          required
          minLength={8}
          value={form.password}
          onChange={(e) => update("password", e.target.value)}
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
      </motion.div>

      <motion.div variants={sectionVariants} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="space-y-4">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300/80">
          <GraduationCap className="h-3.5 w-3.5" />
          {language === "fr" ? "Ton cursus" : "Your program"}
        </p>

        <Select
          label="Faculté (Algérie)"
          name="university"
          placeholder={tAuth("facultyPlaceholder", language)}
          options={FACULTY_OPTIONS}
          required
          value={form.university}
          onValueChange={(value) => update("university", value)}
          className={SELECT_CLASSES}
        />

        <div className="grid grid-cols-2 gap-4">
          <Select
            label={tAuth("specialtyLabel", language)}
            name="specialty"
            placeholder="Choisis"
            options={specialtyOptions}
            required
            value={specialtyId != null ? String(specialtyId) : ""}
            onValueChange={handleSpecialtyChange}
            className={SELECT_CLASSES}
          />

          <Select
            label={tAuth("yearLabel", language)}
            name="academicYear"
            placeholder="Choisis"
            options={yearOptions}
            required
            disabled={specialtyId == null || yearsLoading}
            value={academicYearId != null ? String(academicYearId) : ""}
            onValueChange={handleYearChange}
            onDisabledOptionClick={handleDisabledYearClick}
            className={SELECT_CLASSES}
          />
        </div>
      </motion.div>

      <motion.div variants={sectionVariants} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
        <AuthSubmitButton isLoading={isLoading} loadingLabel={language === "fr" ? "Création du compte…" : "Creating your account…"}>
          Créer mon compte
        </AuthSubmitButton>

        <p className="mt-6 text-center text-sm text-slate-400">
          Déjà inscrit ?{" "}
          <Link href="/login" className="font-semibold text-cyan-300 hover:underline">
            Connecte-toi
          </Link>
        </p>
      </motion.div>
      </motion.div>
    </motion.form>
  );
}
