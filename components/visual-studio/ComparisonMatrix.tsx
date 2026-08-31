import { cn } from "@/lib/utils";
import type { ComparisonMatrixSlide } from "@/lib/presentation-types";

export function ComparisonMatrix({ slide }: { slide: ComparisonMatrixSlide }) {
  const { criteria, entities } = slide.matrix;

  return (
    <div className="overflow-x-auto rounded-xl border border-violet-200 dark:border-violet-500/25">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-r border-violet-200 bg-violet-50 p-3 text-left text-xs font-bold uppercase tracking-wide text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300">
              Critère
            </th>
            {entities.map((entity) => (
              <th
                key={entity.name}
                className={cn(
                  "border-b border-violet-200 p-3 text-left text-xs font-bold uppercase tracking-wide dark:border-violet-500/25",
                  entity.isPrimary
                    ? "bg-violet-600 text-white dark:bg-violet-500"
                    : "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                )}
              >
                {entity.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {criteria.map((criterion, rowIndex) => (
            <tr
              key={criterion}
              className={rowIndex % 2 === 0 ? "bg-card" : "bg-violet-50/30 dark:bg-violet-500/5"}
            >
              <td className="sticky left-0 z-10 border-r border-violet-200 bg-inherit p-3 font-semibold text-foreground dark:border-violet-500/25">
                {criterion}
              </td>
              {entities.map((entity) => (
                <td
                  key={entity.name}
                  className={cn(
                    "p-3 align-top leading-snug text-foreground/90",
                    entity.isPrimary && "bg-violet-50/70 font-medium text-violet-900 dark:bg-violet-500/10 dark:text-violet-200"
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
