"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { profileFromUser } from "@/lib/auth";
import type { StudentProfile } from "@/lib/types";

interface TrialInfo {
  active: boolean;
  daysRemaining: number;
}

interface AuthContextValue {
  user: User | null;
  profile: StudentProfile | null;
  loading: boolean;
  trial: TrialInfo | null;
  isSubscribed: boolean;
  signOut: () => Promise<void>;
  /** Call after supabase.auth.updateUser() so the new metadata shows up immediately. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [trial, setTrial] = useState<TrialInfo | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);

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
  }, [user]);

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
      value={{ user, profile, loading, trial, isSubscribed, signOut, refreshUser }}
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
