"use client";

import { useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROSE_CLASSES, MARKDOWN_COMPONENTS, normalizeCallouts } from "@/lib/markdown";
import { RESUME_MODES, RESUME_TOMBABILITE, type ResumeMode } from "@/lib/demo-resume-content";

type SmartLevel = 30 | 50 | 80;

/** "Professor Notes" ignores the usual red/amber/emerald tone classification — every
 * quote gets the same slate + glasses look, since here the point is "the professor
 * said this", not "this is a red flag". */
const PROFESSOR_COMPONENTS: Components = {
  ...MARKDOWN_COMPONENTS,
  blockquote: ({ children }) => (
    <blockquote className="my-4 flex gap-3 rounded-r-lg border-l-4 border-slate-500 bg-slate-50 px-5 py-4 not-italic text-slate-800 shadow-sm">
      <span aria-hidden className="shrink-0 text-lg leading-none">
        👓
      </span>
      <div className="[&>p]:m-0">{children}</div>
    </blockquote>
  ),
};

function ModeBody({ mode, markdown }: { mode: ResumeMode; markdown: string }) {
  const components = mode.variant === "professor" ? PROFESSOR_COMPONENTS : MARKDOWN_COMPONENTS;
  const body = (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {normalizeCallouts(markdown)}
    </ReactMarkdown>
  );

  switch (mode.variant) {
    case "a4":
      return (
        <div className="mx-auto max-w-3xl rounded-lg border border-gray-200 bg-white p-8 shadow-xl">
          <div className={PROSE_CLASSES}>{body}</div>
        </div>
      );

    case "highlight":
      return (
        <div className="rounded-2xl bg-purple-50/30 p-6 ring-2 ring-purple-500">
          <div className={PROSE_CLASSES}>{body}</div>
        </div>
      );

    case "patient":
      return <div className={cn(PROSE_CLASSES, "prose-xl leading-relaxed text-slate-700")}>{body}</div>;

    case "cheatsheet":
      return (
        <div className={cn(PROSE_CLASSES, "columns-1 gap-x-10 sm:columns-2 [&_h2]:break-inside-avoid-column [&_ul]:break-inside-avoid-column")}>
          {body}
        </div>
      );

    case "flash":
      return (
        <div className={cn(PROSE_CLASSES, "prose-xl [&_ol]:space-y-5 [&_li]:font-semibold [&_li]:marker:font-bold")}>
          {body}
        </div>
      );

    case "visual":
      return (
        <div
          className={cn(
            PROSE_CLASSES,
            "prose-pre:rounded-xl prose-pre:border prose-pre:border-slate-700 prose-pre:bg-slate-900 prose-pre:text-emerald-300 prose-pre:shadow-lg"
          )}
        >
          {body}
        </div>
      );

    case "professor":
    default:
      return <div className={PROSE_CLASSES}>{body}</div>;
  }
}

export function ResumeStudio() {
  const [activeModeId, setActiveModeId] = useState(RESUME_MODES[0].id);
  const [smartLevel, setSmartLevel] = useState<SmartLevel>(50);

  const mode = RESUME_MODES.find((m) => m.id === activeModeId) ?? RESUME_MODES[0];
  const markdown = mode.id === "smart" ? mode.levels![smartLevel] : mode.content;

  return (
    <div className="animate-fade-in">
      {/* Badge de tombabilité */}
      <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-red-500/30">
        <Flame className="h-4 w-4" />
        Tombabilité à l&apos;examen : {RESUME_TOMBABILITE}%
      </div>

      {/* Navigation en pills, défilement horizontal */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
        {RESUME_MODES.map((m) => {
          const isActive = m.id === activeModeId;
          return (
            <button
              key={m.id}
              onClick={() => setActiveModeId(m.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200",
                isActive
                  ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              <m.icon className="h-3.5 w-3.5" />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Toggle de compression, uniquement pour Smart Summary */}
      {mode.id === "smart" && (
        <div className="mb-6 flex gap-2">
          {([30, 50, 80] as const).map((level) => (
            <button
              key={level}
              onClick={() => setSmartLevel(level)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                smartLevel === level
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              Compression {level}%
            </button>
          ))}
        </div>
      )}

      <ModeBody key={`${mode.id}-${smartLevel}`} mode={mode} markdown={markdown} />
    </div>
  );
}
