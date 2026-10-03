import { AuthShell } from "@/components/auth/AuthShell";

/**
 * Shared, persistent layout for /login, /register and /forgot-password: the
 * shell (background, logo, tabs, card frame) mounts once, so moving between
 * these pages is a smooth client transition instead of a full re-render.
 */
export default function AuthGroupLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
