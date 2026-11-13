"use client";

import { LandingNav } from "@/components/landing/LandingNav";
import { HeroSection } from "@/components/landing/HeroSection";
import { MetricsStrip } from "@/components/landing/MetricsStrip";
import { ArsenalSection } from "@/components/landing/ArsenalSection";
import { SimulatorSection } from "@/components/landing/SimulatorSection";
import { GroupsShowcase } from "@/components/landing/GroupsShowcase";
import { STUDY_GROUPS_ENABLED } from "@/lib/features";
import { ComparisonSection, ProofSection } from "@/components/landing/ProofSections";
import { FaqSection, FinalCta, PricingSection } from "@/components/landing/PricingFaqCta";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { CursorGlow, ParticleField } from "@/components/landing/primitives";

/**
 * Public landing page — "Cyber-Medical" dark surface, always (the `dark`
 * class is scoped to this page, so the app's own light/dark choice is
 * untouched). Sections live in components/landing/*; every claim on the
 * page is a product fact (see MetricsStrip / ProofSection comments).
 */
export default function LandingPage() {
  // landing-root (app/globals.css): clips sideways overflow without becoming a
  // scroll container, so the app's zoom lock (pinch, double-tap) holds here too.
  return (
    <div className="landing-root dark relative isolate flex min-h-dvh flex-col bg-slate-950 text-slate-100 antialiased selection:bg-cyan-400/30">
      {/* Dark page canvas while the landing is mounted (overscroll / iOS bounce never flashes white). */}
      <style>{"html,body{background:#020617}"}</style>
      {/* Fixed backdrop layers: deep gradient, aurora orbs, neural particles, cursor light. No WebGL (the 3D DNA is gone,
          2026-11-13) and no filter: each orb is a radial gradient the size of the blurred disc it replaces (the disc's box,
          widened by twice the old blur radius) — painted once, nothing for a phone to re-blur. */}
      <div aria-hidden className="fixed inset-0 -z-30 bg-[radial-gradient(ellipse_at_top,#0b1b33_0%,#020617_55%,#01030a_100%)]" />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[42rem] w-[42rem]">
          <div className="absolute -inset-[17.5rem] bg-[radial-gradient(closest-side,rgba(6,182,212,0.094),rgba(6,182,212,0.05)_55%,transparent)]" />
        </div>
        <div className="absolute -right-40 top-1/3 h-[36rem] w-[36rem]">
          <div className="absolute -inset-[17.5rem] bg-[radial-gradient(closest-side,rgba(124,58,237,0.088),rgba(124,58,237,0.05)_51%,transparent)]" />
        </div>
        <div className="absolute bottom-0 left-1/3 h-[30rem] w-[30rem]">
          <div className="absolute -inset-[17.5rem] bg-[radial-gradient(closest-side,rgba(16,185,129,0.054),rgba(16,185,129,0.035)_46%,transparent)]" />
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.04)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      </div>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 opacity-60">
        <ParticleField />
      </div>
      <CursorGlow />

      <LandingNav />
      <main className="relative z-10 flex-1">
        <HeroSection />
        <MetricsStrip />
        <ArsenalSection />
        <SimulatorSection />
        {STUDY_GROUPS_ENABLED && <GroupsShowcase />}
        <ComparisonSection />
        <ProofSection />
        <PricingSection />
        <FaqSection />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
