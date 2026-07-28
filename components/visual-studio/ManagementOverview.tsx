import { Check, Scissors, Syringe, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ManagementSlide } from "@/lib/presentation-types";

export function ManagementOverview({ slide }: { slide: ManagementSlide }) {
  const { approaches, antibioticProphylaxis, complications } = slide.management;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {approaches.map((approach) => (
          <div key={approach.name} className="flex flex-col gap-3 rounded-xl border border-slate-300 bg-slate-50 p-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-600">
                <Scissors className="h-4 w-4" />
              </span>
              <h4 className="text-sm font-bold text-slate-900">{approach.name}</h4>
            </div>
            <p className="text-sm leading-snug text-slate-700">{approach.description}</p>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-emerald-50 p-2.5">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Avantages</p>
                <ul className="space-y-1">
                  {approach.pros.map((pro, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs leading-snug text-emerald-900">
                      <Check className="mt-0.5 h-3 w-3 shrink-0" />
                      {pro}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg bg-rose-50 p-2.5">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700">Limites</p>
                <ul className="space-y-1">
                  {approach.cons.map((con, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs leading-snug text-rose-900">
                      <X className="mt-0.5 h-3 w-3 shrink-0" />
                      {con}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-700">
          <Syringe className="h-4 w-4" />
          Antibioprophylaxie
        </h4>
        <p className="text-sm leading-relaxed text-blue-900">{antibioticProphylaxis}</p>
      </div>

      <div>
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
          Complications post-opératoires
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          {complications.map((complication) => (
            <div
              key={complication.name}
              className={cn(
                "rounded-xl border p-3.5",
                complication.severity === "urgent"
                  ? "border-rose-200 bg-rose-50/60"
                  : "border-emerald-200 bg-emerald-50/60"
              )}
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <h5 className="text-sm font-semibold text-slate-900">{complication.name}</h5>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    complication.severity === "urgent"
                      ? "bg-rose-100 text-rose-700"
                      : "bg-emerald-100 text-emerald-700"
                  )}
                >
                  {complication.frequency}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-600">{complication.management}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
