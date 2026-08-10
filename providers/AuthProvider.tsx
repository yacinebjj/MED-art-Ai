"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { profileFromUser } from "@/lib/auth";
import type { StudentProfile } from "@/lib/types";
import type { StudentCurriculumProfile } from "@/types/academic";

interface TrialInfo {
  active: boolean;
  daysRemaining: number;
}

const EMPTY_CURRICULUM_PROFILE: StudentCurriculumProfile = {
  specialtyId: null,
  academicYearId: null,
  specialty: null,
  academicYear: null,
};

interface AuthContextValue {
  user: User | null;
  profile: StudentProfile | null;
  /** The student's real filière/année choice — see app/api/profile/route.ts. `null` fields mean "not chosen yet", not "medicine, 1st year" (no fabricated default). */
  curriculumProfile: StudentCurriculumProfile | null;
  loading: boolean;
  trial: TrialInfo | null;
  isSubscribed: boolean;
  signOut: () => Promise<void>;
  /** Call after supabase.auth.updateUser() so the new metadata shows up immediately. */
  refreshUser: () => Promise<void>;
  /** Call after PATCH /api/profile succeeds so the new specialty/année show up immediately. */
  refreshCurriculumProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [trial, setTrial] = useState<TrialInfo | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [curriculumProfile, setCurriculumProfile] = useState<StudentCurriculumProfile | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!user) {
      setTrial(null);
      setIsSubscribed(false);
      return;
    }

    fetch("/api/subscription")
      .then((res) => res.json())
      .then((data) => {
        setTrial(data.trial ? { active: data.trial.active, daysRemaining: data.trial.daysRemaining } : null);
        setIsSubscribed(Boolean(data.subscription?.active));
      })
      .catch(() => {
        setTrial(null);
        setIsSubscribed(false);
      });
    // Same user?.id reasoning as the curriculumProfile effect below — avoids
    // a duplicate /api/subscription call from the double setUser() on boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function fetchCurriculumProfile() {
    try {
      const res = await fetch("/api/profile");
      const data = await res.json().catch(() => ({}));
      setCurriculumProfile(res.ok && data.profile ? data.profile : EMPTY_CURRICULUM_PROFILE);
    } catch {
      setCurriculumProfile(EMPTY_CURRICULUM_PROFILE);
    }
  }

  // Keyed on user?.id (a primitive), not the `user` object itself: the auth
  // bootstrap effect above calls setUser twice on every page load — once
  // from getUser(), once from onAuthStateChange's initial event — each with
  // a structurally-equal but referentially-new User object. Depending on
  // `user` directly re-ran this fetch every time, so curriculumProfile got
  // set to null-ish "loading" values and then real data in quick
  // succession, which is exactly what caused Settings/Dashboard to flash
  // between "empty" and "populated" on every load.
  useEffect(() => {
    if (!user) {
      setCurriculumProfile(null);
      return;
    }
    fetchCurriculumProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
  }

  async function refreshUser() {
    const { data } = await supabase.auth.getUser();
    setUser(data.user);
  }

  const profile = user ? profileFromUser(user) : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        curriculumProfile,
        loading,
        trial,
        isSubscribed,
        signOut,
        refreshUser,
        refreshCurriculumProfile: fetchCurriculumProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
