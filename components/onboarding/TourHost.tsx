"use client";

import dynamic from "next/dynamic";
import { useOnboarding } from "@/lib/onboarding/onboarding-context";

const OnboardingTour = dynamic(() => import("@/components/onboarding/OnboardingTour").then((mod) => mod.OnboardingTour), { ssr: false });

/**
 * Mounted once for all of /dashboard (app/dashboard/layout.tsx), so every
 * page can play its tour — the module workspace and the exam included, which
 * live outside the shell. The tour engine and its content load only when a
 * tour opens.
 */
export function TourHost() {
  const { active } = useOnboarding();
  return active ? <OnboardingTour /> : null;
}
