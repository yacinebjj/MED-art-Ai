import { AuthProvider } from "@/providers/AuthProvider";
import { PomodoroAuthSync } from "@/providers/PomodoroAuthSync";
import { PomodoroAnnouncer } from "@/providers/PomodoroAnnouncer";
import { LanguageStoreHydrator } from "@/components/course/workspace/AiLanguageSelect";
import { ChunkErrorRecovery } from "@/components/pwa/ChunkErrorRecovery";
import { PaywallProvider } from "@/components/billing/PaywallProvider";
import { DeviceGuard } from "@/components/security/DeviceGuard";
import { OnboardingProvider } from "@/lib/onboarding/onboarding-context";
import { TourHost } from "@/components/onboarding/TourHost";
import { RouteMotionProvider } from "@/providers/RouteMotionProvider";
import { RouteProgress } from "@/components/layout/RouteProgress";

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
      <RouteMotionProvider>
        <PomodoroAuthSync />
        <PomodoroAnnouncer />
        <LanguageStoreHydrator />
        <ChunkErrorRecovery />
        <RouteProgress />
        <PaywallProvider>
          <OnboardingProvider>
            {children}
            <TourHost />
          </OnboardingProvider>
          <DeviceGuard />
        </PaywallProvider>
      </RouteMotionProvider>
    </AuthProvider>
  );
}
