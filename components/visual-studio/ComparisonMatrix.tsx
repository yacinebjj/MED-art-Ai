import { cn } from "@/lib/utils";
import type { ComparisonMatrixSlide } from "@/lib/presentation-types";

export function ComparisonMatrix({ slide }: { slide: ComparisonMatrixSlide }) {
  const { criteria, entities } = slide.matrix;

  return (
    <div className="overflow-x-auto rounded-xl border border-purple-200">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-r border-purple-200 bg-purple-50 p-3 text-left text-xs font-bold uppercase tracking-wide text-purple-700">
              Critère
            </th>
            {entities.map((entity) => (
              <th
                key={entity.name}
                className={cn(
                  "border-b border-purple-200 p-3 text-left text-xs font-bold uppercase tracking-wide",
                  entity.isPrimary ? "bg-purple-600 text-white" : "bg-purple-50 text-purple-700"
                )}
              >
                {entity.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {criteria.map((criterion, rowIndex) => (
            <tr key={criterion} className={rowIndex % 2 === 0 ? "bg-white" : "bg-purple-50/30"}>
              <td className="sticky left-0 z-10 border-r border-purple-200 bg-inherit p-3 font-semibold text-slate-700">
                {criterion}
              </td>
              {entities.map((entity) => (
                <td
                  key={entity.name}
                  className={cn(
                    "p-3 align-top leading-snug text-slate-700",
                    entity.isPrimary && "bg-purple-50/70 font-medium text-purple-900"
                  )}
                >
                  {entity.values[rowIndex]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
