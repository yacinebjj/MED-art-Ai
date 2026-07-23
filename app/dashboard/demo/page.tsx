"use client";

import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, FileText } from "lucide-react";
import { DEMO_SECTIONS, type DemoSectionId } from "@/lib/demo-content";
import { cn } from "@/lib/utils";

export default function DemoWorkspacePage() {
  const [activeId, setActiveId] = useState<DemoSectionId>("explication");
  const today = new Date().toLocaleDateString("fr-FR");
  const activeSection = DEMO_SECTIONS.find((s) => s.id === activeId) ?? DEMO_SECTIONS[0];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F9FAFB]">
      {/* Panneau Gauche — Sources */}
      <aside className="flex w-64 shrink-0 flex-col border-r bg-white p-4">
        <Link
          href="/dashboard"
          className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Link>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Sources
        </h2>

        <div className="flex items-start gap-2 rounded-lg bg-gray-100 p-3 text-gray-700">
          <span className="text-base leading-none">📄</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Appendicite_Cours.pdf</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {today} · 1.2 Mo
            </p>
          </div>
        </div>
      </aside>

      {/* Panneau Central — Lecture */}
      <main className="flex-1 overflow-y-auto">
        <div
          key={activeSection.id}
          className="mx-auto my-8 max-w-3xl animate-fade-in rounded-2xl bg-white p-12 shadow-sm ring-1 ring-slate-200"
        >
          <article className="prose prose-slate prose-lg">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeSection.content}</ReactMarkdown>
          </article>
        </div>
      </main>

      {/* Panneau Droit — Studio */}
      <aside className="flex w-80 shrink-0 flex-col border-l bg-slate-50 p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Studio
        </h2>

        <div className="flex flex-col gap-2">
          {DEMO_SECTIONS.map(({ id, label, icon: Icon }) => {
            const isActive = id === activeId;
            return (
              <button
                key={id}
                onClick={() => setActiveId(id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors",
                  isActive
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-gray-700 hover:bg-gray-100"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
