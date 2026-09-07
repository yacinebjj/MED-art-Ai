/**
 * Minimal admin allowlist — a stopgap, not a roles system. This codebase has
 * no admin/role table or concept anywhere (verified during a security audit
 * before adding this); building a full roles system was out of scope for
 * closing a specific hole (see app/api/courses/slug/[slug]/route.ts's PATCH
 * and DELETE), so this reads a plain comma-separated list of Supabase Auth
 * user ids from an env var instead. Fine for a small team curating a
 * shared, hand-authored showcase catalog; replace with a real `admins`
 * table (or a role column on `profiles`) if this ever needs to scale past
 * a handful of trusted accounts.
 */
export function isAdminUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const raw = process.env.ADMIN_USER_IDS;
  if (!raw) return false;
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}
