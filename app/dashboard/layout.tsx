import { AuthProvider } from "@/providers/AuthProvider";

/**
 * Root layout for everything under /dashboard/**. Deliberately minimal —
 * just the auth context every page needs. Visual chrome (Sidebar/Topbar)
 * lives in app/dashboard/(shell)/layout.tsx so the full-screen workspace at
 * /dashboard/course/[id] (a sibling, not nested in that group) can render
 * without it.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthProvider>{children}</AuthProvider>;
}
