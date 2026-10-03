"use client";

import dynamic from "next/dynamic";
import { LandingNav } from "@/components/landing/LandingNav";
import { HeroSection } from "@/components/landing/HeroSection";
import { MetricsStrip } from "@/components/landing/MetricsStrip";
import { ArsenalSection } from "@/components/landing/ArsenalSection";
import { SimulatorSection } from "@/components/landing/SimulatorSection";
import { GroupsShowcase } from "@/components/landing/GroupsShowcase";
import { ComparisonSection, ProofSection } from "@/components/landing/ProofSections";
import { FaqSection, FinalCta, PricingSection } from "@/components/landing/PricingFaqCta";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { CursorGlow, ParticleField } from "@/components/landing/primitives";

// R3F/WebGL needs a real DOM canvas — dynamically imported with ssr:false so
// Next.js never tries to render it on the server.
const DnaBackground = dynamic(
  () => import("@/components/three/DnaBackground").then((mod) => mod.DnaBackground),
  { ssr: false },
);

/**
 * Public landing page — "Cyber-Medical" dark surface, always (the `dark`
 * class is scoped to this page, so the app's own light/dark choice is
 * untouched). Sections live in components/landing/*; every claim on the
 * page is a product fact (see MetricsStrip / ProofSection comments).
 */
export default function LandingPage() {
  return (
    <div className="dark relative isolate flex min-h-dvh flex-col overflow-x-hidden bg-slate-950 text-slate-100 antialiased selection:bg-cyan-400/30">
      {/* Dark page canvas while the landing is mounted (overscroll / iOS bounce never flashes white). */}
      <style>{"html,body{background:#020617}"}</style>
      {/* Fixed backdrop layers: deep gradient, aurora orbs, neural particles, 3D DNA, cursor light. */}
      <div aria-hidden className="fixed inset-0 -z-30 bg-[radial-gradient(ellipse_at_top,#0b1b33_0%,#020617_55%,#01030a_100%)]" />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[42rem] w-[42rem] rounded-full bg-cyan-500/10 blur-[140px]" />
        <div className="absolute -right-40 top-1/3 h-[36rem] w-[36rem] rounded-full bg-violet-600/10 blur-[140px]" />
        <div className="absolute bottom-0 left-1/3 h-[30rem] w-[30rem] rounded-full bg-emerald-500/[0.07] blur-[140px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.04)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      </div>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 opacity-60">
        <ParticleField />
      </div>
      <DnaBackground />
      <CursorGlow />

      <LandingNav />
      <main className="relative z-10 flex-1">
        <HeroSection />
        <MetricsStrip />
        <ArsenalSection />
        <SimulatorSection />
        <GroupsShowcase />
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
