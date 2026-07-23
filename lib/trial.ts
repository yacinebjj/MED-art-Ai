import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProfileRow {
  id: string;
  trial_ends_at: string | null;
}

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  if (!userId || !isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, trial_ends_at")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("Supabase profiles lookup failed", error);
      return null;
    }

    return (data as ProfileRow) ?? null;
  } catch (error) {
    console.error("Supabase profiles lookup threw", error);
    return null;
  }
}

/**
 * The real end of the trial window. Prefers profiles.trial_ends_at, but
 * falls back to `userCreatedAt + 7 days` for accounts that predate the trial
 * feature (or whose profiles row is missing it for any reason) — so an old
 * account isn't permanently treated as "never had a trial".
 */
function resolveTrialEndsAt(
  profile: ProfileRow | null,
  userCreatedAt?: string | null
): Date | null {
  if (profile?.trial_ends_at) {
    return new Date(profile.trial_ends_at);
  }
  if (userCreatedAt) {
    return new Date(new Date(userCreatedAt).getTime() + TRIAL_DURATION_MS);
  }
  return null;
}

/** Honest trial status — no dev-mode bypass here, this drives the UI badge. */
export function isTrialActive(profile: ProfileRow | null, userCreatedAt?: string | null): boolean {
  const trialEndsAt = resolveTrialEndsAt(profile, userCreatedAt);
  return trialEndsAt !== null && trialEndsAt.getTime() > Date.now();
}

export function getTrialDaysRemaining(
  profile: ProfileRow | null,
  userCreatedAt?: string | null
): number {
  const trialEndsAt = resolveTrialEndsAt(profile, userCreatedAt);
  if (!trialEndsAt) return 0;
  const diffMs = trialEndsAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}
