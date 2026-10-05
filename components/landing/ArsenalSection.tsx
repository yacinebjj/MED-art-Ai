"use client";

import { AudioLines, Brain, FlaskConical, LayoutDashboard, Sparkles } from "lucide-react";
import { useLanguage } from "@/providers/LanguageProvider";
import { GradientText, SectionHeading } from "./primitives";
import { BentoTile } from "./bento/BentoTile";
import { AudioDemo, CockpitDemo, FlashcardDemo, LabDemo, StudioDemo } from "./bento/MiniDemos";

/** "L'arsenal" — the product's core, every tile a playable mini-UI. */
export function ArsenalSection() {
  const { language } = useLanguage();
  const fr = language === "fr";
  return (
    <section id="arsenal" className="relative scroll-mt-24 px-4 py-24 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow={fr ? "L'arsenal" : "The arsenal"}
        title={
          fr ? (
            <>
              Tout ce dont tu as besoin pour réussir. <GradientText>Dans un seul OS.</GradientText>
            </>
          ) : (
            <>
              Everything you need to succeed. <GradientText>In one OS.</GradientText>
            </>
          )
        }
        subtitle={
          fr
            ? "Chaque cours importé devient sept formats pensés pour l'examen, trois outils cliniques interactifs et des flashcards sans fin. Touche, joue, teste : tout ce qui suit fonctionne."
            : "Every imported course becomes seven exam-ready formats, three interactive clinical tools and endless flashcards. Tap, play, test: everything below works."
        }
      />

      <div className="mx-auto mt-16 grid max-w-7xl grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5">
        <BentoTile
          className="md:col-span-2"
          icon={Sparkles}
          tint="from-cyan-400 to-blue-600"
          title={fr ? "Le Studio IA" : "The AI Studio"}
          pitch={
            fr
              ? "Ton polycopié devient explication physiopathologique limpide, résumé ciblé, cas clinique et examen de 40+ QCM corrigés — sans ambiguïté, sans raccourci."
              : "Your handout becomes a crystal-clear pathophysiology explanation, a targeted summary, a clinical case and a 40+ corrected MCQ exam — no ambiguity, no shortcuts."
          }
        >
          <StudioDemo language={language} />
        </BentoTile>

        <BentoTile
          icon={Brain}
          tint="from-violet-500 to-fuchsia-600"
          title={fr ? "Flashcards sans fin" : "Endless flashcards"}
          pitch={fr ? "Lots de 50 cartes mélangées sur tous tes cours. Retourne, note-toi, recommence." : "Batches of 50 cards mixed across all your courses. Flip, grade, repeat."}
          delay={0.08}
        >
          <FlashcardDemo language={language} />
        </BentoTile>

        <BentoTile
          icon={FlaskConical}
          tint="from-rose-500 to-pink-600"
          title="MedArt Lab"
          badge={fr ? "Nouveau" : "New"}
          pitch={fr ? "Patient virtuel, matrices pharmaco & diagnostic différentiel, cartes mentales." : "Virtual patient, pharmacology & differential matrices, mind maps."}
        >
          <LabDemo language={language} />
        </BentoTile>

        <BentoTile
          icon={AudioLines}
          tint="from-orange-400 to-amber-600"
          title={fr ? "Podcast du cours" : "Course podcast"}
          pitch={fr ? "Révise en marchant : ton cours transformé en podcast, en français ou en anglais." : "Revise on the go: your course turned into a podcast, in French or English."}
          delay={0.08}
        >
          <AudioDemo language={language} />
        </BentoTile>

        <BentoTile
          icon={LayoutDashboard}
          tint="from-emerald-400 to-teal-600"
          title={fr ? "Le cockpit" : "The cockpit"}
          pitch={fr ? "Recherche Ctrl+K, assistant IA 24/7, série de révision, Pomodoro, compte à rebours d'examen." : "Ctrl+K search, 24/7 AI assistant, study streak, Pomodoro, exam countdown."}
          delay={0.16}
        >
          <CockpitDemo language={language} />
        </BentoTile>
      </div>
    </section>
  );
}
