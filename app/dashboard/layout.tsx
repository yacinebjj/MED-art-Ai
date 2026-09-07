import { AuthProvider } from "@/providers/AuthProvider";
import { PomodoroAuthSync } from "@/providers/PomodoroAuthSync";

/**
 * Root layout for everything under /dashboard/**. Deliberately minimal —
 * just the auth context every page needs. Visual chrome (Sidebar/Topbar)
 * lives in app/dashboard/(shell)/layout.tsx so full-screen workspaces
 * outside that group — app/dashboard/demo/[slug] — can render without it.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <PomodoroAuthSync />
      {children}
    </AuthProvider>
  );
}
