import { InputHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Label } from "./Label";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  /** Optional leading icon (e.g. <Mail className="h-4 w-4" />) — rendered absolutely inside the input's own row, never the label, so its vertical alignment never depends on label height/wrapping. Opt-in and backward-compatible: every existing call site without it renders exactly as before. */
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, icon, ...props }, ref) => {
    const inputId = id ?? props.name;

    return (
      <div className="w-full">
        {label && <Label htmlFor={inputId}>{label}</Label>}
        <div className="relative">
          {icon && (
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "w-full rounded-xl border bg-card px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground shadow-soft transition-all duration-300 sm:text-sm",
              "hover:border-primary/40",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary",
              "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-input disabled:bg-muted/40",
              error ? "border-destructive hover:border-destructive focus:border-destructive" : "border-input",
              icon && "pl-10",
              className
            )}
            {...props}
          />
        </div>
        {error ? (
          <p className="mt-1.5 animate-in fade-in-0 slide-in-from-top-1 text-xs text-destructive duration-200">{error}</p>
        ) : hint ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = "Input";
