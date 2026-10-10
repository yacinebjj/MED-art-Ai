"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { fetchSubscriptionPayload } from "@/hooks/useUsage";
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
  /**
   * `avatarUrl` isn't part of the base `StudentProfile` shape (lib/types.ts) —
   * unlike the other fields, it lives in the `profiles` table, not
   * auth.users.user_metadata (see fetchAvatarUrl below) — so it's merged in
   * here as an intersection rather than added to that shared type.
   */
  profile: (StudentProfile & { avatarUrl: string | null }) | null;
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
  /** Call after POST /api/profile/avatar succeeds so the new photo shows up immediately wherever `profile.avatarUrl` is read (Settings, and later Sidebar/Topbar). */
  refreshAvatarUrl: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PROFILE_CACHE_PREFIX = "medart:curriculum-profile:";

function readCachedProfile(userId: string): StudentCurriculumProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_PREFIX + userId);
    return raw ? (JSON.parse(raw) as StudentCurriculumProfile) : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(userId: string, profile: StudentCurriculumProfile): void {
  try {
    localStorage.setItem(PROFILE_CACHE_PREFIX + userId, JSON.stringify(profile));
  } catch {
    // Storage full / blocked: the cache is only a speed-up.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [trial, setTrial] = useState<TrialInfo | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [curriculumProfile, setCurriculumProfile] = useState<StudentCurriculumProfile | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    // getSession() reads the session cookie locally — no network. It used to
    // be getUser(), a round trip to Supabase Auth that every user-dependent
    // fetch of the app (profile, curriculum, subscription, overview…) waited
    // behind on each cold open. Trusting the local session for the UI is
    // safe: every /api/** route verifies the user itself server-side.
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
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

    // Shared with useUsage (PaywallProvider): one /api/subscription call at startup instead of two.
    fetchSubscriptionPayload()
      .then((body) => {
        const data = (body ?? {}) as { trial?: { active: boolean; daysRemaining: number }; subscription?: { active?: boolean } };
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
    const userId = user?.id;
    try {
      const res = await fetch("/api/profile");
      const data = await res.json().catch(() => ({}));
      const profile = res.ok && data.profile ? data.profile : EMPTY_CURRICULUM_PROFILE;
      setCurriculumProfile(profile);
      if (res.ok && data.profile && userId) writeCachedProfile(userId, data.profile);
    } catch {
      // Offline / flaky network: keep the last known profile if one was shown.
      setCurriculumProfile((current) => current ?? EMPTY_CURRICULUM_PROFILE);
    }
  }

  /** `profiles.avatar_url` — fetched separately from /api/profile/avatar (GET) rather than folded into fetchCurriculumProfile above, since that route's shape (app/api/profile/route.ts) is out of this feature's scope. */
  async function fetchAvatarUrl() {
    try {
      const res = await fetch("/api/profile/avatar");
      const data = await res.json().catch(() => ({}));
      setAvatarUrl(res.ok ? data.avatarUrl ?? null : null);
    } catch {
      setAvatarUrl(null);
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
      setAvatarUrl(null);
      return;
    }
    // Last known profile first: the dashboard can start loading the modules
    // immediately instead of waiting for /api/profile on every open.
    const cachedProfile = readCachedProfile(user.id);
    if (cachedProfile) setCurriculumProfile(cachedProfile);
    fetchCurriculumProfile();
    fetchAvatarUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function signOut() {
    // Frees this device's slot (2-device limit, lib/devices.ts) while the
    // session cookie still exists to authenticate the call. Best effort.
    await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release" }) }).catch(() => {});
    await supabase.auth.signOut();
    setUser(null);
  }

  async function refreshUser() {
    const { data } = await supabase.auth.getUser();
    setUser(data.user);
  }

  const profile = user ? { ...profileFromUser(user), avatarUrl } : null;

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
        refreshAvatarUrl: fetchAvatarUrl,
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
