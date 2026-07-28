"use client";

import { useState } from "react";
import { Dna, MapPin, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnatomySlide } from "@/lib/presentation-types";

/** Stylized, simplified schematic — not a literal anatomical rendering, just a labeled reference frame for the callout pins. */
function AnatomyDiagram({
  structures,
  selectedId,
  onSelect,
}: {
  structures: AnatomySlide["anatomy"]["structures"];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-blue-200 bg-blue-50/50">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        {/* Iléon terminal */}
        <path
          d="M 2 50 Q 12 48 18 52"
          fill="none"
          stroke="#93c5fd"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Cæcum */}
        <ellipse cx="32" cy="40" rx="20" ry="16" fill="#bfdbfe" stroke="#3b82f6" strokeWidth="1.5" />
        {/* Appendice (tube effilé partant du cæcum) */}
        <path
          d="M 48 56 C 58 62, 64 66, 70 72 C 76 78, 80 80, 84 82"
          fill="none"
          stroke="#3b82f6"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M 48 56 C 58 62, 64 66, 70 72 C 76 78, 80 80, 84 82"
          fill="none"
          stroke="#1d4ed8"
          strokeWidth="1.5"
          strokeDasharray="2 2"
        />
      </svg>

      {structures.map((s) => {
        const isSelected = s.id === selectedId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            style={{ left: `${s.x}%`, top: `${s.y}%` }}
            className={cn(
              "absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white shadow-md transition-all duration-200",
              isSelected ? "z-10 h-7 w-7 bg-blue-600 ring-4 ring-blue-300" : "h-5 w-5 bg-blue-500 hover:h-6 hover:w-6"
            )}
            aria-label={s.label}
            aria-pressed={isSelected}
          >
            <MapPin className="h-3 w-3 text-white" />
          </button>
        );
      })}

      <span className="absolute bottom-2 right-3 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-blue-500 backdrop-blur">
        Schéma simplifié, à des fins pédagogiques
      </span>
    </div>
  );
}

export function AnatomyCalloutView({ slide }: { slide: AnatomySlide }) {
  const { anatomy } = slide;
  const [selectedId, setSelectedId] = useState<string>(anatomy.structures[0]?.id ?? "");
  const selected = anatomy.structures.find((s) => s.id === selectedId) ?? anatomy.structures[0];

  return (
    <div className="space-y-6">
      <h3 className="text-center text-sm font-bold uppercase tracking-wide text-blue-500">
        {anatomy.diagramLabel}
      </h3>

      <div className="grid gap-5 lg:grid-cols-2">
        <AnatomyDiagram structures={anatomy.structures} selectedId={selectedId} onSelect={setSelectedId} />

        <div className="space-y-2 overflow-y-auto lg:max-h-[22rem]">
          {anatomy.structures.map((s) => {
            const isSelected = s.id === selectedId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className={cn(
                  "w-full rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors",
                  isSelected
                    ? "border-blue-300 bg-blue-50 text-blue-900"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                )}
              >
                <span className="flex items-center gap-1.5 font-semibold">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-blue-900">
          {selected.description}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
            <Dna className="h-4 w-4" />
            Embryologie
          </h4>
          <p className="text-sm leading-relaxed text-emerald-900">{anatomy.embryology}</p>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-700">
            <Activity className="h-4 w-4" />
            Physiologie
          </h4>
          <p className="text-sm leading-relaxed text-blue-900">{anatomy.physiology}</p>
        </div>
      </div>
    </div>
  );
}
