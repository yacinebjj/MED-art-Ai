import { cn } from "@/lib/utils";
import { moduleBadgeColors } from "@/lib/note-colors";

interface ModuleBadgeProps {
  moduleId: number;
  moduleTitle: string;
  className?: string;
}

/** Real module-derived badge — only ever rendered when a note's moduleId/moduleTitle are non-null (see UserNote's own doc comment on why most notes have neither). */
export function ModuleBadge({ moduleId, moduleTitle, className }: ModuleBadgeProps) {
  const color = moduleBadgeColors(moduleId);
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold", color.bg, color.text, className)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", color.dot)} />
      <span className="truncate">{moduleTitle}</span>
    </span>
  );
}
