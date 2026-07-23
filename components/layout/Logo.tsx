import { Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({
  className,
  variant = "default",
}: {
  className?: string;
  variant?: "default" | "light";
}) {
  const isLight = variant === "light";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-secondary-600 text-white shadow-soft">
        <Stethoscope className="h-5 w-5" />
      </span>
      <span
        className={cn(
          "text-lg font-bold tracking-tight",
          isLight ? "text-white" : "text-slate-900 dark:text-white"
        )}
      >
        Med Art{" "}
        <span className={isLight ? "text-white" : "text-primary-600 dark:text-primary-400"}>
          AI
        </span>
      </span>
    </div>
  );
}
